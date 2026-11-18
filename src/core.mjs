/**
 * core.mjs —— 对上（工具 / HTTP 路由 / 跨插件服务）统一的业务入口。
 *
 * 把 hot / search / article / digest / draft 这几块收成一个稳定的小接口，
 * 并带上「一次抓取」的缓存与并发去重——设置页的"立即获取当前热点"、
 * 定时任务、模型工具都会打到这里，避免重复雷同请求把风控惹毛。
 */

import { hotBoard, hotStats } from './hot.mjs';
import { searchKeyword } from './search.mjs';
import { getArticle } from './article.mjs';
import { buildDigest, abstractForHot, fullTextFor } from './digest.mjs';
import {
  buildDraft,
  buildKeywordDraft,
  buildArticlePrompt,
  buildArticleDraft,
  renderDraftPage,
  clampTitle,
} from './draft.mjs';

export {
  hotBoard,
  hotStats,
  searchKeyword,
  getArticle,
  buildDigest,
  buildDraft,
  buildKeywordDraft,
  buildArticlePrompt,
  buildArticleDraft,
  renderDraftPage,
  clampTitle,
  abstractForHot,
  fullTextFor,
};

/** 简单 TTL 缓存：key -> { at, value }。热榜这类高频同源请求就靠它。 */
function makeTtl(ttlMs) {
  const map = new Map();
  return {
    async get(key, produce) {
      const hit = map.get(key);
      if (hit && Date.now() - hit.at < ttlMs) return { value: hit.value, cached: true };
      const value = await produce();
      map.set(key, { at: Date.now(), value });
      return { value, cached: false };
    },
    clear() {
      map.clear();
    },
  };
}

/**
 * @param {object} opts
 * @param {() => object} opts.getConfig 读当前配置（settings + config.json 合并后）
 */
export function createCore({ getConfig, log = () => {}, llm = null } = {}) {
  const hotCache = makeTtl(90_000); // 热榜 90 秒内复用
  const searchCache = makeTtl(90_000);
  /** 最近一次抓到的热榜（给"状态"面板和定时任务用，不受 TTL 影响） */
  let lastHot = null;
  let lastHotAt = 0;

  const cfg = () => {
    const c = getConfig?.() ?? {};
    return {
      hotLimit: clampInt(c.hotLimit, 1, 50, 20),
      searchLimit: clampInt(c.searchLimit, 1, 30, 12),
      keywords: normKeywords(c.keywords),
      digestTop: clampInt(c.digestTop, 1, 30, 10),
      perKeyword: clampInt(c.perKeyword, 1, 10, 5),
      withFullText: c.withFullText === true,
      autoDraft: c.autoDraft === true,
    };
  };

  /** 热榜（带缓存 + 记录 lastHot）。 */
  async function getHot({ limit } = {}) {
    const lim = clampInt(limit, 1, 50, cfg().hotLimit);
    const { value, cached } = await hotCache.get(`hot:${lim}`, () => hotBoard({ limit: lim }));
    lastHot = value;
    lastHotAt = Date.now();
    return { items: value, stats: hotStats(value), cached };
  }

  /** 关键词搜索（带缓存）。 */
  async function search(keyword, { limit } = {}) {
    const kw = String(keyword || '').trim();
    if (!kw) throw new Error('关键词为空');
    const lim = clampInt(limit, 1, 30, cfg().searchLimit);
    const { value, cached } = await searchCache.get(`kw:${kw}:${lim}`, () => searchKeyword(kw, { limit: lim }));
    return { ...value, cached };
  }

  /** 读全文。 */
  async function article(idOrUrl) {
    return getArticle(idOrUrl);
  }

  /** 生成日报式素材（热榜 + 每条摘要 + 关键词）。 */
  async function digest(opts = {}) {
    const c = cfg();
    return buildDigest({
      top: clampInt(opts.top, 1, 30, c.digestTop),
      keywords: Array.isArray(opts.keywords) ? opts.keywords : c.keywords,
      perKeyword: clampInt(opts.perKeyword, 1, 10, c.perKeyword),
      withAbstract: opts.withAbstract !== false,
      withFullText: opts.withFullText === true || c.withFullText,
    });
  }

  /**
   * 生成发布草稿。
   *
   *  - 传了 keyword（用户搜过/输入的关键词）→ 据**该关键词的搜索结果**写一篇**可发布的文章**
   *    （介绍事情经过 + 背景 + 观察思考，而不再是罗列统计）。优先用宿主模型来写；
   *    模型不可用 / 失败时退回"素材整理式"关键词草稿，并在结果里标注 ai=false 让界面提示。
   *  - 没传关键词 → 走热榜日报草稿（默认）。
   *
   * @param {{keyword?: string, keywords?: string[], style?: string|string[], topN?: number, withFullText?: boolean}} opts
   */
  async function draft(opts = {}) {
    const keyword = typeof opts.keyword === 'string' ? opts.keyword.trim() : '';
    const topN = clampInt(opts.topN, 1, 20, cfg().digestTop);
    const style = normKeywords(opts.style);

    if (keyword) {
      // 拿这个关键词的真实搜索结果（文章写作需要些细节，默认多抓一点、尽量带全文摘要）
      const found = await search(keyword, { limit: Math.max(topN, 10) });
      const items = found.items || [];
      if (opts.withFullText) {
        for (const it of items) {
          try {
            it.fullText = await fullTextFor(it);
          } catch {
            /* 单个失败不影响整体 */
          }
        }
      }

      // 1) 优先：用宿主模型写整篇文章
      if (llm && typeof llm.complete === 'function') {
        try {
          const prompt = buildArticlePrompt(keyword, items, { style, topN });
          const articleBody = await llm.complete(prompt, { maxTokens: 2000, temperature: 0.85 });
          if (articleBody && articleBody.trim()) {
            const d = buildArticleDraft(keyword, items, {
              articleBody,
              style,
              topN,
              generatedByAi: true,
            });
            d.html = renderDraftPage(d);
            return d;
          }
          log?.('模型没返回正文，退回素材式草稿');
        } catch (e) {
          log?.(`模型写稿失败，退回素材式草稿：${e?.message ?? e}`);
        }
      }

      // 2) 兜底：素材整理式（老逻辑），标注 ai=false
      const d = buildKeywordDraft(keyword, items, { topN });
      d.generatedByAi = false;
      if (style.length) d.style = style;
      d.html = renderDraftPage(d);
      return d;
    }

    const dig = opts.digest ?? (await digest({ keywords: opts.keywords, withFullText: opts.withFullText }));
    const d = buildDraft(dig, { topN });
    d.html = renderDraftPage(d);
    return d;
  }

  function status() {
    return { lastHotAt, lastHotCount: lastHot?.length ?? 0, config: cfg() };
  }

  return { getHot, search, article, digest, draft, status, clearCache: () => { hotCache.clear(); searchCache.clear(); } };
}

function clampInt(v, min, max, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** 关键词接受数组或逗号 / 顿号 / 换行分隔的字符串。 */
function normKeywords(v) {
  if (Array.isArray(v)) return v.map((s) => String(s).trim()).filter(Boolean);
  if (typeof v === 'string') {
    return v
      .split(/[,，、\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}
