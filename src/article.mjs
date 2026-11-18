/**
 * article.mjs —— 今日头条文章全文。
 *
 * 桌面版 www.toutiao.com/article/<id>/ 是字节风控壳（byted_acrawler，无正文）。
 * 手机版 m.toutiao.com/group/<id>/ (或 /article/<id>/) 的 RENDER_DATA 里带全文：
 *   window RENDER_DATA → { articleInfo: { title, source, publishTime, content: '<p>…</p>' } }
 * 免登录、免签名。
 */

import { fetchText, htmlToText, UA_MOBILE } from './http.mjs';

const isId = (s) => /^\d{8,}$/.test(String(s).trim());

/** 从各种输入里取 article/group id。 */
export function extractId(input) {
  const s = String(input || '').trim();
  if (isId(s)) return s;
  const m = s.match(/\/(?:article|group|trending|w)\/(\d+)/) || s.match(/[?&](?:group_id|item_id)=(\d+)/);
  return m ? m[1] : '';
}

function formatTime(v) {
  if (v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1e9) return String(v);
  const d = new Date(n * (n < 1e12 ? 1000 : 1));
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderData(html) {
  const m = html.match(/id="RENDER_DATA"[^>]*>([^<]+)</);
  if (!m) return null;
  try {
    return JSON.parse(decodeURIComponent(m[1]));
  } catch {
    return null;
  }
}

/**
 * 抓正文。
 * @param {string} input id 或 URL
 * @returns {Promise<{id:string,title:string,source:string,publishTime:string,html:string,text:string,images:string[],url:string}>}
 */
export async function getArticle(input) {
  const id = extractId(input);
  if (!id) throw new Error(`无法从 "${input}" 解析出文章 id`);

  const candidates = [
    `https://m.toutiao.com/group/${id}/`,
    `https://m.toutiao.com/article/${id}/`,
    `https://www.toutiao.com/w/${id}/`,
  ];

  let lastErr;
  for (const url of candidates) {
    try {
      const html = await fetchText(url, { ua: UA_MOBILE });
      const data = renderData(html);
      const info = data?.articleInfo || data?.thread || data?.article || null;
      const content = info?.content || info?.contentHtml || '';
      if (!content) {
        lastErr = new Error(`${url} 没有 RENDER_DATA 正文（可能是集群页或风控壳）`);
        continue;
      }
      const images = [...String(content).matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]);
      return {
        id,
        title: String(info.title || '').trim(),
        source: String(info.source || '').trim(),
        publishTime: formatTime(info.publishTime ?? info.createTime),
        html: String(content),
        text: htmlToText(content),
        images,
        url,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
