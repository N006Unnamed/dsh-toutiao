/**
 * config-schema.mjs —— 插件 Config 的 schemastery 定义。
 *
 * 注意：DSH 宿主**不会**自动把 Config 渲染成设置表单（内置卡片都是手写 React 的）。
 * 这里的 Config 只用于：① cordis.yml 里可以给它设默认值；② 存储与校验。
 * 真正面向用户可点的设置面板在 lib/client.js 里，读写同一份 config（经 routes.mjs 落盘到
 * $DSH_HOME/dsh-toutiao/config.json）。
 */

export function toutiaoConfigSchema(z) {
  return z.object({
    hotLimit: z.number().default(20).description('热榜默认取前几条（1~50）'),
    searchLimit: z.number().default(12).description('关键词搜索默认返回条数（1~30）'),
    keywords: z.array(z.string()).default([]).description('默认关注的关键词'),
    digestTop: z.number().default(10).description('日报 / 草稿覆盖热榜前几条'),
    perKeyword: z.number().default(5).description('每个关键词取几条'),
    withFullText: z.boolean().default(false).description('是否给每条热点 / 关键词结果附带全文'),
    autoDraft: z.boolean().default(false).description('抓取后是否顺带生成发布草稿'),
    schedule: z
      .object({
        enabled: z.boolean().default(false).description('是否启用定时抓取'),
        intervalMinutes: z.number().default(60).description('定时抓取间隔（分钟）'),
      })
      .default({ enabled: false, intervalMinutes: 60 }),
  });
}
