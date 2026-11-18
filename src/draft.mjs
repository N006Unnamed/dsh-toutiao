/**
 * draft.mjs —— 把日报素材整理成一份「头条号草稿」：标题 / 摘要 / 正文 / 话题标签，
 * 再生成一个可打开的本地页面（一键复制 + 直达发布页），最后一步"发布"留给人点。
 *
 * 为什么不做全自动发布：mp.toutiao.com 的发布接口要登录 Cookie，且自动发布是平台风控重点，
 * 半自动既省事又把风险留在人手里。
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ymd } from './digest.mjs';

const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** 头条号标题一般限制 30 字。 */
export function clampTitle(t, max = 30) {
  const s = String(t).replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function cnDate(d) {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/**
 * @param {{hot: Array, stats: object, searches: Array, keywords: string[], date?: Date}} digest
 */
export function buildDraft(digest, { date = new Date(), topN = 10 } = {}) {
  const hot = digest.hot || [];
  const top = hot[0];
  const top3 = hot.slice(0, 3);
  const rest = hot.slice(3, topN);
  const searches = digest.searches || [];
  const keywords = digest.keywords || [];
  const dateStr = ymd(date);

  const title = clampTitle(`${cnDate(date)}头条热榜｜${top?.title ?? '今日热点'}`);
  const second = top3
    .slice(1)
    .map((x) => `“${x.title}”`)
    .join('、');
  const summary = [
    `今日头条热榜 Top${Math.min(topN, hot.length)}：${top ? `“${top.title}”（${top.hotText}）居首` : '——'}。`,
    second ? `紧随其后的是 ${second}。` : '',
    keywords.length ? `另外，围绕「${keywords.join('」「')}」也整理了相关最新内容。` : '',
  ]
    .filter(Boolean)
    .join('');

  const tags = ['今日头条', '热榜', '热点', ...keywords.slice(0, 2)].slice(0, 5);

  // —— 正文 ——
  // 只用「真实抓取到的事实」：每条热点配它的真实摘要（来自头条搜索到的媒体文章），不自己编。
  const items = hot.slice(0, topN);
  const hasAbs = items.some((it) => it.summaryOf?.abstract);

  const paras = [];
  paras.push(
    `${cnDate(date)}的头条热榜，最受关注的是“${top?.title ?? ''}”，热度 ${top?.hotText ?? '-'}。下面按热度逐条梳理，每条附上媒体对它的报道摘要。`,
  );
  for (const it of items) {
    const s = it.summaryOf;
    const heads = `${it.rank}｜${it.title}（热度 ${it.hotText}${it.labelCn ? ` · ${it.labelCn}` : ''}）`;
    if (s && s.abstract) {
      const abs = String(s.abstract).replace(/\s+/g, ' ').trim();
      const src = [s.source, s.time].filter(Boolean).join(' ');
      paras.push(`${heads}\n${abs}${src ? `（据${src}）` : ''}`);
    } else {
      paras.push(heads);
    }
  }

  if (keywords.length) {
    paras.push('关键词方面：');
    for (const s of searches) {
      if (!s.items?.length) continue;
      paras.push(`「${s.keyword}」相关的几条：`);
      for (const it of s.items.slice(0, 3)) {
        const abs = String(it.abstract || '').replace(/\s+/g, ' ').slice(0, 120);
        paras.push(`· ${it.title}${abs ? `——${abs}` : ''}`);
      }
    }
  }

  paras.push(
    `以上是 ${ymd(date)} ${digest.timeStr ?? ''} 的榜单。热度数据来自今日头条热榜，每条摘要来自头条搜索到的媒体报道。${hasAbs ? '' : '（本次未取到摘要，请联网后重试。）'}`,
  );

  const bodyText = paras.join('\n\n');

  // —— 正文（HTML，粘进编辑器保留段落结构）——
  const li = (it) => {
    const s = it.summaryOf;
    const head = `<b>${esc(it.title)}</b>（热度 ${esc(it.hotText)}${it.labelCn ? ` · ${esc(it.labelCn)}` : ''}）`;
    if (s && s.abstract) {
      const src = [s.source, s.time].filter(Boolean).join(' ');
      return `<li>${head}：${esc(String(s.abstract).replace(/\s+/g, ' ').trim())}${src ? `（据${esc(src)}）` : ''}</li>`;
    }
    return `<li>${head}</li>`;
  };
  const bodyHtml = [
    `<p>${esc(paras[0])}</p>`,
    `<ol>${items.map(li).join('')}</ol>`,
    ...keywords.length
      ? [
          `<h2>关键词延伸</h2>`,
          ...searches.flatMap((s) =>
            s.items?.length
              ? [`<h3>${esc(s.keyword)}</h3>`, `<ul>${s.items
                  .slice(0, 3)
                  .map(
                    (it) =>
                      `<li>${esc(it.title)}${it.abstract ? `：${esc(String(it.abstract).slice(0, 120))}` : ''}</li>`,
                  )
                  .join('')}</ul>`]
              : [],
          ),
        ]
      : [],
    `<p>以上是 ${ymd(date)} 的榜单。热度数据来自今日头条热榜，每条摘要来自头条搜索到的媒体报道。</p>`,
  ].join('\n');

  return {
    title,
    summary,
    tags,
    bodyText,
    bodyHtml,
    items: items.map((it) => ({
      rank: it.rank,
      title: it.title,
      hotText: it.hotText,
      labelCn: it.labelCn,
      url: it.url,
      abstract: it.summaryOf?.abstract || '',
      source: it.summaryOf?.source || '',
      time: it.summaryOf?.time || '',
      relatedUrl: it.summaryOf?.url || '',
      fullText: it.fullText?.text || '',
    })),
    searches: searches.map((s) => ({
      keyword: s.keyword,
      error: s.error || '',
      items: (s.items || []).map((it) => ({
        title: it.title,
        abstract: it.abstract || '',
        source: it.source || '',
        time: it.time || '',
        url: it.url || '',
        fullText: it.fullText?.text || '',
      })),
    })),
    createdAt: date.toISOString(),
    stats: digest.stats,
    source: { dateStr, keywords },
  };
}

/**
 * 关键词草稿：标题 / 摘要 / 正文全部围绕「这一关键词的搜索结果」来写，而不是热榜。
 * 用户搜了 BLG夺冠 就据 BLG夺冠 的结果出稿，这是"生成草稿按搜索结果走"的正确行为。
 *
 * @param {string} keyword
 * @param {Array} items  searchKeyword 返回的 items（每条含 title/abstract/source/time/url/fullText?）
 * @param {{date?: Date, topN?: number}} [opts]
 */
export function buildKeywordDraft(keyword, items, { date = new Date(), topN = 10 } = {}) {
  const kw = String(keyword || '').trim() || '关键词';
  const list = (items || []).slice(0, topN);
  const dateStr = ymd(date);
  const first = list[0];
  const withAbs = list.filter((it) => it && String(it.abstract || '').trim());

  const title = clampTitle(`「${kw}」最新进展｜${cnDate(date)}`);

  const summary = withAbs.length
    ? `围绕「${kw}」的最新报道：${withAbs
        .slice(0, 2)
        .map((it) => `“${it.title}”`)
        .join('、')}。共整理 ${list.length} 条相关新闻，附媒体摘要。`
    : `围绕「${kw}」的最新相关新闻已整理 ${list.length} 条，点击查看原文。`;

  const tags = ['今日头条', kw, '最新'].filter(Boolean).slice(0, 3);

  const paras = [];
  paras.push(
    list.length
      ? `关于「${kw}」，近期头条上有多条相关报道。下面按相关度逐条梳理，每条附上媒体摘要与原文链接。`
      : `暂时没搜到「${kw}」的相关结果，可能是关键词太新或页面结构变化，可换个说法再试。`,
  );
  for (const [i, it] of list.entries()) {
    const abs = String(it.abstract || '').replace(/\s+/g, ' ').trim();
    const src = [it.source, it.time].filter(Boolean).join(' ');
    const head = `${i + 1}. ${it.title}${src ? `（据${src}）` : ''}`;
    const body = it.fullText?.text ? String(it.fullText.text).replace(/\s+/g, ' ').trim() : '';
    paras.push(abs || body ? `${head}\n${abs || (body.length > 200 ? body.slice(0, 200) + '…' : body)}` : head);
  }
  paras.push(`以上为「${kw}」的相关报道整理（${ymd(date)}）。内容来自今日头条公开搜索，请改写后发布。`);

  const bodyText = paras.join('\n\n');

  const esc2 = esc;
  const bodyHtml = [
    `<p>${esc2(paras[0])}</p>`,
    `<ol>${list
      .map((it) => {
        const abs = String(it.abstract || '').replace(/\s+/g, ' ').trim();
        const src = [it.source, it.time].filter(Boolean).join(' ');
        const body = it.fullText?.text ? String(it.fullText.text).replace(/\s+/g, ' ').trim() : '';
        const tail = abs || (body.length > 200 ? body.slice(0, 200) + '…' : body);
        return `<li><b>${esc2(it.title)}</b>${src ? `（据${esc2(src)}）` : ''}${tail ? `：${esc2(tail)}` : ''}</li>`;
      })
      .join('')}</ol>`,
    `<p>以上为「${esc2(kw)}」的相关报道整理。内容来自今日头条公开搜索，请改写后发布。</p>`,
  ].join('\n');

  return {
    title,
    summary,
    tags,
    keyword: kw,
    kind: 'keyword',
    bodyText,
    bodyHtml,
    items: list.map((it) => ({
      title: it.title,
      url: it.url || '',
      abstract: it.abstract || '',
      source: it.source || '',
      time: it.time || '',
      fullText: it.fullText?.text || '',
    })),
    searches: [{ keyword: kw, error: '', items: list.map((it) => ({
      title: it.title,
      abstract: it.abstract || '',
      source: it.source || '',
      time: it.time || '',
      url: it.url || '',
      fullText: it.fullText?.text || '',
    })) }],
    createdAt: date.toISOString(),
    source: { dateStr, keywords: [kw] },
  };
}

/**
 * 把一批搜索结果压成"给模型看的素材"，用于写整篇文章。
 * 每条取：标题 / 来源 / 时间 / 摘要或正文片段。
 * @param {Array} items
 * @param {number} topN
 */
export function materialsForArticle(items, topN = 10) {
  return (items || [])
    .slice(0, topN)
    .map((it, i) => {
      const src = [it.source, it.time].filter(Boolean).join(' · ');
      const body = String(it.fullText || it.fullText?.text || it.abstract || '').replace(/\s+/g, ' ').trim();
      const clip = body.length > 300 ? body.slice(0, 300) + '…' : body;
      return `${i + 1}. 《${it.title}》${src ? `（据 ${src}）` : ''}${clip ? `\n   ${clip}` : ''}`;
    })
    .join('\n');
}

/**
 * 构造"写一篇可发布文章"的提示词。
 * @param {string} keyword 事件关键词
 * @param {Array} items 搜索结果
 * @param {{style?: string|string[], topN?: number}} [opts]
 */
export function buildArticlePrompt(keyword, items, { style, topN = 10 } = {}) {
  const kw = String(keyword || '').trim();
  const styleList = Array.isArray(style)
    ? style.map((s) => String(s).trim()).filter(Boolean)
    : String(style || '')
        .split(/[,，、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
  const styleLine = styleList.length
    ? `\n\n【文风 / 角度要求】请务必贴合这些要求来写：${styleList.join('、')}。`
    : '';
  return [
    `你是今日头条的资深作者。请围绕最近发生的事件「${kw}」，写一篇**可以公开发布的头条文章**。`,
    '',
    '要求：',
    '1. 这是一篇**完整的文章**，不是新闻罗列、不是清单、不是统计表。要有开头引入、事情经过/背景、以及你的观察、分析与思考。',
    '2. 结构建议：一个吸引人的标题；开头一两段把「发生了什么、为什么值得关注」讲清楚；中间展开背景、来龙去脉、关键细节；最后给出观点、影响或启发，可以自然收尾。',
    '3. 全文 600~1000 字，语言通顺、有观点、有温度，符合中文自媒体阅读习惯，避免通篇"据悉""记者了解到"这类生硬句式。',
    '4. **只能基于下面提供的素材里的事实**，不要编造具体数字、人名、时间；素材没提到的不必硬写。可以在事实基础上做合理分析与评论。',
    '5. 直接输出正文即可，不要写"标题："这类前缀（标题我会另外生成）。',
    styleLine,
    '',
    '【素材】',
    materialsForArticle(items, topN) || '（无搜索结果，请就你对该事件的了解谨慎写作，避免编造事实）',
  ].join('\n');
}

/**
 * 用模型写的正文 + 少量素材，组装成一篇"文章式"草稿对象（与 renderDraftPage 兼容）。
 * @param {string} keyword
 * @param {Array} items 搜索结果（用于摘要/标签/参考来源）
 * @param {{articleBody: string, style?: string|string[], date?: Date, topN?: number, generatedByAi?: boolean}} opts
 */
export function buildArticleDraft(keyword, items, { articleBody, style, date = new Date(), topN = 10, generatedByAi = true } = {}) {
  const kw = String(keyword || '').trim() || '话题';
  const list = (items || []).slice(0, topN);
  const dateStr = ymd(date);
  const body = String(articleBody || '').trim();

  // 正文按空行/换行切成段落
  const paras = body
    .split(/\n{2,}/)
    .flatMap((p) => p.split(/\n/))
    .map((p) => p.trim())
    .filter(Boolean);

  const title = clampTitle(`${kw}：${firstSentence(paras[0]) || '这几天发生了什么'}｜${cnDate(date)}`, 30);

  const withAbs = list.filter((it) => it && String(it.abstract || '').trim());
  const summary = withAbs.length
    ? `围绕「${kw}」，${withAbs
        .slice(0, 2)
        .map((it) => `“${it.title}”`)
        .join('、')}等多方消息引发关注。本文梳理事情经过，并谈谈背后的看点与影响。`
    : `围绕「${kw}」的最新进展，本文梳理事情经过，并谈谈背后的看点与影响。`;

  const styleList = Array.isArray(style)
    ? style.map((s) => String(s).trim()).filter(Boolean)
    : String(style || '')
        .split(/[,，、\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
  const tags = ['今日头条', kw, ...styleList].filter(Boolean).slice(0, 4);

  const bodyText = paras.join('\n\n');
  const bodyHtml = paras.map((p) => `<p>${esc(p)}</p>`).join('\n');

  const refs = list.map((it) => ({
    title: it.title,
    url: it.url || '',
    abstract: it.abstract || '',
    source: it.source || '',
    time: it.time || '',
    fullText: it.fullText?.text || it.fullText || '',
  }));

  return {
    title,
    summary,
    tags,
    keyword: kw,
    kind: 'article',
    style: styleList,
    generatedByAi,
    bodyText,
    bodyHtml,
    items: refs,
    searches: [{ keyword: kw, error: '', items: refs }],
    createdAt: date.toISOString(),
    source: { dateStr, keywords: [kw], style: styleList },
  };
}

/** 取首句（到第一个句号/问号/感叹号/换行），用于拼标题。 */
function firstSentence(s) {
  const t = String(s || '').replace(/^#+\s*/, '').trim();
  const m = t.match(/^(.{4,24}?)[。！？!?\n]/);
  return m ? m[1] : t.slice(0, 24);
}

const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish';

/** 渲染一组条目卡片（热榜 / 关键词通用）。key 用于全文复制索引前缀。 */
function renderCards(list, key) {
  return list
    .map((it, i) => {
      const idx = i;
      const meta = [it.source, it.time].filter(Boolean).join(' · ');
      const badge = it.labelCn ? `<span class="badge">${esc(it.labelCn)}</span>` : '';
      const headLeft = it.rank ? `${it.rank}. ` : `${i + 1}. `;
      const hot = it.hotText ? `<span class="hot">${esc(it.hotText)}</span>` : '';
      const links = `${it.relatedUrl ? `<a href="${esc(it.relatedUrl)}" target="_blank" rel="noreferrer">相关报道 ↗</a>` : ''}
        ${it.url ? `<a href="${esc(it.url)}" target="_blank" rel="noreferrer">原文 ↗</a>` : ''}`;
      const full = it.fullText
        ? `<details><summary>看全文（${it.fullText.replace(/\s+/g, '').length} 字）</summary><div class="full">${esc(it.fullText)}</div>
           <div class="bar"><button class="secondary" onclick="copyFull('${key}',${idx})">复制全文</button>${links}</div></details>`
        : `<div class="hint">未取到全文 ${links}</div>`;
      return `<div class="item">
        <div class="ititle"><b>${headLeft}${esc(it.title)}</b> ${badge} ${hot}</div>
        ${it.abstract ? `<div class="abs">${esc(it.abstract)}${meta ? `<span class="src">（${esc(meta)}）</span>` : ''}</div>` : ''}
        ${full}
      </div>`;
    })
    .join('\n');
}

/** 生成给人看的草稿页：两个 Tab（热榜 / 关键词），各自可展开看全文。 */
export function renderDraftPage(draft) {
  const tagLine = draft.tags.map((t) => `#${t}`).join(' ');
  const searches = draft.searches || [];
  const hasKw = searches.some((s) => s.items && s.items.length);

  // 全文映射（供复制用）
  const fullMap = { hot: draft.items.map((it) => it.fullText || '') };
  searches.forEach((s, si) => {
    fullMap[`kw${si}`] = s.items.map((it) => it.fullText || '');
  });

  // 关键词 Tab 内容
  const kwTabs = hasKw
    ? searches
        .map(
          (s, si) => `
      <div class="kwblock">
        <h2>「${esc(s.keyword)}」（${s.items.length} 条）</h2>
        ${s.error ? `<div class="hint">抓取失败：${esc(s.error)}</div>` : ''}
        ${s.items.length ? renderCards(s.items, `kw${si}`) : '<div class="hint">这次没解析到结果。</div>'}
      </div>`,
        )
        .join('\n')
    : '<div class="hint">本次没有关键词（用 --kw "关键词" 生成）。</div>';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>头条号草稿 · ${esc(draft.title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.7 -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; max-width: 860px; margin: 0 auto; padding: 28px 20px 60px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  .hint { color: #888; font-size: 13px; margin-bottom: 10px; }
  .row { margin: 14px 0; }
  .row > label { display: block; font-size: 12px; color: #888; margin-bottom: 4px; }
  .val { background: #f5f5f5; border-radius: 8px; padding: 10px 12px; word-break: break-all; }
  textarea { width: 100%; box-sizing: border-box; min-height: 340px; font: 15px/1.7 "Microsoft YaHei", sans-serif; border-radius: 8px; border: 1px solid #ddd; padding: 12px; }
  button { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 14px; cursor: pointer; background: #1677ff; color: #fff; }
  button.secondary { background: #eee; color: #333; }
  button:active { opacity: .7; }
  .bar { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 10px 0 18px; }
  .warn { background: #fff7e6; border: 1px solid #ffe0a3; color: #8a5a00; border-radius: 8px; padding: 10px 12px; font-size: 13px; }
  a { color: #1677ff; }
  #toast { position: fixed; left: 50%; bottom: 30px; transform: translateX(-50%); background: #333; color: #fff; padding: 8px 16px; border-radius: 20px; opacity: 0; transition: opacity .2s; pointer-events: none; z-index: 9; }
  .tabs { display: flex; gap: 6px; border-bottom: 2px solid #eee; margin: 22px 0 18px; position: sticky; top: 0; background: var(--bg, #fff); padding-top: 8px; z-index: 5; }
  .tab { padding: 9px 18px; cursor: pointer; border-radius: 8px 8px 0 0; font-size: 15px; color: #666; user-select: none; }
  .tab.active { background: #1677ff; color: #fff; font-weight: 600; }
  .pane { display: none; }
  .pane.active { display: block; }
  .item { border: 1px solid #eee; border-radius: 10px; padding: 12px 14px; margin: 10px 0; }
  .ititle { font-size: 15px; line-height: 1.5; }
  .ititle .hot { color: #e8590c; font-size: 12px; margin-left: 6px; }
  .badge { display: inline-block; background: #eef3ff; color: #1677ff; font-size: 11px; border-radius: 4px; padding: 0 5px; vertical-align: middle; }
  .abs { color: #444; font-size: 14px; margin: 6px 0; }
  .abs .src { color: #999; font-size: 12px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; color: #1677ff; font-size: 13px; }
  .full { white-space: pre-wrap; background: #fafafa; border-radius: 8px; padding: 10px 12px; margin: 8px 0; font-size: 14px; line-height: 1.75; max-height: 420px; overflow: auto; }
  .kwblock h2 { font-size: 17px; margin: 18px 0 6px; }
</style>
</head>
<body>
  <h1>${esc(draft.title)}</h1>
  <div class="hint">生成于 ${esc(new Date(draft.createdAt).toLocaleString('zh-CN'))} ｜ 热度来自今日头条热榜，关键词来自头条搜索，正文取自手机版原文（免登录）</div>

  <div class="warn">
    这是<b>素材草稿</b>，请改写后发布：直接照搬媒体原文有版权风险；AI 参与内容需按平台要求标注。
    最后一步“发布”请自己在头条号后台点。<a href="${PUBLISH_URL}" target="_blank" rel="noreferrer">打开头条号发布页 ↗</a>
  </div>

  <div class="tabs">
    <div class="tab active" data-pane="hot" onclick="switchTab('hot')">🔥 热度榜</div>
    <div class="tab" data-pane="kw" onclick="switchTab('kw')">🔍 关键词${hasKw ? `（${searches.reduce((n, s) => n + (s.items?.length || 0), 0)}）` : ''}</div>
  </div>

  <!-- ============ Tab 1：热度榜 ============ -->
  <div class="pane active" id="pane-hot">
    <div class="row"><label>标题（≤30 字）</label><div class="val" id="title">${esc(draft.title)}</div></div>
    <div class="bar"><button onclick="copy('title','标题')">复制标题</button></div>

    <div class="row"><label>摘要 / 导语</label><div class="val" id="summary">${esc(draft.summary)}</div></div>
    <div class="bar"><button onclick="copy('summary','摘要')">复制摘要</button></div>

    <div class="row"><label>正文（可先在这里改，再复制）</label>
      <textarea id="body">${esc(draft.bodyText)}</textarea>
    </div>
    <div class="bar">
      <button onclick="copy('body','正文')">复制正文</button>
      <button class="secondary" onclick="copyHtml()">复制 HTML（保留段落）</button>
    </div>

    <div class="row"><label>话题标签</label><div class="val" id="tags">${esc(tagLine)}</div></div>
    <div class="bar"><button onclick="copy('tags','话题')">复制话题</button></div>

    <div class="row"><label>榜单原文 / 全文（点开每条看正文）</label>
      ${renderCards(draft.items, 'hot')}
    </div>
  </div>

  <!-- ============ Tab 2：关键词 ============ -->
  <div class="pane" id="pane-kw">
    ${kwTabs}
  </div>

  <div id="toast"></div>
  <script>
    const FULLTEXT = ${JSON.stringify(fullMap)};
    const toast = (m) => { const t = document.getElementById('toast'); t.textContent = m; t.style.opacity = 1; clearTimeout(t._h); t._h = setTimeout(() => t.style.opacity = 0, 1400); };
    async function write(text) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch { const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove(); return true; }
    }
    async function copy(id, name) { await write(document.getElementById(id).value ?? document.getElementById(id).textContent); toast('已复制' + name); }
    async function copyHtml() { await write(${JSON.stringify(draft.bodyHtml)}); toast('已复制 HTML'); }
    async function copyFull(key, i) { await write((FULLTEXT[key] || [])[i] || ''); toast('已复制全文'); }
    function switchTab(name) {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.pane === name));
      document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'pane-' + name));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  </script>
</body>
</html>`;
}

/** 落盘：draft-<date>.md / .html / .json */
export function saveDraft(draft, outDir) {
  mkdirSync(outDir, { recursive: true });
  const dateStr = draft.source?.dateStr ?? ymd(new Date(draft.createdAt));
  const base = join(outDir, `draft-${dateStr}`);
  const md = [
    `# ${draft.title}`,
    '',
    `> 摘要：${draft.summary}`,
    `> 话题：${draft.tags.map((t) => '#' + t).join(' ')}`,
    '',
    '---',
    '',
    draft.bodyText,
    '',
  ].join('\n');
  writeFileSync(`${base}.md`, md, 'utf8');
  writeFileSync(`${base}.json`, JSON.stringify(draft, null, 2), 'utf8');
  const htmlPath = `${base}.html`;
  writeFileSync(htmlPath, renderDraftPage(draft), 'utf8');
  return { md: `${base}.md`, json: `${base}.json`, html: htmlPath };
}
