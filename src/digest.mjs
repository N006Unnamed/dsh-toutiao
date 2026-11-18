/**
 * digest.mjs —— 把热榜 + 关键词搜索结果拼成一份 Markdown 日报。
 *
 * 两条路线：
 *  - 不传关键词（默认）：给热榜**每一条**配上它自己的真实摘要（拿标题去搜，取最相关一条的 abstract）。
 *  - 传了关键词：额外附「关键词观察」一节。
 */

import { hotBoard, hotStats } from './hot.mjs';
import { searchKeyword } from './search.mjs';
import { getArticle } from './article.mjs';

export const ymd = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const hm = (d = new Date()) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** 用热榜标题去搜，挑最相关一条作为这条热点的摘要来源。 */
const MEDIA_HINT =
  /新闻|日报|晚报|电视台|广播|新华社|中新|澎湃|界面|财经|证券|时报|观察者|环球|人民|央视|光明|经济|都市|晨报|网\b|报$/;
const UGC_HINT = /^(?!.*(新闻|日报|报|台|网|社))[\u4e00-\u9fa5A-Za-z0-9]{2,8}$/;

export async function abstractForHot(title, { perHot = 5 } = {}) {
  try {
    const { items } = await searchKeyword(title, { limit: perHot });
    if (!items || !items.length) return null;
    const kwTokens = title.replace(/[，。、！？：·,.\s]/g, ' ').split(' ').filter((w) => w.length >= 2);
    const score = (it) => {
      const abs = String(it.abstract || '');
      let s = 0;
      // 媒体来源优先，个人号降权
      if (MEDIA_HINT.test(it.source || '')) s += 3;
      else if (UGC_HINT.test((it.source || '').trim())) s -= 1.5;
      // 摘要完整度：被截断（结尾是 …）降权
      if (abs && !/…$|\.\.\.$/.test(abs.trim())) s += 1;
      s += Math.min(abs.length, 160) / 80;
      for (const t of kwTokens) if (it.title.includes(t)) s += 1.5;
      return s;
    };
    const best = items.slice().sort((a, b) => score(b) - score(a))[0];
    return {
      title: best.title,
      abstract: best.abstract,
      source: best.source,
      time: best.time,
      gid: best.gid,
      url: best.url,
      candidates: items,
    };
  } catch (err) {
    return { error: err.message };
  }
}

/** 给某条已选中的搜索结果抓全文（走手机版 RENDER_DATA，免登录）。 */
export async function fullTextFor(item) {
  if (!item || !item.gid) return null;
  try {
    const a = await getArticle(item.gid);
    return { text: a.text, html: a.html, images: a.images, title: a.title, source: a.source, publishTime: a.publishTime, url: a.url };
  } catch (err) {
    return { error: err.message };
  }
}

/**
 * @param {{top?: number, keywords?: string[], perKeyword?: number, date?: Date, withAbstract?: boolean, withFullText?: boolean}} [opts]
 */
export async function buildDigest({
  top = 15,
  keywords = [],
  perKeyword = 5,
  date = new Date(),
  withAbstract = true,
  withFullText = false,
} = {}) {
  const hot = await hotBoard({ limit: top });
  const stats = hotStats(hot);

  // 给热榜每一条配真实摘要（可选：再抓全文）
  if (withAbstract) {
    for (const it of hot) {
      it.summaryOf = await abstractForHot(it.title);
      if (withFullText && it.summaryOf && !it.summaryOf.error) {
        it.fullText = await fullTextFor(it.summaryOf);
      }
    }
  }

  const searches = [];
  for (const kw of keywords) {
    try {
      const res = await searchKeyword(kw, { limit: perKeyword + 4 });
      if (withFullText) {
        for (const it of res.items) {
          it.fullText = await fullTextFor(it);
        }
      }
      searches.push(res);
    } catch (err) {
      searches.push({ keyword: kw, items: [], error: err.message });
    }
  }

  const markdown = renderMarkdown({ hot, stats, searches, top, keywords, date });
  return {
    dateStr: ymd(date),
    timeStr: hm(date),
    generatedAt: date.toISOString(),
    hot,
    stats,
    searches,
    keywords,
    markdown,
  };
}

function renderMarkdown({ hot, stats, searches, top, keywords, date }) {
  const lines = [];
  lines.push(`# 今日头条热榜 · ${ymd(date)}`);
  lines.push('');
  lines.push(
    `> 采集于 ${ymd(date)} ${hm(date)} ｜ 共 ${stats.count} 条 ｜ 最高热度 ${stats.top?.hotText ?? '-'} ｜ 纯 HTTP 采集，无需登录`,
  );
  lines.push('');

  lines.push('## 一、热榜速览（含每条摘要）');
  lines.push('');
  for (const it of hot) {
    const label = it.labelCn ? ` \`${it.labelCn}\`` : '';
    lines.push(`${it.rank}. **${it.title}** ｜ 热度 ${it.hotText}${label}`);
    const s = it.summaryOf;
    if (s && s.abstract) {
      const meta = [s.source, s.time].filter(Boolean).join(' · ');
      lines.push(`   ${s.abstract}${meta ? `（${meta}）` : ''}`);
      lines.push(`   [原文](${it.url}) ｜ [相关报道](${s.url})`);
      if (it.fullText && it.fullText.text) {
        const body = it.fullText.text.replace(/\s+/g, ' ').trim();
        lines.push(`   > 正文：${body.length > 600 ? body.slice(0, 600) + '…' : body}`);
      }
    } else {
      lines.push(`   [原文](${it.url})`);
    }
    lines.push('');
  }

  if (keywords.length) {
    lines.push('## 二、关键词观察');
    lines.push('');
    for (const s of searches) {
      lines.push(`### ${s.keyword}（${s.items?.length ?? 0} 条）`);
      lines.push('');
      if (s.error) {
        lines.push(`> 抓取失败：${s.error}`);
        lines.push('');
        continue;
      }
      if (!s.items.length) {
        lines.push('> 这次没解析到结果（页面结构可能变了）。');
        lines.push('');
        continue;
      }
      for (const [i, it] of s.items.entries()) {
        const meta = [it.source, it.time].filter(Boolean).join(' · ');
        lines.push(`**${i + 1}. ${it.title}**${meta ? ` ｜ ${meta}` : ''}`);
        if (it.abstract) lines.push(`   ${it.abstract}`);
        lines.push(`   [链接](${it.url})`);
        lines.push('');
      }
    }
  }

  lines.push('---');
  lines.push('');
  lines.push(
    `来源：今日头条热榜 hot-board + so.toutiao.com 搜索页（SSR 解析）。每条热点的摘要＝用其标题检索到的最相关真实文章摘要。趋势/文章比 ${stats.trendingCount}:${stats.articleCount}。`,
  );
  lines.push('');
  return lines.join('\n');
}
