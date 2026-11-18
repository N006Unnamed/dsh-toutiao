/**
 * search.mjs —— 今日头条关键词搜索（服务端渲染页面解析，无需签名 / Cookie）。
 *
 * 页面：https://so.toutiao.com/search?keyword=<kw>&pd=information
 * 结果卡片以 <div class="result-content" cr-params="{...}"> 内嵌，卡内：
 *   - 标题      .l-card-title
 *   - 摘要      .l-paragraph (line-clamp-2，约 100~200 字)
 *   - 来源/时间 .l-source-text / .t3
 * 每张卡只有一个 groupId（gid），正文链接为 https://www.toutiao.com/group/<gid>/
 */

import { fetchText, decodeEntities, htmlToText } from './http.mjs';

const BASE = 'https://so.toutiao.com/search';
const CARD_MARK = '<div class="result-content"';

const stripTags = (s) =>
  htmlToText(String(s).replace(/<em>/g, '<span>').replace(/<\/em>/g, '</span>'));

function pick(html, re) {
  const m = html.match(re);
  return m ? stripTags(m[1]).trim() : '';
}

/**
 * 解析搜索页 HTML → 结果数组。
 * @param {string} html
 * @param {{limit?: number}} [opts]
 */
export function parseSearchPage(html, { limit = 20 } = {}) {
  const starts = [...html.matchAll(new RegExp(CARD_MARK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map(
    (m) => m.index,
  );
  const out = [];
  const seen = new Set();
  const seenTitles = new Set();

  for (let i = 0; i < starts.length; i++) {
    const card = html.slice(starts[i], starts[i + 1] ?? starts[i] + 20000);
    const metaRaw = card.match(/cr-params="([^"]*)"/);
    if (!metaRaw) continue;

    let meta;
    try {
      meta = JSON.parse(decodeEntities(metaRaw[1]));
    } catch {
      continue;
    }
    // 只保留普通文章卡；视频聚合卡（cell_type=26）、广告等都跳过
    if (meta.ala_src && meta.ala_src !== 'default') continue;
    const gid = String(meta.gid || meta.search_result_id || '').trim();
    if (!/^\d+$/.test(gid) || seen.has(gid)) continue;
    seen.add(gid);

    const title = pick(card, /class="[^"]*l-card-title[^"]*"[^>]*>([\s\S]*?)<\/a>/);
    const abstract = pick(card, /class="[^"]*l-paragraph[^"]*"[^>]*>([\s\S]*?)<\/div>/);

    // 来源/时间在 card-footer 里，形如「13图 上观新闻 2025年11月30日」
    const footerIdx = card.indexOf('l-card-footer');
    const footerTagEnd = footerIdx >= 0 ? card.indexOf('>', footerIdx) : -1;
    const footerText =
      footerTagEnd >= 0 ? htmlToText(card.slice(footerTagEnd + 1)).replace(/\s+/g, ' ').trim().slice(0, 120) : '';
    const timeM = footerText.match(
      /\d{4}年\d{1,2}月\d{1,2}日(?:\s*\d{1,2}:\d{2})?|\d+\s*(?:分钟|小时|天)前|刚刚/,
    );
    const time = timeM ? timeM[0] : '';
    const source = (timeM ? footerText.slice(0, timeM.index) : footerText)
      .replace(/\d+\s*图\s*/g, '')
      .trim()
      .slice(0, 24);

    if (!title) continue;
    // 过滤微头条式噪声：标题太短（如「羽绒服」两个字的 UGC 帖）或重复标题
    const titleKey = title.replace(/\s+/g, '');
    if (titleKey.length < 8) continue;
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    out.push({
      gid,
      title,
      abstract,
      source,
      time,
      url: `https://www.toutiao.com/group/${gid}/`,
      mobileUrl: `https://m.toutiao.com/group/${gid}/`,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * @param {string} keyword
 * @param {{limit?: number, pd?: string}} [opts]
 */
export async function searchKeyword(keyword, { limit = 12, pd = 'information' } = {}) {
  const url = `${BASE}?keyword=${encodeURIComponent(keyword)}&pd=${pd}`;
  const html = await fetchText(url, {});
  const items = parseSearchPage(html, { limit });
  return { keyword, url, items };
}
