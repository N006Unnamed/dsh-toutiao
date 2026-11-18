/**
 * dsh-toutiao —— 今日头条热点 / 关键词搜索 / 半自动发布草稿（DSH 插件）。
 *
 * 纯 HTTP 采集：热榜 hot-board、搜索 SSR 页、正文走手机版 RENDER_DATA，全程免登录、免签名。
 * 对外提供三样东西：
 *   ① 模型工具：toutiao_hot / toutiao_search / toutiao_article / toutiao_digest / toutiao_draft
 *   ② 跨插件服务：ctx.provide('toutiao', { getHot, search, getArticle, getDigest, getDraft })
 *   ③ 设置面板：Web UI「设置 → 头条热点」卡片（client.js 注册到 settings.section），
 *      含可配置项（搜索条数 / 关键词 / 是否写草稿…）、「立即获取当前热点」、定时抓取。
 *
 * 依赖解析走 hostdeps 模式（桌面 profile 不装 optional peer，裸 import 会让整条插件不激活）。
 */
import { readFileSync, writeFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

import { loadHostDeps } from './hostdeps.mjs';
import { createCore } from '../src/core.mjs';
import { createRoutes } from './routes.mjs';
import { createLlm } from './llm.mjs';
import { toutiaoConfigSchema } from './config-schema.mjs';

const PLUGIN_ID = 'dsh-toutiao';
const PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const hostDeps = await loadHostDeps();
const z = hostDeps.z;
const defineTool = hostDeps.defineTool;

export const name = PLUGIN_ID;
// webServer：HTTP 路由（设置面板读写 / 立即抓取）；tools：注册模型工具；llm/agentDefaultModel：生成草稿时用宿主模型写文章。
export const inject = ['webServer', 'tools', 'llm'];
export const optional = ['agentDefaultModel'];

// schemastery 彻底拿不到时省略 Config（插件照常加载，设置页用文件配置兜底）。
export const Config = z === null ? undefined : toutiaoConfigSchema(z);

/** diff 深合并（同 fish-soul：数组整体覆盖，undefined 不覆盖）。 */
function deepMerge(base, over) {
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(base)) return isObj(over) ? { ...over } : over === undefined ? base : over;
  const out = { ...base };
  if (!isObj(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v === undefined) continue;
    out[k] = isObj(v) && isObj(out[k]) ? deepMerge(out[k], v) : v;
  }
  return out;
}

/** 配置持久化目录：$DSH_HOME/dsh-toutiao/config.json（去 BOM、临时文件改名写）。 */
function configPath() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh');
  return join(home, PLUGIN_ID, 'config.json');
}

function readConfigFile(path = configPath()) {
  if (!existsSync(path)) return { ok: true, value: {} };
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    return { ok: false, error: String(error) };
  }
  text = text.replace(/^\uFEFF/, '');
  if (text.trim() === '') return { ok: true, value: {} };
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '最外层不是 {}' };
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function saveConfigFile(patch, path = configPath()) {
  const cur = readConfigFile(path);
  if (!cur.ok) throw new Error(`${PLUGIN_ID} 配置格式不对，没保存（${cur.error}）。先把文件改对（或删掉）再设置`);
  const next = deepMerge(cur.value, patch);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  renameSync(tmp, path);
  return next;
}

/** 把扁平参数描述转成标准 JSON Schema（宿主 defineTool 校验 additionalProperties）。 */
function objectSchema(props) {
  const properties = {};
  const required = [];
  for (const [k, v] of Object.entries(props)) {
    const { required: req, ...rest } = v;
    properties[k] = rest;
    if (req === true) required.push(k);
  }
  return { type: 'object', properties, required, additionalProperties: false };
}

export async function apply(ctx, hostConfig) {
  const log = (msg) => {
    try {
      ctx.logger?.('info')?.('[dsh-toutiao]', String(msg));
    } catch {
      /* 宿主 logger 形态不一，失败就算了 */
    }
  };
  for (const n of hostDeps.notes) log(n);

  // 宿主 Config（cordis.yml 里给的值）作为底，文件配置覆盖其上
  const fileCfg = readConfigFile();
  let current = deepMerge(hostConfig ?? {}, fileCfg.ok ? fileCfg.value : {});

  const getConfig = () => current;
  const saveConfig = (patch) => {
    current = deepMerge(current, patch);
    try {
      saveConfigFile(patch);
    } catch (e) {
      log(`保存配置失败：${e?.message ?? e}`);
      throw e;
    }
    reschedule();
    return current;
  };

  const core = createCore({ getConfig, log, llm: createLlm({ ctx, log }) });

  // ── 定时抓取 ──
  let timer = null;
  function stopTimer() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }
  function reschedule() {
    stopTimer();
    const sched = current.schedule ?? {};
    if (!sched.enabled) return;
    const minutes = Math.min(1440, Math.max(5, Number(sched.intervalMinutes) || 60));
    timer = setInterval(async () => {
      try {
        const { items } = await core.getHot();
        log(`定时抓取热榜完成：${items.length} 条`);
        if (typeof sched.onFetched === 'function') sched.onFetched(items);
      } catch (e) {
        log(`定时抓取失败：${e?.message ?? e}`);
      }
    }, minutes * 60_000);
    if (timer.unref) timer.unref();
    log(`已启用定时抓取：每 ${minutes} 分钟`);
  }
  ctx.effect(() => {
    reschedule();
    return () => stopTimer();
  }, 'dsh-toutiao: schedule');

  // ── HTTP 路由（设置面板）──
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: `/api/plugins/${PLUGIN_ID}`,
        handler: createRoutes({
          getConfig,
          saveConfig,
          core,
          log,
          uiDir: join(PLUGIN_DIR, 'lib'),
        }),
      }),
    'dsh-toutiao: api',
  );

  // ── 跨插件服务：别的插件 ctx.get('toutiao') 拿到这些 ──
  const service = {
    getHot: async (limit) => (await core.getHot({ limit })).items,
    search: async (keyword, limit) => (await core.search(keyword, { limit })).items,
    getArticle: async (id) => core.article(id),
    getDigest: async (opts) => core.digest(opts),
    getDraft: async (opts) => core.draft(opts),
    status: () => core.status(),
  };
  ctx.provide('toutiao', service);

  // ── 模型工具 ──
  const textOutput = {
    schema: { type: 'string' },
    render: (_args, value) => [{ type: 'text', text: String(value) }],
  };

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'toutiao_hot',
          description: '今日头条热榜（免登录）。返回当前热榜条目的标题、热度、标签与链接。',
          parameters: objectSchema({
            limit: { type: 'number', description: '返回条数，1~50，缺省用插件设置' },
          }),
          output: textOutput,
          async execute(args) {
            const { items, stats } = await core.getHot({ limit: args.limit });
            const lines = items.map(
              (it) => `${it.rank}. ${it.title} ｜ ${it.hotText}${it.labelCn ? ` · ${it.labelCn}` : ''} ｜ ${it.url}`,
            );
            return `今日头条热榜（${stats.count} 条，最高热度 ${stats.top?.hotText ?? '-'}）：\n${lines.join('\n')}`;
          },
        }),
        'dsh-toutiao: toutiao_hot',
      ),
  );

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'toutiao_search',
          description: '按关键词搜索今日头条新闻（免登录），返回标题、摘要、来源、时间与链接。',
          parameters: objectSchema({
            keyword: { type: 'string', required: true, description: '搜索关键词' },
            limit: { type: 'number', description: '返回条数，1~30，缺省用插件设置' },
          }),
          output: textOutput,
          async execute(args) {
            const res = await core.search(args.keyword, { limit: args.limit });
            if (!res.items.length) return `「${res.keyword}」这次没解析到结果（页面结构可能变了）。`;
            const lines = res.items.map((it, i) => {
              const meta = [it.source, it.time].filter(Boolean).join(' · ');
              const abs = it.abstract ? `\n   ${it.abstract}` : '';
              return `${i + 1}. ${it.title}${meta ? ` ｜ ${meta}` : ''}${abs}\n   ${it.url}`;
            });
            return `「${res.keyword}」搜索结果（${res.items.length} 条）：\n${lines.join('\n')}`;
          },
        }),
        'dsh-toutiao: toutiao_search',
      ),
  );

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'toutiao_article',
          description: '抓今日头条文章全文（走手机版 RENDER_DATA，免登录），返回标题、来源、正文。',
          parameters: objectSchema({
            id: { type: 'string', required: true, description: '文章 id 或 URL' },
          }),
          output: textOutput,
          async execute(args) {
            const a = await core.article(args.id);
            return `${a.title}\n来源：${a.source || '-'} ｜ 发布：${a.publishTime || '-'}\n\n${a.text}`;
          },
        }),
        'dsh-toutiao: toutiao_article',
      ),
  );

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'toutiao_digest',
          description: '生成今日头条热点日报素材（热榜 + 每条真实摘要 + 可选关键词观察）。',
          parameters: objectSchema({
            top: { type: 'number', description: '热榜取前几条，1~30，缺省用插件设置' },
            keywords: { type: 'string', description: '关键词，逗号分隔（留空用插件设置）' },
          }),
          output: textOutput,
          async execute(args) {
            const kws = args.keywords ? String(args.keywords).split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : undefined;
            const dig = await core.digest({ top: args.top, keywords: kws });
            return dig.markdown;
          },
        }),
        'dsh-toutiao: toutiao_digest',
      ),
  );

  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'toutiao_draft',
          description:
            '生成今日头条发布草稿（标题/摘要/正文/话题标签）。传 keyword 时，会据该关键词的搜索结果、调用模型写一篇可发布的文章（介绍事情经过+背景+观察思考）；还可传 style 控制文风/角度。不传 keyword 则据热榜出稿。发布仍由人来点。',
          parameters: objectSchema({
            keyword: { type: 'string', description: '据这个关键词的搜索结果写文章（推荐）；留空则用热榜' },
            style: { type: 'string', description: '控制文风/角度，逗号分隔，如：热血、理性分析、幽默（可留空）' },
            keywords: { type: 'string', description: '附加热榜日报的关键词观察，逗号分隔（可留空）' },
            topN: { type: 'number', description: '草稿参考资料取几条，缺省用插件设置' },
          }),
          output: textOutput,
          async execute(args) {
            const kws = args.keywords ? String(args.keywords).split(/[,，、]/).map((s) => s.trim()).filter(Boolean) : undefined;
            const d = await core.draft({ keyword: args.keyword, style: args.style, keywords: kws, topN: args.topN });
            const mode = d.kind === 'article' ? (d.generatedByAi ? '（模型撰写）' : '（素材整理·模型不可用）') : '';
            return `标题：${d.title}${mode}\n\n摘要：${d.summary}\n\n话题：${d.tags.map((t) => '#' + t).join(' ')}\n\n正文：\n${d.bodyText}`;
          },
        }),
        'dsh-toutiao: toutiao_draft',
      ),
  );

  log('已就绪');
}
