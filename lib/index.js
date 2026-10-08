import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { fileURLToPath } from "node:url";
import z from "@deepseek-ai/schemastery";
import { dshHomePath } from "@deepseek-ai/dsh-home-paths";
import { spawn } from "node:child_process";
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { SessionId } from "@deepseek-ai/dsh-session";
//#region lib/types/config.js
/**
* Plugin configuration and media-type normalization for the QQ bot bridge.
* @module @deepseek-ai/dsh-qq-bot/config
*/
const Config = z.object({
	appid: z.string().default("").description("QQ 开放平台 AppID（开放平台应用详情页获取）").volatile(),
	secret: z.string().default("").role("secret").description("AppSecret 明文（推荐用 secretEnv 走环境变量）").volatile(),
	secretEnv: z.string().default("").description("存 AppSecret 的环境变量名（如 QQBOT_SECRET）").volatile(),
	pythonPath: z.string().default("python").description("Python 解释器（跑桥接进程）").volatile(),
	botScript: z.string().default("").description("bot.py 路径（空 = 用内置脚本）").volatile(),
	stateDir: z.string().default("").description("状态目录（空 = /qq-bot）").volatile(),
	mediaDir: z.string().default("").description("媒体缓存目录（空 = 状态目录/media）").volatile(),
	cwdRoot: z.string().default("").description("会话工作区根目录（空 = 状态目录/workspaces）").volatile(),
	workspaceTitle: z.string().default("QQ bot").description("侧边栏工作区分组标题").volatile(),
	provider: z.string().default("").description("对话 LLM provider（空 = 部署默认模型）").volatile(),
	model: z.string().default("").description("对话模型 id（空 = 部署默认模型）").volatile(),
	visionProvider: z.string().default("").description("图片消息的 provider（空 = 不专门路由）").volatile(),
	visionModel: z.string().default("").description("图片消息的模型 id（空 = 不专门路由）").volatile(),
	maxTokens: z.number().default(0).description("单次请求输出上限 token（0 = 不限）").volatile(),
	markdown: z.boolean().default(true).description("回复以 QQ Markdown 格式发送（即时生效）").volatile(),
	ack: z.string().default("").description("收到消息的即时确认语（空 = 不确认）").volatile()
});
/** Resolve defaults into absolute paths and materialize the effective secret. */
function resolveConfig(config) {
	const unwrap = (ref) => ref.get();
	const c = {
		appid: unwrap(config.appid),
		secret: unwrap(config.secret),
		secretEnv: unwrap(config.secretEnv),
		pythonPath: unwrap(config.pythonPath),
		botScript: unwrap(config.botScript),
		stateDir: unwrap(config.stateDir),
		mediaDir: unwrap(config.mediaDir),
		cwdRoot: unwrap(config.cwdRoot),
		workspaceTitle: unwrap(config.workspaceTitle),
		provider: unwrap(config.provider),
		model: unwrap(config.model),
		visionProvider: unwrap(config.visionProvider),
		visionModel: unwrap(config.visionModel),
		maxTokens: unwrap(config.maxTokens),
		markdown: unwrap(config.markdown),
		ack: unwrap(config.ack)
	};
	const stateDir = resolve(c.stateDir !== "" ? c.stateDir : dshHomePath("qq-bot"));
	const mediaDir = resolve(c.mediaDir !== "" ? c.mediaDir : join(stateDir, "media"));
	const cwdRoot = resolve(c.cwdRoot !== "" ? c.cwdRoot : join(stateDir, "workspaces"));
	const botScript = c.botScript !== "" ? c.botScript : fileURLToPath(new URL("../python/bot.py", import.meta.url));
	const secret = c.secret !== "" ? c.secret : c.secretEnv !== "" ? process.env[c.secretEnv] ?? "" : "";
	return {
		...c,
		secret,
		stateDir,
		mediaDir,
		cwdRoot,
		botScript
	};
}
/** Whether the bridge has enough configuration to start. */
function isConfigured(config) {
	return config.appid !== "" && config.secret !== "";
}
const MEDIA_TYPES = {
	"image/png": "image/png",
	"image/jpeg": "image/jpeg",
	"image/jpg": "image/jpeg",
	"image/webp": "image/webp",
	"image/gif": "image/gif"
};
/** Map a QQ attachment `content_type` to an attachment-service media type, if it is a raster image. */
function normalizeMediaType(contentType) {
	return MEDIA_TYPES[contentType.toLowerCase()];
}
//#endregion
//#region lib/types/protocol.js
/**
* NDJSON wire protocol between the qq-bot plugin and its Python botpy
* subprocess. One JSON object per line; stdout carries QQ → DSH events, stdin
* carries DSH → QQ send instructions. Media payloads reference local filesystem
* paths (Python downloads QQ attachments before forwarding; DSH writes outbound
* images to the shared media directory), never inline bytes.
* @module @deepseek-ai/dsh-qq-bot/protocol
*/
/** Incremental NDJSON line framer: turns raw stream chunks into complete lines. */
var LineDecoder = class {
	buffer = "";
	push(chunk) {
		this.buffer += chunk;
		const lines = [];
		let newline = this.buffer.indexOf("\n");
		while (newline >= 0) {
			const line = this.buffer.slice(0, newline);
			this.buffer = this.buffer.slice(newline + 1);
			if (line.trim() !== "") lines.push(line);
			newline = this.buffer.indexOf("\n");
		}
		return lines;
	}
};
/** Encode one outbound object as a single NDJSON line. */
function encode(event) {
	return `${JSON.stringify(event)}\n`;
}
//#endregion
//#region lib/types/bridge.js
/**
* Spawns and supervises the Python botpy subprocess over NDJSON stdio.
* stderr is inherited (botpy logs stay visible), while stdout is reserved
* strictly for the NDJSON event stream. Exits are restarted with backoff; a
* `ready` event resets the backoff.
* @module @deepseek-ai/dsh-qq-bot/bridge
*/
var Bridge = class {
	ctx;
	config;
	onEvent;
	child;
	decoder = new LineDecoder();
	restartDelay = 500;
	restartMax = 3e4;
	restartTimer;
	closed = false;
	constructor(ctx, config, onEvent) {
		this.ctx = ctx;
		this.config = config;
		this.onEvent = onEvent;
	}
	start() {
		this.spawn();
	}
	spawn() {
		mkdirSync(this.config.mediaDir, { recursive: true });
		const child = spawn(this.config.pythonPath, [this.config.botScript], {
			env: {
				...process.env,
				PYTHONUTF8: "1",
				QQBOT_APPID: this.config.appid,
				QQBOT_SECRET: this.config.secret,
				QQBOT_MEDIA_DIR: this.config.mediaDir
			},
			stdio: [
				"pipe",
				"pipe",
				"inherit"
			]
		});
		this.child = child;
		child.stdout?.setEncoding("utf8");
		child.stdout?.on("data", (chunk) => {
			for (const line of this.decoder.push(chunk)) {
				let event;
				try {
					event = JSON.parse(line);
				} catch (error) {
					this.ctx.logger.warn(`qq-bot: non-JSON bridge line: ${String(error)}`);
					continue;
				}
				this.onEvent(event);
			}
		});
		child.on("error", (error) => {
			this.ctx.logger.warn(`qq-bot: bridge spawn failed: ${error.message}`);
		});
		child.on("exit", (code) => {
			if (this.child !== child) return;
			this.child = void 0;
			if (this.closed) return;
			this.ctx.logger.warn(`qq-bot: python bridge exited (${code ?? "signal"}), restarting in ${this.restartDelay}ms`);
			this.restartTimer = setTimeout(() => this.spawn(), this.restartDelay);
			this.restartDelay = Math.min(this.restartDelay * 2, this.restartMax);
		});
	}
	/** The bridge reported `ready`: reset the restart backoff. */
	markReady() {
		this.restartDelay = 500;
	}
	send(message) {
		this.child?.stdin?.write(encode(message));
	}
	async close() {
		this.closed = true;
		if (this.restartTimer !== void 0) clearTimeout(this.restartTimer);
		const child = this.child;
		this.child = void 0;
		if (child === void 0) return;
		child.stdin?.end();
		child.kill();
		await new Promise((resolvePromise) => {
			child.once("exit", () => resolvePromise());
		});
	}
};
//#endregion
//#region lib/types/registry.js
/**
* Peer → agent/session registry. Each QQ peer owns one long-lived agent, and
* the peer → session-id map is persisted so a restart resumes the same session
* (multi-turn memory survives the process boundary). Agents are created lazily
* on first message, which sidesteps the agent-factory startup race.
*
* All QQ sessions share one workspace directory (the plugin `cwdRoot`), which
* is registered as a sidebar workspace group (`workspaceTitle`) when the
* workspace service is available, so QQ conversations group together in the UI.
* @module @deepseek-ai/dsh-qq-bot/registry
*/
var PeerRegistry = class {
	ctx;
	cwdRoot;
	agentOptions;
	workspaceTitle;
	visionSelection;
	live = /* @__PURE__ */ new Map();
	sessions = /* @__PURE__ */ new Map();
	routeBySession = /* @__PURE__ */ new Map();
	mapPath;
	textSelection;
	workspacePromise;
	constructor(ctx, stateDir, cwdRoot, agentOptions, workspaceTitle, visionSelection) {
		this.ctx = ctx;
		this.cwdRoot = cwdRoot;
		this.agentOptions = agentOptions;
		this.workspaceTitle = workspaceTitle;
		this.visionSelection = visionSelection;
		this.mapPath = join(stateDir, "sessions.json");
		this.textSelection = agentOptions.provider !== void 0 && agentOptions.model !== void 0 ? {
			provider: agentOptions.provider,
			model: agentOptions.model
		} : void 0;
		this.load();
	}
	/** Stable registry key for one scene + peer. */
	static key(scene, peerId) {
		return `${scene}:${peerId}`;
	}
	/** Return the live agent for `key`, resuming or creating its session as needed. */
	async ensure(key, peerId) {
		const live = this.live.get(key);
		if (live !== void 0) return live.agent;
		const sessionId = this.sessions.get(key);
		if (sessionId !== void 0) {
			const resumed = await this.tryResume(sessionId);
			if (resumed !== void 0) {
				this.live.set(key, resumed);
				this.routeBySession.set(resumed.agent.id, {
					key,
					scene: "c2c",
					peerId
				});
				await this.attach(resumed.agent.id);
				return resumed.agent;
			}
		}
		mkdirSync(this.cwdRoot, { recursive: true });
		const created = await this.ctx.agents.create({
			sessionId: SessionId(randomUUID()),
			meta: { cwd: this.cwdRoot },
			agentOptions: this.agentOptions,
			setup: (agentCtx) => this.setupAgent(agentCtx)
		});
		this.live.set(key, created);
		this.sessions.set(key, created.agent.id);
		this.routeBySession.set(created.agent.id, {
			key,
			scene: "c2c",
			peerId
		});
		this.persist();
		await this.attach(created.agent.id);
		return created.agent;
	}
	/** Resolve the peer routing for a session owned by this registry, if any. */
	ownerOf(sessionId) {
		return this.routeBySession.get(sessionId);
	}
	/** Lazily register (or reuse) the shared sidebar workspace group. */
	resolveWorkspace() {
		this.workspacePromise ??= (async () => {
			const registry = this.ctx.get("workspaceRegistry");
			if (registry === void 0) return void 0;
			try {
				mkdirSync(this.cwdRoot, { recursive: true });
				return await registry.create(this.cwdRoot, this.workspaceTitle);
			} catch (error) {
				this.ctx.logger.warn(`qq-bot: workspace registration failed: ${String(error)}`);
				return;
			}
		})();
		return this.workspacePromise;
	}
	/** Attach a session to the shared workspace group (best effort). */
	async attach(sessionId) {
		const workspace = await this.resolveWorkspace();
		if (workspace === void 0) return;
		try {
			await workspace.attachSession(sessionId);
		} catch (error) {
			this.ctx.logger.warn(`qq-bot: workspace attach failed: ${String(error)}`);
		}
	}
	async tryResume(sessionId) {
		try {
			return await this.ctx.agents.resume({
				resumeSessionId: SessionId(sessionId),
				agentOptions: this.agentOptions,
				setup: (agentCtx) => this.setupAgent(agentCtx)
			});
		} catch (error) {
			this.ctx.logger.warn(`qq-bot: could not resume session ${sessionId}: ${String(error)}`);
			return;
		}
	}
	/**
	* Join the deployment's default agent preset so the agent gets the same
	* tools, prompt sections, and skill catalog as a web "New Session". A
	* rosterless deployment (no preset service) leaves the agent reading the
	* host plane, matching the headless entry point.
	*/
	async setupAgent(agentCtx) {
		const presets = this.ctx.get("agentPresets");
		if (presets !== void 0) await presets.mount(agentCtx);
		const text = this.textSelection;
		const vision = this.visionSelection;
		if (text !== void 0 && vision !== void 0) {
			const selection = {
				current: text,
				assembled: void 0
			};
			installModelSelection(agentCtx, selection);
			agentCtx.on("agent/pre-step", ({ messages }, next) => {
				selection.current = messages.some((message) => message.content.some((block) => block.type === "image")) ? vision : text;
				return next();
			});
		}
	}
	load() {
		try {
			const raw = JSON.parse(readFileSync(this.mapPath, "utf8"));
			if (typeof raw !== "object" || raw === null) return;
			for (const [key, value] of Object.entries(raw)) if (typeof value === "string") this.sessions.set(key, value);
		} catch {}
	}
	persist() {
		try {
			mkdirSync(dirname(this.mapPath), { recursive: true });
			writeFileSync(this.mapPath, `${JSON.stringify(Object.fromEntries(this.sessions), null, 2)}\n`);
		} catch (error) {
			this.ctx.logger.warn(`qq-bot: could not persist session map: ${String(error)}`);
		}
	}
	async dispose() {
		for (const handle of this.live.values()) try {
			await handle.dispose();
		} catch (error) {
			this.ctx.logger.warn(`qq-bot: agent dispose failed: ${String(error)}`);
		}
		this.live.clear();
		this.routeBySession.clear();
	}
};
//#endregion
//#region lib/types/index.js
/**
* QQ 单聊 (C2C) bridge plugin.
*
* Mounts a Python botpy subprocess that owns the QQ WebSocket connection and
* relays inbound C2C messages (text/image/file) to DSH over NDJSON stdio. Each
* QQ peer maps to one persistent agent (multi-turn memory, resumed across
* restarts); committed assistant text is relayed back as QQ Markdown.
*
* @module @deepseek-ai/dsh-qq-bot
*/
const name = "qq-bot";
const inject = [
	"agents",
	"attachments",
	"agentDefaultModel"
];
function buildAgentOptions(config, ctx) {
	const selection = ctx.agentDefaultModel.currentSelection();
	const options = {
		provider: config.provider !== "" ? config.provider : selection.provider,
		model: config.model !== "" ? config.model : selection.model
	};
	if (config.maxTokens > 0) options.maxTokens = config.maxTokens;
	return options;
}
function apply(ctx, config) {
	const resolved = resolveConfig(config);
	if (!isConfigured(resolved)) {
		ctx.logger.warn("qq-bot: appid/secret not configured — bridge disabled");
		return;
	}
	const agentOptions = buildAgentOptions(resolved, ctx);
	const hasVisionModel = resolved.visionProvider !== "" && resolved.visionModel !== "";
	const visionSelection = hasVisionModel ? {
		provider: resolved.visionProvider,
		model: resolved.visionModel
	} : void 0;
	const registry = new PeerRegistry(ctx, resolved.stateDir, resolved.cwdRoot, agentOptions, resolved.workspaceTitle, visionSelection);
	const outputTails = /* @__PURE__ */ new Map();
	const bridge = new Bridge(ctx, resolved, (event) => {
		handleEvent(event).catch((error) => {
			ctx.logger.warn(`qq-bot: inbound event failed: ${String(error)}`);
		});
	});
	function sendText(scene, peerId, text) {
		bridge.send({
			type: "send",
			scene,
			peerId,
			kind: resolved.markdown ? "markdown" : "text",
			payload: { text }
		});
	}
	async function handleEvent(event) {
		if (event.type === "ready") {
			bridge.markReady();
			ctx.logger.info("qq-bot: python bridge ready");
			return;
		}
		if (event.type === "error") {
			ctx.logger.warn(`qq-bot: python bridge error: ${event.message}`);
			return;
		}
		await handleMessage(event);
	}
	async function handleMessage(message) {
		const key = PeerRegistry.key(message.scene, message.peerId);
		let agent;
		try {
			agent = await registry.ensure(key, message.peerId);
		} catch (error) {
			ctx.logger.warn(`qq-bot: could not ensure session: ${String(error)}`);
			sendText(message.scene, message.peerId, `⚠️ 处理失败：${String(error)}`);
			return;
		}
		const content = await buildInboundContent(message, agent);
		if (content.length === 0) return;
		if (resolved.ack !== "") sendText(message.scene, message.peerId, resolved.ack);
		try {
			agent.followup(createUserMessage({
				content,
				source: { kind: "user" }
			}));
		} catch (error) {
			ctx.logger.warn(`qq-bot: followup failed: ${String(error)}`);
			sendText(message.scene, message.peerId, `⚠️ 提交失败：${String(error)}`);
		}
	}
	const imageSupportCache = /* @__PURE__ */ new Map();
	/** Whether the agent's current model declares image input support. */
	async function supportsImageInput(agent) {
		const llm = ctx.get("llm");
		const provider = agent.options.provider;
		const model = agent.options.model;
		if (llm === void 0 || provider === void 0 || model === void 0) return false;
		const cacheKey = `${provider}\u0000${model}`;
		const cached = imageSupportCache.get(cacheKey);
		if (cached !== void 0) return cached;
		let supported = false;
		try {
			supported = (await llm.resolveModelInfo(provider, model)).inputModalities?.includes("image") ?? false;
		} catch (error) {
			ctx.logger.warn(`qq-bot: image-support lookup failed: ${String(error)}`);
		}
		imageSupportCache.set(cacheKey, supported);
		return supported;
	}
	async function buildInboundContent(message, agent) {
		const blocks = [];
		if (message.content !== "") blocks.push({
			type: "text",
			text: message.content
		});
		const cwd = agent.session.header.cwd ?? process.cwd();
		for (const attachment of message.attachments) {
			const mediaType = normalizeMediaType(attachment.contentType);
			const isImage = attachment.kind === "image" && mediaType !== void 0;
			if (isImage && (hasVisionModel || await supportsImageInput(agent))) try {
				const data = readFileSync(attachment.path);
				const ref = (await ctx.attachments.saveImages([{
					data,
					mediaType,
					...attachment.filename !== null && attachment.filename !== "" ? { name: attachment.filename } : {}
				}]))[0];
				if (ref !== void 0) blocks.push({
					type: "image",
					attachment: ref
				});
			} catch (error) {
				ctx.logger.warn(`qq-bot: image admission failed: ${String(error)}`);
			}
			else {
				const name = attachment.filename ?? basename(attachment.path);
				const dest = join(cwd, "uploads", name);
				try {
					mkdirSync(join(cwd, "uploads"), { recursive: true });
					copyFileSync(attachment.path, dest);
					const note = isImage ? `用户发来了一张图片「${name}」，已保存到工作目录 ${join("uploads", name)}（当前模型不支持直接查看图片）。` : `用户发来了文件「${name}」，已保存到工作目录 ${join("uploads", name)}。`;
					blocks.push({
						type: "text",
						text: note
					});
				} catch (error) {
					ctx.logger.warn(`qq-bot: attachment copy failed: ${String(error)}`);
				}
			}
		}
		return blocks;
	}
	ctx.on("session/event", (session, event) => {
		const route = registry.ownerOf(session.header.id);
		if (route === void 0) return;
		if (event.type !== "assistant/message") return;
		const delivery = (outputTails.get(session.header.id) ?? Promise.resolve()).then(() => deliverAssistant(route, event.data.message.content));
		outputTails.set(session.header.id, delivery.catch((error) => {
			ctx.logger.warn(`qq-bot: assistant delivery failed: ${String(error)}`);
		}));
	});
	async function deliverAssistant(route, blocks) {
		let text = "";
		for (const block of blocks) {
			if (block.type === "text") {
				text += block.text;
				continue;
			}
			if (block.type === "image") {
				if (text !== "") {
					sendText(route.scene, route.peerId, text);
					text = "";
				}
				await deliverImage(route, block);
				continue;
			}
		}
		if (text !== "") sendText(route.scene, route.peerId, text);
	}
	async function deliverImage(route, block) {
		try {
			const stored = await ctx.attachments.readImage(block.attachment);
			const ext = stored.ref.mediaType === "image/png" ? ".png" : stored.ref.mediaType === "image/webp" ? ".webp" : stored.ref.mediaType === "image/gif" ? ".gif" : ".jpg";
			const path = join(resolved.mediaDir, `out-${randomUUID()}${ext}`);
			mkdirSync(resolved.mediaDir, { recursive: true });
			writeFileSync(path, stored.data);
			bridge.send({
				type: "send",
				scene: route.scene,
				peerId: route.peerId,
				kind: "image",
				payload: {
					path,
					mediaType: stored.ref.mediaType
				}
			});
		} catch (error) {
			ctx.logger.warn(`qq-bot: image read failed: ${String(error)}`);
			sendText(route.scene, route.peerId, "🖼️（图片读取失败）");
		}
	}
	bridge.start();
	ctx.effect(() => () => {
		(async () => {
			await bridge.close();
			await registry.dispose();
		})();
	});
}
//#endregion
export { Config, apply, inject, name };
