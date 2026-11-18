/**
 * routes.mjs —— 设置面板 / 立即抓取用的 HTTP 路由（prefix: /api/plugins/dsh-toutiao）。
 *
 * 契约：
 *   GET  /state            → { ok, config, status }（config 去掉敏感项后全给）
 *   POST /config           → 保存设置（sameOrigin 校验）
 *   POST /fetch-hot        → 立即抓一次热榜，返回 { ok, items, stats, at }
 *   POST /search           → { keyword, limit } → 搜索结果
 *   POST /article          → { id } → 全文
 *   POST /draft            → { keywords, topN } → 草稿（含 html）
 *   GET  /ui/panel.css     → 面板样式
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolveBody(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const headers = req.headers ?? {};
  const hasFetchSite = headers['sec-fetch-site'] !== undefined;
  if (!hasFetchSite) return true; // 非浏览器客户端不校验
  return headers['sec-fetch-site'] === 'same-origin' || headers['sec-fetch-site'] === 'none';
}

export function createRoutes({ getConfig, saveConfig, core, log, uiDir }) {
  const logger = log ?? (() => {});
  return async function handler(req, res) {
    const send = (code, obj) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname.replace('/api/plugins/dsh-toutiao', '') || '/';
      const method = req.method ?? 'GET';

      if (method === 'GET' && path === '/ui/panel.css') {
        res.writeHead(200, { 'content-type': 'text/css; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(readFileSync(join(uiDir, 'panel.css'), 'utf8'));
        return;
      }

      if (method === 'GET' && path === '/state') {
        return send(200, { ok: true, config: getConfig(), status: core.status() });
      }

      if (method === 'POST' && path === '/config') {
        if (!sameOrigin(req)) return send(403, { ok: false, error: 'forbidden' });
        const body = JSON.parse((await readBody(req)) || '{}');
        const allowed = ['hotLimit', 'searchLimit', 'keywords', 'digestTop', 'perKeyword', 'withFullText', 'autoDraft', 'schedule'];
        const patch = {};
        for (const k of allowed) if (body[k] !== undefined) patch[k] = body[k];
        const next = saveConfig(patch);
        return send(200, { ok: true, config: next });
      }

      if (method === 'POST' && path === '/fetch-hot') {
        if (!sameOrigin(req)) return send(403, { ok: false, error: 'forbidden' });
        const body = JSON.parse((await readBody(req)) || '{}');
        const { items, stats, cached } = await core.getHot({ limit: body.limit });
        return send(200, { ok: true, items, stats, cached, at: Date.now() });
      }

      if (method === 'POST' && path === '/search') {
        if (!sameOrigin(req)) return send(403, { ok: false, error: 'forbidden' });
        const body = JSON.parse((await readBody(req)) || '{}');
        const res2 = await core.search(body.keyword, { limit: body.limit });
        return send(200, { ok: true, keyword: res2.keyword, items: res2.items, cached: res2.cached });
      }

      if (method === 'POST' && path === '/article') {
        if (!sameOrigin(req)) return send(403, { ok: false, error: 'forbidden' });
        const body = JSON.parse((await readBody(req)) || '{}');
        const a = await core.article(body.id);
        return send(200, { ok: true, article: a });
      }

      if (method === 'POST' && path === '/draft') {
        if (!sameOrigin(req)) return send(403, { ok: false, error: 'forbidden' });
        const body = JSON.parse((await readBody(req)) || '{}');
        const kws = body.keywords ? String(body.keywords).split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : undefined;
        const keyword = body.keyword ? String(body.keyword).trim() : '';
        const style = body.style != null ? body.style : undefined;
        const d = await core.draft({ keyword, keywords: kws, style, topN: body.topN, withFullText: body.withFullText });
        return send(200, { ok: true, draft: d });
      }

      return send(404, { ok: false, error: 'not found' });
    } catch (error) {
      logger(`路由异常：${String(error instanceof Error ? error.message : error)}`);
      return send(200, { ok: false, error: String(error instanceof Error ? error.message : error) });
    }
  };
}
