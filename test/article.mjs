import { createCore } from '../src/core.mjs';
import { buildArticlePrompt, buildArticleDraft } from '../src/draft.mjs';

// 1) prompt builder sanity
const fakeItems = [
  { title: 'BLG 3-1 击败 GEN 夺得全球总决赛冠军', abstract: '在刚刚结束的英雄联盟全球总决赛中，BLG 以 3-1 战胜 GEN，LPL 时隔多年再夺冠军。', source: '电竞头条', time: '1小时前', url: 'https://x/1' },
  { title: 'Bin：冠军属于整个团队', abstract: '赛后采访中，Bin 表示这个冠军属于整个团队和一直支持他们的粉丝。', source: '游戏日报', time: '50分钟前', url: 'https://x/2' },
];
const prompt = buildArticlePrompt('BLG夺冠', fakeItems, { style: '热血, 理性分析' });
console.log('PROMPT has keyword:', prompt.includes('BLG夺冠'));
console.log('PROMPT has style:', prompt.includes('热血、理性分析'));
console.log('PROMPT has material:', prompt.includes('BLG 3-1'));

// 2) article draft assemble
const dB = buildArticleDraft('BLG夺冠', fakeItems, {
  articleBody: '这是一段开头，讲清楚发生了什么。\n\n这是第二段，回顾 LPL 的沉浮与这次夺冠的意义。\n\n最后一段给出观点与思考。',
  style: ['热血', '理性分析'],
});
console.log('DRAFT title:', dB.title);
console.log('DRAFT kind:', dB.kind, 'ai:', dB.generatedByAi, 'paras:', dB.bodyText.split('\n\n').length, 'tags:', dB.tags.join('/'));

// 3) core.draft with MOCK llm that returns article body → should be article kind
const mockLlm = {
  complete: async (p) => {
    if (!p.includes('BLG夺冠')) throw new Error('prompt missing keyword');
    return '第一段：BLG 夺冠了，全场沸腾。\n\n第二段：多年前的低谷与今天的登顶，构成了这个故事。\n\n第三段：电竞的意义，也许就在于这份坚持。';
  },
};
const core = createCore({ getConfig: () => ({ digestTop: 5, searchLimit: 10 }), log: (m) => {}, llm: mockLlm });
const d = await core.draft({ keyword: 'BLG夺冠', style: '热血' });
console.log('=== core.draft (llm ok) ===');
console.log('kind:', d.kind, 'ai:', d.generatedByAi, 'style:', (d.style || []).join('/'));
console.log('body first:', d.bodyText.split('\n\n')[0]);
console.log('html length:', d.html.length);

// 4) fallback: llm returns null → keyword kind, ai=false
const core2 = createCore({ getConfig: () => ({ digestTop: 5, searchLimit: 10 }), log: () => {}, llm: { complete: async () => null } });
const d2 = await core2.draft({ keyword: 'BLG夺冠', style: '热血' });
console.log('=== core.draft (llm null → fallback) ===');
console.log('kind:', d2.kind, 'ai:', d2.generatedByAi, 'items:', d2.items.length);

// 5) no llm at all → fallback
const core3 = createCore({ getConfig: () => ({ digestTop: 5, searchLimit: 10 }), log: () => {} });
const d3 = await core3.draft({ keyword: 'BLG夺冠' });
console.log('=== core.draft (no llm) ===');
console.log('kind:', d3.kind, 'ai:', d3.generatedByAi, 'items:', d3.items.length);
