// test/syntax.mjs —— 冒烟：模块能 import、apply(ctx) 能在 stub ctx 上跑通、路由可应答。
// 用 stub 替代宿主（webServer/tools/provide/effect），只验证插件自身装配逻辑。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert';

// 用临时 DSH_HOME，避免污染真实配置
const home = mkdtempSync(join(tmpdir(), 'dsh-toutiao-test-'));
process.env.DSH_HOME = home;

const tools = [];
let routeHandler = null;
let provided = null;

const ctx = {
  logger: () => () => {},
  effect(fn) { const d = fn(); if (typeof d === 'function') d(); },
  provide(name, obj) { provided = { name, obj }; },
  tools: { register(tool) { tools.push(tool); return () => {}; } },
  webServer: { register({ handler }) { routeHandler = handler; return () => {}; } },
};

const mod = await import('../lib/index.js');
assert.equal(mod.name, 'dsh-toutiao');
assert.ok(Array.isArray(mod.inject));
assert.ok(typeof mod.apply === 'function');

await mod.apply(ctx, {});

assert.equal(tools.length, 5, '应注册 5 个工具');
const names = tools.map((t) => t.name).sort();
assert.deepEqual(names, ['toutiao_article', 'toutiao_digest', 'toutiao_draft', 'toutiao_hot', 'toutiao_search']);
assert.ok(routeHandler, '应挂上路由');
assert.equal(provided?.name, 'toutiao', '应 provide toutiao 服务');
for (const k of ['getHot', 'search', 'getArticle', 'getDigest', 'getDraft', 'status']) {
  assert.equal(typeof provided.obj[k], 'function', `服务缺 ${k}`);
}

// 路由 GET /state
function mockRes() {
  const out = { code: 0, headers: null, body: '' };
  return {
    writeHead(c, hd) { out.code = c; out.headers = hd; },
    end(b) { out.body = b; },
    _out: out,
  };
}
const req = { method: 'GET', url: '/api/plugins/dsh-toutiao/state', headers: {} };
const res = mockRes();
await routeHandler(req, res);
const state = JSON.parse(res._out.body);
assert.equal(state.ok, true);
assert.ok(state.config && typeof state.config === 'object');
// 是否带 hotLimit 取决于宿主是否提供 schemastery（z!==null）。独立测试环境 z 可能为 null，
// 真实宿主用 z 的 default 值时才有 hotLimit 默认值——两条都接受。
if (mod.Config !== undefined) {
  assert.ok(state.config.hotLimit, 'z 可用时 state 应带 config.hotLimit 默认值');
}

// 工具 execute 快速跑一下（联网），验证返回字符串或错误信息
const hotTool = tools.find((t) => t.name === 'toutiao_hot');
const hotText = await hotTool.execute({ limit: 3 }, {});
assert.equal(typeof hotText, 'string');
assert.ok(hotText.includes('今日头条热榜'), '热度工具应返回中文结果，实际：' + hotText.slice(0, 120));

console.log('OK: 5 tools, routes, provide, state, hot tool');
console.log('HOT sample:', hotText.slice(0, 160).replace(/\n/g, ' '));

rmSync(home, { recursive: true, force: true });
