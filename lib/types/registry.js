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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { installModelSelection } from '@deepseek-ai/dsh-agent';
import { SessionId } from '@deepseek-ai/dsh-session';
export class PeerRegistry {
    ctx;
    cwdRoot;
    agentOptions;
    workspaceTitle;
    visionSelection;
    live = new Map();
    sessions = new Map();
    routeBySession = new Map();
    mapPath;
    textSelection;
    workspacePromise;
    constructor(ctx, stateDir, cwdRoot, agentOptions, workspaceTitle, visionSelection) {
        this.ctx = ctx;
        this.cwdRoot = cwdRoot;
        this.agentOptions = agentOptions;
        this.workspaceTitle = workspaceTitle;
        this.visionSelection = visionSelection;
        this.mapPath = join(stateDir, 'sessions.json');
        this.textSelection = agentOptions.provider !== undefined && agentOptions.model !== undefined
            ? { provider: agentOptions.provider, model: agentOptions.model }
            : undefined;
        this.load();
    }
    /** Stable registry key for one scene + peer. */
    static key(scene, peerId) {
        return `${scene}:${peerId}`;
    }
    /** Return the live agent for `key`, resuming or creating its session as needed. */
    async ensure(key, peerId) {
        const live = this.live.get(key);
        if (live !== undefined)
            return live.agent;
        const sessionId = this.sessions.get(key);
        if (sessionId !== undefined) {
            const resumed = await this.tryResume(sessionId);
            if (resumed !== undefined) {
                this.live.set(key, resumed);
                this.routeBySession.set(resumed.agent.id, { key, scene: 'c2c', peerId });
                await this.attach(resumed.agent.id);
                return resumed.agent;
            }
        }
        mkdirSync(this.cwdRoot, { recursive: true });
        const created = await this.ctx.agents.create({
            sessionId: SessionId(randomUUID()),
            meta: { cwd: this.cwdRoot },
            agentOptions: this.agentOptions,
            setup: (agentCtx) => this.setupAgent(agentCtx),
        });
        this.live.set(key, created);
        this.sessions.set(key, created.agent.id);
        this.routeBySession.set(created.agent.id, { key, scene: 'c2c', peerId });
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
            const registry = this.ctx.get('workspaceRegistry');
            if (registry === undefined)
                return undefined;
            try {
                mkdirSync(this.cwdRoot, { recursive: true });
                return await registry.create(this.cwdRoot, this.workspaceTitle);
            }
            catch (error) {
                this.ctx.logger.warn(`qq-bot: workspace registration failed: ${String(error)}`);
                return undefined;
            }
        })();
        return this.workspacePromise;
    }
    /** Attach a session to the shared workspace group (best effort). */
    async attach(sessionId) {
        const workspace = await this.resolveWorkspace();
        if (workspace === undefined)
            return;
        try {
            await workspace.attachSession(sessionId);
        }
        catch (error) {
            this.ctx.logger.warn(`qq-bot: workspace attach failed: ${String(error)}`);
        }
    }
    async tryResume(sessionId) {
        try {
            return await this.ctx.agents.resume({
                resumeSessionId: SessionId(sessionId),
                agentOptions: this.agentOptions,
                setup: (agentCtx) => this.setupAgent(agentCtx),
            });
        }
        catch (error) {
            this.ctx.logger.warn(`qq-bot: could not resume session ${sessionId}: ${String(error)}`);
            return undefined;
        }
    }
    /**
     * Join the deployment's default agent preset so the agent gets the same
     * tools, prompt sections, and skill catalog as a web "New Session". A
     * rosterless deployment (no preset service) leaves the agent reading the
     * host plane, matching the headless entry point.
     */
    async setupAgent(agentCtx) {
        const presets = this.ctx.get('agentPresets');
        if (presets !== undefined) {
            await presets.mount(agentCtx);
        }
        // Per-message model routing: messages carrying an image go to the vision
        // model, everything else to the text model. `installModelSelection`
        // snapshots the mutable selection at prompt assembly, so setting it in
        // `agent/pre-step` (before assembly) routes the upcoming step.
        const text = this.textSelection;
        const vision = this.visionSelection;
        if (text !== undefined && vision !== undefined) {
            const selection = { current: text, assembled: undefined };
            installModelSelection(agentCtx, selection);
            agentCtx.on('agent/pre-step', ({ messages }, next) => {
                const hasImage = messages.some(message => message.content.some(block => block.type === 'image'));
                selection.current = hasImage ? vision : text;
                return next();
            });
        }
    }
    load() {
        try {
            const raw = JSON.parse(readFileSync(this.mapPath, 'utf8'));
            if (typeof raw !== 'object' || raw === null)
                return;
            for (const [key, value] of Object.entries(raw)) {
                if (typeof value === 'string')
                    this.sessions.set(key, value);
            }
        }
        catch {
            // A missing or corrupt map is not fatal; the first session rewrites it.
        }
    }
    persist() {
        try {
            mkdirSync(dirname(this.mapPath), { recursive: true });
            writeFileSync(this.mapPath, `${JSON.stringify(Object.fromEntries(this.sessions), null, 2)}\n`);
        }
        catch (error) {
            this.ctx.logger.warn(`qq-bot: could not persist session map: ${String(error)}`);
        }
    }
    async dispose() {
        for (const handle of this.live.values()) {
            try {
                await handle.dispose();
            }
            catch (error) {
                this.ctx.logger.warn(`qq-bot: agent dispose failed: ${String(error)}`);
            }
        }
        this.live.clear();
        this.routeBySession.clear();
    }
}
//# sourceMappingURL=registry.js.map