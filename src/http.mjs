/**
 * http.mjs —— 极简 HTTP 客户端：统一 UA、超时、重试、限速。
 * 为什么不用 curl / PowerShell：本机 pwsh 走 HTTPS 会报 curl exit 35，而 Node 的 fetch 正常。
 */

export const UA_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
export const UA_MOBILE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 全局最小请求间隔，避免打得太快被风控。 */
let lastAt = 0;
const MIN_INTERVAL_MS = 700;
async function pace() {
  const wait = lastAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastAt = Date.now();
}

/**
 * 抓一个页面/接口，返回字符串。
 * @param {string} url
 * @param {{ua?: string, timeout?: number, retries?: number}} [opts]
 */
export async function fetchText(url, opts = {}) {
  const { ua = UA_DESKTOP, timeout = 20000, retries = 2 } = opts;
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await pace();
    try {
      const res = await fetch(url, {
        headers: {
          'user-agent': ua,
          'accept-language': 'zh-CN,zh;q=0.9',
          accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        },
        signal: AbortSignal.timeout(timeout),
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(800 * (attempt + 1));
    }
  }
  throw lastErr;
}

/** 抓 JSON。 */
export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, opts);
  return JSON.parse(text);
}

/** HTML 实体还原（搜索页把 JSON 嵌在属性里，转义得很重）。 */
export function decodeEntities(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** 去标签 + 压缩空白。 */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, n) => {
      try {
        return String.fromCodePoint(Number(n));
      } catch {
        return '';
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => {
      try {
        return String.fromCodePoint(parseInt(n, 16));
      } catch {
        return '';
      }
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 热度值格式化：12868227 → 1286.8万 */
export function formatHot(n) {
  const v = Number(n) || 0;
  if (v >= 1e8) return `${(v / 1e8).toFixed(2)}亿`;
  if (v >= 1e4) return `${(v / 1e4).toFixed(1)}万`;
  return String(v);
}
