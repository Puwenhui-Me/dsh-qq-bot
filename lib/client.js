window.__ModuleLoader__.load({ id: "@puwenhui/dsh-qq-bot", factory: (require) => {


		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region settings-tab.tsx
		/**
		* 设置 → 插件 →「QQ 机器人」标签页：连接与对话模型配置表单。
		* 数据层与交互同邮件插件（describe/mutate、覆盖标记、密码脱敏、保存即重载）。
		*/
		/** 面板字段（LLM 路由跟随 DSH 部署默认模型，不在此配置；schema 能力保留可手配 patch） */
		const FIELDS = [
			{
				key: "appid",
				label: "QQ 开放平台 AppID",
				type: "string",
				placeholder: "开放平台应用详情页获取"
			},
			{
				key: "secret",
				label: "AppSecret",
				type: "secret",
				hint: "留空表示不修改；推荐改用 secretEnv 走环境变量"
			},
			{
				key: "secretEnv",
				label: "AppSecret 环境变量名",
				type: "string",
				placeholder: "QQBOT_SECRET"
			},
			{
				key: "markdown",
				label: "回复以 QQ Markdown 发送",
				type: "boolean"
			},
			{
				key: "ack",
				label: "收到消息的确认语",
				type: "string",
				placeholder: "空 = 不发确认"
			},
			{
				key: "workspaceTitle",
				label: "侧边栏分组标题",
				type: "string"
			},
			{
				key: "pythonPath",
				label: "Python 解释器",
				type: "string",
				placeholder: "python"
			},
			{
				key: "botScript",
				label: "bot.py 路径",
				type: "string",
				placeholder: "空 = 内置脚本"
			},
			{
				key: "stateDir",
				label: "状态目录",
				type: "string",
				placeholder: "空 = $DSH_HOME/qq-bot"
			},
			{
				key: "mediaDir",
				label: "媒体缓存目录",
				type: "string",
				placeholder: "空 = 状态目录/media"
			},
			{
				key: "cwdRoot",
				label: "会话工作区根目录",
				type: "string",
				placeholder: "空 = 状态目录/workspaces"
			}
		];
		function QqSettingsTab(props) {
			const face = props.face;
			const [ns, setNs] = (0, react.useState)(null);
			const [view, setView] = (0, react.useState)(null);
			const [error, setError] = (0, react.useState)(null);
			const [draft, setDraft] = (0, react.useState)(null);
			const [saving, setSaving] = (0, react.useState)(false);
			const [message, setMessage] = (0, react.useState)(null);
			const [failed, setFailed] = (0, react.useState)(false);
			const reload = (0, react.useCallback)(async () => {
				setError(null);
				if (face === void 0 || typeof face.describe !== "function") {
					setError("组件未收到设置读写面（inject face 缺失）");
					return;
				}
				const timeout = new Promise((_, reject) => setTimeout(() => reject(/* @__PURE__ */ new Error("settings.describe 8 秒未响应")), 8e3));
				let result;
				try {
					result = await Promise.race([face.describe(), timeout]);
				} catch (e) {
					setError(`读取设置失败：${String(e.message)}`);
					return;
				}
				if ("error" in result) {
					setError(result.error);
					return;
				}
				const rows = result.namespaces ?? [];
				const hit = rows.find((row) => row.ns === "qq-bot");
				if (hit === void 0) {
					setError(`设置视图中未找到 qq-bot 命名空间（共 ${String(rows.length)} 个）`);
					return;
				}
				setNs(hit.ns);
				setView(hit);
				setDraft(null);
			}, [face]);
			(0, react.useEffect)(() => {
				reload();
			}, [reload]);
			const current = view?.value ?? {};
			const userLayer = view?.user ?? {};
			const shown = draft ?? current;
			const edit = (key, value) => {
				setMessage(null);
				setFailed(false);
				setDraft((prev) => ({
					...prev ?? { ...current },
					[key]: value
				}));
			};
			const asText = (f) => String(shown[f.key] ?? "");
			const save = async () => {
				if (draft === null || ns === null || view === void 0) return;
				setSaving(true);
				try {
					const ops = [];
					for (const f of FIELDS) {
						const after = draft[f.key];
						if (after === void 0) continue;
						if (f.type === "secret" && String(after) === "") continue;
						const before = current[f.key];
						if (JSON.stringify(after) === JSON.stringify(before)) continue;
						ops.push({
							op: "set",
							path: [f.key],
							value: after
						});
					}
					if (ops.length > 0) {
						const result = await face.mutate(ns, ops, view.revision);
						if (!result.ok) throw new Error(result.error ?? "写入失败");
					}
					setDraft(null);
					setFailed(false);
					setMessage(ops.length > 0 ? "已保存，插件已按新配置自动重载" : "无更改");
					await reload();
				} catch (e) {
					setFailed(true);
					setMessage(`保存失败：${String(e.message)}`);
				} finally {
					setSaving(false);
				}
			};
			const resetField = async (f) => {
				if (ns === null || view === void 0) return;
				setSaving(true);
				try {
					const result = await face.mutate(ns, [{
						op: "unset",
						path: [f.key]
					}], view.revision);
					if (!result.ok) throw new Error(result.error ?? "写入失败");
					if (draft !== null) {
						const next = { ...draft };
						delete next[f.key];
						setDraft(next);
					}
					setMessage(`已恢复默认：${f.label}`);
					await reload();
				} catch (e) {
					setFailed(true);
					setMessage(`恢复失败：${String(e.message)}`);
				} finally {
					setSaving(false);
				}
			};
			const inputStyle = {
				width: "100%",
				padding: "6px 10px",
				font: "inherit",
				boxSizing: "border-box",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "6px",
				background: "var(--dsw-alias-bg-layer-2)",
				color: "var(--dsw-alias-label-primary)"
			};
			if (error !== null) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: {
					...cardStyle,
					color: "var(--dsw-alias-label-tertiary)"
				},
				children: [
					"QQ 机器人配置加载失败：",
					error,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						onClick: () => {
							reload();
						},
						style: {
							...btnStyle,
							marginLeft: "10px"
						},
						children: "重试"
					})
				]
			});
			if (view === null) return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				style: {
					...cardStyle,
					color: "var(--dsw-alias-label-tertiary)"
				},
				children: "QQ 机器人配置加载中…"
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				style: cardStyle,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
					style: { fontSize: "14px" },
					children: "QQ 机器人"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: {
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: "10px 14px",
						marginTop: "12px"
					},
					children: [FIELDS.map((f) => {
						const overridden = Object.hasOwn(userLayer, f.key);
						return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
							style: {
								display: "flex",
								flexDirection: "column",
								gap: "4px",
								fontSize: "13px"
							},
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
									style: { color: "var(--dsw-alias-label-secondary)" },
									children: [
										f.label,
										overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
											style: {
												marginLeft: "6px",
												color: "var(--dsw-alias-brand-primary)"
											},
											title: "用户已覆盖默认值",
											children: f.type === "secret" ? "·已设置" : "·已覆盖"
										}),
										overridden && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											disabled: saving,
											onClick: () => {
												resetField(f);
											},
											style: {
												marginLeft: "8px",
												padding: "0 6px",
												border: "1px solid var(--dsw-alias-border-l2)",
												borderRadius: "4px",
												background: "transparent",
												font: "inherit",
												fontSize: "11px",
												color: "var(--dsw-alias-label-secondary)",
												cursor: "pointer"
											},
											children: "恢复默认"
										})
									]
								}),
								f.type === "boolean" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: "checkbox",
									checked: shown[f.key] === true,
									onChange: (e) => {
										edit(f.key, e.target.checked);
									},
									style: {
										width: "16px",
										height: "16px"
									}
								}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									type: f.type === "secret" ? "password" : "text",
									value: f.type === "secret" ? String(draft?.[f.key] ?? "") : asText(f),
									placeholder: f.placeholder ?? (f.type === "secret" ? "输入新值（不回显）" : ""),
									onChange: (e) => {
										const raw = e.target.value;
										if (f.type === "number") edit(f.key, raw === "" ? 0 : Number(raw));
										else edit(f.key, raw);
									},
									style: inputStyle
								}),
								f.hint !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									style: {
										fontSize: "11px",
										color: "var(--dsw-alias-label-tertiary)"
									},
									children: f.hint
								})
							]
						}, f.key);
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: {
							gridColumn: "1 / -1",
							display: "flex",
							alignItems: "center",
							gap: "10px",
							marginTop: "4px"
						},
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: saving || draft === null,
								onClick: () => {
									save();
								},
								style: {
									padding: "6px 16px",
									borderRadius: "6px",
									font: "inherit",
									border: "1px solid var(--dsw-alias-brand-primary)",
									background: "var(--dsw-alias-brand-primary)",
									color: "var(--dsw-alias-label-primary-foreground)",
									cursor: draft === null ? "default" : "pointer",
									opacity: draft === null ? .6 : 1
								},
								children: saving ? "保存中…" : "保存"
							}),
							draft !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								disabled: saving,
								onClick: () => {
									setDraft(null);
									setMessage(null);
									setFailed(false);
								},
								style: {
									padding: "6px 16px",
									border: "1px solid var(--dsw-alias-border-l2)",
									borderRadius: "6px",
									background: "transparent",
									font: "inherit",
									color: "var(--dsw-alias-label-secondary)",
									cursor: "pointer"
								},
								children: "放弃更改"
							}),
							message !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: {
									fontSize: "12px",
									color: failed ? "var(--dsw-alias-label-error)" : "var(--dsw-alias-label-secondary)"
								},
								children: message
							})
						]
					})]
				})]
			});
		}
		const cardStyle = {
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: "10px",
			padding: "14px 16px",
			background: "var(--dsw-alias-bg-layer-3)",
			font: "13px/1.5 system-ui, \"Segoe UI\", \"Microsoft YaHei\", sans-serif",
			color: "var(--dsw-alias-label-primary)"
		};
		const btnStyle = {
			padding: "6px 12px",
			border: "1px solid var(--dsw-alias-border-l2)",
			borderRadius: "6px",
			background: "transparent",
			color: "inherit",
			font: "inherit",
			cursor: "pointer",
			whiteSpace: "nowrap"
		};
		//#endregion
		//#region index.tsx
		const name = "dsh-qq-bot";
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.settings"
		];
		const NS = "dsh-qq-bot";
		const zh = { tab: "QQ 机器人" };
		const en = { tab: "QQ Bot" };
		function apply(ctx) {
			ctx.effect(() => {
				try {
					ctx.locale.register(NS, {
						zh,
						en
					});
				} catch {}
				const t = (key) => zh[key] ?? String(key);
				const face = {
					describe: async () => {
						const response = await ctx.remote.settings.describe();
						return response.ok && response.value !== void 0 ? { namespaces: response.value.namespaces } : { error: response.error?.message ?? "settings.describe failed" };
					},
					mutate: async (ns, ops, revision) => {
						const response = await ctx.remote.settings.mutate(ns, ops, revision);
						return response.ok ? { ok: true } : {
							ok: false,
							error: response.error?.message ?? "settings.mutate failed"
						};
					}
				};
				const offTab = ctx.slots.inject("settings.plugins.tab", () => ctx.slots.register({
					name: "settings.plugins.tab",
					id: "qq-bot",
					order: 40,
					label: () => t("tab"),
					locale: NS,
					inject: () => ({ face })
				}, QqSettingsTab));
				return () => {
					offTab();
				};
			}, "dsh-qq-bot: settings tab");
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map