/**
 * dsh-pin-default-model browser half: a Settings section for choosing which
 * model every new conversation starts on.
 *
 * All state lives on the host; this page only talks to two local routes with
 * plain fetch. It deliberately avoids the settings-client services so it can
 * load regardless of plugin activation order.
 */
window.__ModuleLoader__.load({
	id: "dsh-pin-default-model",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		const NS = "dsh-pin-default-model";
		const VIEW_URL = "/dsh-pin-model/view";
		const SET_URL = "/dsh-pin-model/set";

		const zh = {
			nav: "默认模型锁定",
			desc: "锁定新建会话使用的模型。在会话内切换模型仍然只对那个会话生效，不会改写这里的设置。",
			current: "当前锁定",
			notSet: "未设置（使用插件默认值 magpie/group/x-call）",
			choose: "选择模型",
			save: "保存",
			saving: "保存中…",
			saved: "已保存",
			loadFailed: "读取失败。",
			saveFailed: "保存失败。",
			loading: "加载中…",
			noCatalog: "没有可用模型。",
			noCatalogHint: "请先在设置 → 模型里配置至少一个提供方。",
			effort: "推理档位",
			effortDefault: "跟随模型默认",
			reset: "刷新",
			unavailable: "该模型当前不在可用目录中（仍会按此值锁定）。",
			note: "锁定值写入 profile 配置。修改后对新建会话立即生效，已打开的会话保持不变。"
		};
		const en = {
			nav: "Default model pin",
			desc: "Hold the model that new conversations start on. Switching a model inside a session still applies to that session only and no longer rewrites this setting.",
			current: "Currently pinned",
			notSet: "Not set — the bundled default magpie/group/x-call applies",
			choose: "Choose a model",
			save: "Save",
			saving: "Saving…",
			saved: "Saved",
			loadFailed: "Could not load the current pin.",
			saveFailed: "Save failed.",
			loading: "Loading…",
			noCatalog: "No models available.",
			noCatalogHint: "Configure at least one provider in Settings → Models first.",
			effort: "Reasoning effort",
			effortDefault: "Model default",
			reset: "Refresh",
			unavailable: "This model is not in the current catalog (the pin still uses it).",
			note: "The pin is written to the profile. A change applies to new conversations immediately; open conversations stay as they are."
		};

		const box = {
			padding: "5px 10px",
			borderRadius: 6,
			border: "1px solid var(--dsh-border, rgba(128,128,128,.35))",
			background: "var(--dsw-alias-bg-overlay, rgba(128,128,128,.08))",
			color: "inherit",
			fontSize: 12,
			outline: "none"
		};

		/** Render `provider/model`, or a placeholder when nothing is pinned. */
		function labelOf(selection, emptyText) {
			if (!selection?.provider || !selection?.model) return emptyText;
			return `${selection.provider}/${selection.model}`;
		}

		function PinSection({ t }) {
			const [loading, setLoading] = react.useState(true);
			const [pinned, setPinned] = react.useState(null);
			const [groups, setGroups] = react.useState([]);
			const [draft, setDraft] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			const [saved, setSaved] = react.useState(false);

			const load = react.useCallback(() => {
				setLoading(true);
				setError(null);
				fetch(VIEW_URL, { cache: "no-store" })
					.then((res) => res.json())
					.then((body) => {
						if (body && body.ok === true) {
							setPinned(body.selection ?? null);
							setGroups(Array.isArray(body.groups) ? body.groups : []);
						}
						else {
							setError(t("loadFailed"));
						}
					})
					.catch(() => setError(t("loadFailed")))
					.finally(() => setLoading(false));
			}, [t]);

			react.useEffect(() => {
				load();
			}, [load]);

			const effortNames = react.useMemo(() => {
				if (!draft) return [];
				const group = groups.find((g) => g.id === draft.provider);
				const model = group?.models?.find((m) => m.id === draft.model);
				const efforts = model?.reasoning?.efforts;
				if (!efforts) return [];
				return Object.keys(efforts).filter((k) => efforts[k] !== false);
			}, [groups, draft]);

			const fromCatalog = Boolean(
				groups.some((g) => g.id === pinned?.provider && g.models?.some((m) => m.id === pinned?.model)),
			);

			const submit = react.useCallback(() => {
				if (!draft) return;
				setBusy(true);
				setError(null);
				setSaved(false);
				fetch(SET_URL, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(draft)
				})
					.then((res) => res.json())
					.then((body) => {
						if (body && body.ok === true) {
							setPinned(body.selection);
							setSaved(true);
							setDraft(null);
						}
						else {
							setError(`${t("saveFailed")} ${body?.error ?? ""}`.trim());
						}
					})
					.catch((reason) => setError(`${t("saveFailed")} ${reason instanceof Error ? reason.message : String(reason)}`))
					.finally(() => setBusy(false));
			}, [draft, t]);

			if (loading) {
				return react_jsx_runtime.jsx("div", { style: { padding: 12, opacity: 0.75 }, children: t("loading") });
			}

			const effective = draft ?? pinned ?? {};

			return react_jsx_runtime.jsxs("div", {
				style: { display: "flex", flexDirection: "column", gap: 12, padding: "4px 0" },
				children: [
					react_jsx_runtime.jsx("div", { style: { fontSize: 13, opacity: 0.82, lineHeight: 1.55 }, children: t("desc") }),

					react_jsx_runtime.jsxs("div", {
						style: {
							display: "flex",
							flexDirection: "column",
							gap: 10,
							padding: "12px 14px",
							borderRadius: 8,
							border: "1px solid var(--dsh-border, rgba(128,128,128,.24))",
							background: "rgba(128,128,128,.04)"
						},
						children: [
							react_jsx_runtime.jsxs("div", {
								style: { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" },
								children: [
									react_jsx_runtime.jsx("span", { style: { fontSize: 12, opacity: 0.68 }, children: t("current") }),
									react_jsx_runtime.jsx("code", {
										style: {
											fontSize: 13,
											fontWeight: 600,
											padding: "2px 8px",
											borderRadius: 5,
											background: "rgba(65,118,230,.12)",
											color: "var(--dsw-alias-brand-primary, #4176e6)"
										},
										children: labelOf(pinned, t("notSet"))
									}),
									pinned?.reasoningEffort ? react_jsx_runtime.jsx("span", {
										style: { fontSize: 12, opacity: 0.7 },
										children: `${t("effort")}: ${pinned.reasoningEffort}`
									}) : null
								]
							}),

							groups.length === 0 ? react_jsx_runtime.jsxs("div", {
								style: { fontSize: 12, opacity: 0.75, padding: "8px 0" },
								children: [
									react_jsx_runtime.jsx("div", { children: t("noCatalog") }),
									react_jsx_runtime.jsx("div", { style: { opacity: 0.75, marginTop: 2 }, children: t("noCatalogHint") })
								]
							}) : react_jsx_runtime.jsxs("div", {
								style: { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" },
								children: [
									react_jsx_runtime.jsxs("select", {
										value: effective.provider ? `${effective.provider}\u0000${effective.model}` : "",
										disabled: busy,
										onChange: (event) => {
											const [provider, model] = String(event.target.value).split("\u0000");
											if (provider && model) {
												setDraft({ provider, model });
												setSaved(false);
											}
										},
										style: { ...box, flex: "1 1 260px", minWidth: 200 },
										children: [
											react_jsx_runtime.jsx("option", { value: "", children: t("choose") }),
											groups.map((group) => react_jsx_runtime.jsx("optgroup", {
												label: group.name || group.id,
												children: (group.models ?? []).map((model) => react_jsx_runtime.jsx("option", {
													value: `${group.id}\u0000${model.id}`,
													children: model.name && model.name !== model.id ? `${model.name} · ${model.id}` : model.id
												}, `${group.id}:${model.id}`))
											}, group.id))
										]
									}),
									effortNames.length > 0 ? react_jsx_runtime.jsxs("select", {
										value: effective.reasoningEffort ?? "",
										disabled: busy,
										onChange: (event) => {
											const effort = String(event.target.value);
											setDraft({
												provider: effective.provider,
												model: effective.model,
												...(effort ? { reasoningEffort: effort } : {})
											});
											setSaved(false);
										},
										style: { ...box, flex: "0 1 170px" },
										children: [
											react_jsx_runtime.jsx("option", { value: "", children: t("effortDefault") }),
											effortNames.map((name) => react_jsx_runtime.jsx("option", { value: name, children: name }, name))
										]
									}) : null
								]
							}),

							!fromCatalog && pinned?.provider ? react_jsx_runtime.jsx("div", {
								style: { fontSize: 12, color: "var(--dsh-warning, #e6a23c)" },
								children: t("unavailable")
							}) : null,

							react_jsx_runtime.jsxs("div", {
								style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },
								children: [
									react_jsx_runtime.jsx("button", {
										type: "button",
										disabled: !draft || busy,
										onClick: submit,
										style: {
											padding: "6px 16px",
											borderRadius: 6,
											fontSize: 12,
											fontWeight: 600,
											border: "1px solid rgba(65,118,230,.5)",
											background: draft && !busy ? "rgba(65,118,230,.14)" : "transparent",
											color: draft && !busy ? "var(--dsw-alias-brand-primary, #4176e6)" : "inherit",
											opacity: draft && !busy ? 1 : 0.45,
											cursor: draft && !busy ? "pointer" : "default"
										},
										children: busy ? t("saving") : t("save")
									}),
									react_jsx_runtime.jsx("button", {
										type: "button",
										disabled: busy,
										onClick: load,
										style: { ...box, cursor: "pointer", opacity: 0.85 },
										children: t("reset")
									}),
									saved ? react_jsx_runtime.jsx("span", {
										style: { fontSize: 12, color: "var(--dsh-success, #4aa05a)" },
										children: t("saved")
									}) : null
								]
							})
						]
					}),

					error === null ? null : react_jsx_runtime.jsx("div", {
						role: "alert",
						style: { fontSize: 12, color: "var(--dsh-danger, #dc5050)", whiteSpace: "pre-wrap" },
						children: error
					}),

					react_jsx_runtime.jsx("div", { style: { fontSize: 12, opacity: 0.62, lineHeight: 1.5 }, children: t("note") })
				]
			});
		}

		const name = "dsh-pin-default-model";
		const inject = ["slots", "locale"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: dictionaries`);
			const t = ctx.locale.bind(NS);

			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "default-model-pin",
				priority: -2,
				order: 70,
				label: () => t("nav"),
				locale: NS,
				inject: () => ({ t })
			}, PinSection));
		}

		exports.name = name;
		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	}
});
