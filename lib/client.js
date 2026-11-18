/**
 * dsh-toutiao — 桌面端设置面板（client.js）
 *
 * 宿主契约（照抄 fish-soul 的做法）：
 *  - window.__ModuleLoader__.load({ id, factory })，exports.apply / inject；inject: ["slots"]
 *  - ctx.slots.inject("settings.section", ...) 挂到「设置」里一个独立分区
 *  - 不 require 任何 Harness Client 包；控件结构 / 无障碍语义 / fs- 前缀样式照抄 ui-primitives
 *  - 所有数据走 /api/plugins/dsh-toutiao/*（见 lib/routes.mjs）
 */
window.__ModuleLoader__.load({
	id: "dsh-toutiao",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");

		const inject = ["slots"];
		const PLUGIN_ID = "dsh-toutiao";
		const API = "/api/plugins/dsh-toutiao";
		const h = react.createElement;
		const cx = (...names) => names.filter(Boolean).join(" ");

		// ── 通信层：fail-open ──
		async function api(method, path, body) {
			try {
				const response = await fetch(API + path, {
					method,
					headers: { "content-type": "application/json" },
					...(body !== undefined ? { body: JSON.stringify(body) } : {}),
				});
				const data = await response.json().catch(() => null);
				if (data) return data;
				return { ok: false, error: `HTTP ${response.status}` };
			} catch (error) {
				return { ok: false, error: String(error instanceof Error ? error.message : error) };
			}
		}

		// ── 样式只拉一次 ──
		let cssPromise = null;
		function useCss() {
			const [css, setCss] = react.useState(null);
			react.useEffect(() => {
				let alive = true;
				cssPromise ??= fetch(`${API}/ui/panel.css`).then((r) => (r.ok ? r.text() : "")).catch(() => "");
				cssPromise.then((text) => { if (alive) setCss(text); if (text === "") cssPromise = null; });
				return () => { alive = false; };
			}, []);
			return css;
		}

		// ── 控件 ──
		function Switch({ checked, onChange, label, disabled }) {
			return h("button", { type: "button", role: "switch", "aria-checked": checked === true, "aria-label": label, disabled, className: "tt-switch", onClick: () => onChange(!checked) },
				h("span", { className: "tt-switch-thumb" }));
		}
		const Button = ({ variant, children, ...props }) => h("button", { type: "button", ...props, className: cx("tt-btn", variant) }, children);
		const Input = (props) => h("input", { spellCheck: false, autoComplete: "off", ...props, className: cx("tt-input", props.className) });
		const Num = (props) => h("input", { type: "number", inputMode: "numeric", ...props, className: "tt-input num" });
		const Dot = (state) => state === "ongoing"
			? h("svg", { className: "tt-spin", width: 14, height: 14, viewBox: "0 0 24 24", "aria-hidden": true },
				h("g", null, h("circle", { cx: 12, cy: 12, r: 9.5 }), h("circle", { cx: 12, cy: 12, r: 9.5 })))
			: h("span", { className: "tt-dot", "data-state": state, "aria-hidden": true });
		const State = (state, text, title) => h("span", { className: "tt-state", "data-state": state, title: title ?? text, role: "status" }, Dot(state), h("span", null, text));
		const Tag = (text, tone) => h("span", { className: "tt-tag", "data-tone": tone }, text);
		function Row({ title, desc, stack, children }) {
			return h("div", { className: cx("tt-row", stack && "stack") },
				h("div", { className: "tt-row-title" }, h("span", null, title), desc ? h("span", { className: "tt-row-desc" }, desc) : null),
				h("div", { className: "tt-ctl" }, children));
		}
		function Group({ title, children }) {
			return h("section", { className: "tt-group" }, title ? h("h3", { className: "tt-group-head" }, h("span", null, title)) : null, children);
		}

		const fmtClock = (ms) => {
			if (typeof ms !== "number" || !Number.isFinite(ms)) return "--:--";
			const d = new Date(ms);
			const p = (n) => String(n).padStart(2, "0");
			return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
		};

		const draftModeLabel = (d) => {
			if (d.kind === "article") {
				const st = d.style && d.style.length ? `｜文风：${d.style.join("、")}` : "";
				return d.generatedByAi === false
					? `（模型不可用，已改为素材整理稿｜据「${d.keyword}」${st}）`
					: `（模型据「${d.keyword}」撰写${st}）`;
			}
			if (d.kind === "keyword") return `（据关键词「${d.keyword}」的搜索结果整理）`;
			return "（据今日热榜）";
		};

		function HotList({ items }) {
			if (!items || !items.length) return h("p", { className: "tt-muted" }, "还没有数据，点上面的「立即获取当前热点」。");
			return h("ol", { className: "tt-list" }, items.map((it) => h("li", { key: it.rank ?? it.title, className: "tt-item" },
				h("span", { className: "tt-rank" }, it.rank ?? "·"),
				h("a", { className: "tt-title", href: it.url, target: "_blank", rel: "noreferrer" }, it.title),
				h("span", { className: "tt-hot" }, it.hotText),
				it.labelCn ? Tag(it.labelCn, "hot") : null)));
		}

		function SearchList({ kw, items }) {
			if (!items || !items.length) return h("p", { className: "tt-muted" }, `「${kw}」没有结果。`);
			return h("div", { className: "tt-cards" }, items.map((it, i) => h("div", { key: i, className: "tt-card" },
				h("a", { className: "tt-card-title", href: it.url, target: "_blank", rel: "noreferrer" }, it.title),
				it.abstract ? h("p", { className: "tt-card-abs" }, it.abstract) : null,
				h("div", { className: "tt-card-meta" }, [it.source, it.time].filter(Boolean).join(" · ")))));
		}

		function ToutiaoSection() {
			const css = useCss();
			const [cfg, setCfg] = react.useState(null);
			const [status, setStatus] = react.useState(null);
			const [hot, setHot] = react.useState(null);
			const [hotAt, setHotAt] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const [search, setSearch] = react.useState(null);
			const [kwInput, setKwInput] = react.useState("");
			const [draftKw, setDraftKw] = react.useState("");
			const [draftStyle, setDraftStyle] = react.useState("");
			const [toast, setToast] = react.useState(null);
			const [draftText, setDraftText] = react.useState(null);

			const notify = (text) => { setToast({ text, key: Date.now() }); setTimeout(() => setToast(null), 2600); };

			const loadState = async () => {
				const r = await api("GET", "/state");
				if (r.ok) { setCfg(r.config || {}); setStatus(r.status || null); }
			};
			react.useEffect(() => { loadState(); }, []);

			const patch = async (p) => {
				const r = await api("POST", "/config", p);
				if (r.ok) { setCfg(r.config || {}); notify("已保存"); } else notify(r.error || "保存失败");
			};

			const fetchHot = async () => {
				setBusy(true);
				const r = await api("POST", "/fetch-hot", {});
				setBusy(false);
				if (r.ok) { setHot(r.items); setHotAt(r.at); if (r.stats) setStatus((s) => ({ ...(s || {}), ...r.stats })); }
				else notify(r.error || "抓取失败");
			};

			const doSearch = async () => {
				const kw = kwInput.trim();
				if (!kw) return;
				setBusy(true);
				const r = await api("POST", "/search", { keyword: kw });
				setBusy(false);
				if (r.ok) { setSearch({ kw, items: r.items }); setDraftKw(kw); }
				else notify(r.error || "搜索失败");
			};

			const makeDraft = async () => {
				setBusy(true);
				// 优先用草稿关键词框（默认取刚搜过的关键词 / 配置关键词），据它出稿；
				// 留空则据热榜出稿。
				const kw = String(draftKw || "").trim();
				const style = String(draftStyle || "").trim();
				const body = kw
					? { keyword: kw, style, topN: cfg?.digestTop }
					: { keywords: Array.isArray(cfg?.keywords) ? cfg.keywords.join(",") : cfg?.keywords || "", topN: cfg?.digestTop };
				const r = await api("POST", "/draft", body);
				setBusy(false);
				if (r.ok) { setDraftText(r.draft); notify(kw ? `已据「${kw}」出稿` : "已据热榜出稿"); }
				else notify(r.error || "生成失败");
			};

			if (css === null) return null;
			if (cfg === null) {
				return h("div", { className: "tt" },
					css === "" ? null : h("style", { "data-plugin-css": `${PLUGIN_ID}/panel.css` }, css),
					h("p", { className: "tt-muted" }, "加载中…"));
			}

			const schedule = cfg.schedule || {};

			return h("div", { className: "tt" },
				css === "" ? null : h("style", { "data-plugin-css": `${PLUGIN_ID}/panel.css` }, css),

				h(Group, { title: "采集设置" },
					h(Row, { title: "热点条数", desc: "热榜默认取前几条（1~50）" },
						h(Num, { value: cfg.hotLimit ?? 20, min: 1, max: 50, onChange: (e) => setCfg({ ...cfg, hotLimit: Number(e.target.value) }), onBlur: (e) => patch({ hotLimit: Number(e.target.value) }) })),
					h(Row, { title: "搜索条数", desc: "每个关键词返回几条（1~30）" },
						h(Num, { value: cfg.searchLimit ?? 12, min: 1, max: 30, onChange: (e) => setCfg({ ...cfg, searchLimit: Number(e.target.value) }), onBlur: (e) => patch({ searchLimit: Number(e.target.value) }) })),
					h(Row, { title: "关注关键词", desc: "逗号分隔，日报 / 搜索会用到", stack: true },
						h(Input, { value: Array.isArray(cfg.keywords) ? cfg.keywords.join(", ") : cfg.keywords || "", placeholder: "例如：羽绒服涨价, 国足",
							onChange: (e) => setCfg({ ...cfg, keywords: e.target.value }), onBlur: (e) => patch({ keywords: String(e.target.value).split(/[,，、]/).map((s) => s.trim()).filter(Boolean) }) })),
					h(Row, { title: "附带全文", desc: "每条热点 / 搜索结果都抓好正文" },
						h(Switch, { checked: cfg.withFullText === true, label: "附带全文", onChange: (v) => patch({ withFullText: v }) })),
					h(Row, { title: "写草稿", desc: "抓取后据搜索结果帮你写一篇发布草稿" },
						h(Switch, { checked: cfg.autoDraft === true, label: "写草稿", onChange: (v) => patch({ autoDraft: v }) }))),

				h(Group, { title: "定时获取" },
					h(Row, { title: "启用定时抓取", desc: schedule.enabled ? "开着，到点自动抓热榜" : "关着" },
						h(Switch, { checked: schedule.enabled === true, label: "启用定时抓取", onChange: (v) => patch({ schedule: { ...schedule, enabled: v } }) })),
					h(Row, { title: "间隔（分钟）", desc: "5~1440 分钟" },
						h(Num, { value: schedule.intervalMinutes ?? 60, min: 5, max: 1440, disabled: !schedule.enabled,
							onChange: (e) => setCfg({ ...cfg, schedule: { ...schedule, intervalMinutes: Number(e.target.value) } }),
							onBlur: (e) => patch({ schedule: { ...schedule, intervalMinutes: Number(e.target.value) } }) }))),

				h(Group, { title: "立即获取" },
					h(Row, { title: "当前热点新闻", desc: hotAt ? `上次：${fmtClock(hotAt)}` : "点一下抓一次热榜" },
						h(Button, { variant: "primary", disabled: busy, onClick: fetchHot }, busy ? "抓取中…" : "立即获取当前热点")),
					hot ? h(HotList, { items: hot }) : null),

				h(Group, { title: "关键词搜索" },
					h(Row, { title: "搜一条看看", stack: true },
						h(Input, { value: kwInput, placeholder: "输入关键词，如 BLG夺冠", onChange: (e) => setKwInput(e.target.value), onKeyDown: (e) => { if (e.key === "Enter") doSearch(); } }),
						h(Button, { disabled: busy || !kwInput.trim(), onClick: doSearch }, "搜索")),
					search ? h("div", null, h("h4", { className: "tt-sub" }, `「${search.kw}」`), h(SearchList, { kw: search.kw, items: search.items })) : null),

				h(Group, { title: "生成发布草稿" },
					h(Row, { title: "按关键词写文章", desc: draftKw ? `将据「${draftKw}」的搜索结果，写一篇可发布的文章` : "留空则据热榜出稿", stack: true },
						h(Input, { value: draftKw, placeholder: "输入要写的关键词（如 BLG夺冠），留空则用热榜", onChange: (e) => setDraftKw(e.target.value) })),
					h(Row, { title: "风格 / 角度（可选）", desc: "控制文风，如：热血、理性分析、幽默、专业评测", stack: true },
						h(Input, { value: draftStyle, placeholder: "例如：热血、理性分析、带点幽默（留空则自然文风）", onChange: (e) => setDraftStyle(e.target.value) })),
					h("div", { className: "tt-row-actions" },
						h(Button, { disabled: busy, onClick: makeDraft }, busy ? "生成中…" : (draftKw.trim() ? `据「${draftKw.trim()}」写文章` : "据热榜生成草稿"))),
					draftText ? h("div", { className: "tt-draft" },
						h("div", { className: "tt-draft-title" }, draftText.title),
						h("p", { className: "tt-muted" }, draftModeLabel(draftText) + (draftText.summary || "")),
						h("div", { className: "tt-draft-tags" }, (draftText.tags || []).map((t, i) => h(react.Fragment, { key: i }, Tag("#" + t, "tag")))),
						draftText.bodyText ? h("details", { className: "tt-draft-full" },
							h("summary", null, "查看正文"),
							(draftText.bodyText || "").split(/\n{2,}/).filter(Boolean).map((p, i) => h("p", { key: i }, p))) : null,
						draftText.previewPath ? h("p", { className: "tt-muted" }, "预览页：" + draftText.previewPath) : null) : null),

				toast ? h("div", { className: "tt-toast", role: "status", key: toast.key }, toast.text) : null);
		}

		function apply(ctx) {
			ctx.effect(() => ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "dsh-toutiao",
				order: 62,
				label: () => "头条热点"
			}, ToutiaoSection)), `${PLUGIN_ID}: panel`);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
