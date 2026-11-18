/**
 * hot.mjs —— 今日头条热榜。
 *
 * 接口：https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc
 * 免登录、无签名，返回 50 条。字段只有标题/热度/标签/链接，没有摘要和正文。
 */

import { fetchJson, formatHot } from './http.mjs';

const BOARD_URL = 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc';

const LABEL_CN = {
  hot: '热',
  new: '新',
  interpretation: '解读',
  refuteRumors: '辟谣',
  exclusive: '独家',
  first: '首发',
  top: '置顶',
};

/**
 * @param {{limit?: number}} [opts]
 * @returns {Promise<Array<{rank:number,title:string,hotValue:number,hotText:string,label:string,labelDesc:string,kind:string,id:string,url:string}>>}
 */
export async function hotBoard({ limit = 50 } = {}) {
  const json = await fetchJson(BOARD_URL, {});
  const list = Array.isArray(json?.data) ? json.data : [];
  return list.slice(0, limit).map((x, i) => {
    const url = String(x.Url || '');
    const kind = url.includes('/article/') ? 'article' : url.includes('/trending/') ? 'trending' : 'other';
    const id = String(x.ClusterIdStr || '') || (url.match(/\/(?:article|trending)\/(\d+)/) || [])[1] || '';
    return {
      rank: i + 1,
      title: String(x.Title || '').trim(),
      hotValue: Number(x.HotValue) || 0,
      hotText: formatHot(x.HotValue),
      label: String(x.Label || ''),
      labelCn: LABEL_CN[x.Label] || '',
      labelDesc: String(x.LabelDesc || ''),
      kind,
      id,
      url: url.split('?')[0],
    };
  });
}

/** 热榜顶部聚合统计，给日报导语用。 */
export function hotStats(items) {
  const total = items.reduce((s, x) => s + x.hotValue, 0);
  const top = items[0] || null;
  return {
    count: items.length,
    totalHot: total,
    totalHotText: formatHot(total),
    top,
    trendingCount: items.filter((x) => x.kind === 'trending').length,
    articleCount: items.filter((x) => x.kind === 'article').length,
  };
}
