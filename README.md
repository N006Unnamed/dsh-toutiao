# dsh-toutiao

今日头条**热点采集 + 关键词搜索 + 半自动发布草稿**的 DSH 插件。纯 HTTP 实现，免登录、免签名；在 DSH 设置面板里有独立卡片，可被其他插件调用取数据。

> 发布环节是半自动的：插件帮你把标题 / 摘要 / 正文 / 话题都写好并生成预览页，最终到头条号后台**由人点发布**。两家平台都没有面向个人的开放发布 API。

## 功能

- **热榜**：抓 `hot-board` 热榜 50 条（标题 / 热度 / 标签 / 链接）。
- **关键词搜索**：抓 SSR 搜索页，得到标题 + 摘要 + 来源 + 时间 + 链接。
- **全文**：走手机版 `m.toutiao.com/group/<id>/` 的 `RENDER_DATA`，拿到完整正文（免登录）。
- **日报素材**：热榜每条自动补一条真实媒体摘要（不是自己编事实）。
- **发布草稿**：据搜索结果 / 热榜生成标题、摘要、正文、话题标签，生成本地预览页供复制。
- **定时抓取**：按配置的间隔自动抓热榜。

## 三种用法

### 1. 设置面板（Web UI）

打开 DSH 的「设置」，左侧会多一个**「头条热点」**分区：

- 采集设置：热点条数、搜索条数、关注关键词、附带全文、写草稿
- 定时获取：启用开关 + 间隔（分钟）
- 立即获取：**「立即获取当前热点」** 按钮，抓一次热榜并展示
- 关键词搜索：输入关键词即时搜一条看
- 生成发布草稿：一键生成草稿预览

### 2. 模型工具

| 工具 | 作用 |
| --- | --- |
| `toutiao_hot` | 热榜（`limit`） |
| `toutiao_search` | 关键词搜索（`keyword`, `limit`） |
| `toutiao_article` | 文章全文（`id` 或 URL） |
| `toutiao_digest` | 热点日报素材（`top`, `keywords`） |
| `toutiao_draft` | 发布草稿（`keywords`, `topN`） |

### 3. 给其他插件调用

本插件通过 Cordis 服务 `toutiao` 暴露数据，别的插件里：

```js
const toutiao = ctx.get('toutiao');           // 取决于插件 inject 声明
const hot = await toutiao.getHot(10);          // → 数组
const res = await toutiao.search('羽绒服', 8); // → 数组
const art = await toutiao.getArticle(gid);     // → { title, text, ... }
const dig = await toutiao.getDigest({ top: 10 });
const draft = await toutiao.getDraft({ keywords: ['羽绒服'] });
```

## 配置项（持久化到 `$DSH_HOME/dsh-toutiao/config.json`）

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `hotLimit` | 20 | 热榜默认条数（1~50） |
| `searchLimit` | 12 | 搜索默认条数（1~30） |
| `keywords` | `[]` | 默认关注关键词 |
| `digestTop` | 10 | 日报 / 草稿覆盖热榜前几条 |
| `perKeyword` | 5 | 每个关键词取几条 |
| `withFullText` | false | 是否给每条结果附全文 |
| `autoDraft` | false | 抓取后是否顺带写草稿 |
| `schedule.enabled` | false | 是否启用定时抓取 |
| `schedule.intervalMinutes` | 60 | 定时间隔（分钟，5~1440） |

## HTTP 路由（`/api/plugins/dsh-toutiao`）

- `GET /state` → 配置 + 状态
- `POST /config` → 保存设置（`sec-fetch-site` 同源校验）
- `POST /fetch-hot` → 立即抓热榜
- `POST /search` → `{ keyword, limit }`
- `POST /article` → `{ id }`
- `POST /draft` → `{ keywords, topN }`
- `GET /ui/panel.css` → 面板样式

## 安装（桌面 profile）

1. 把整个 `dsh-toutiao` 目录拷到 `~/.dsh/profiles/desktop/node_modules/dsh-toutiao/`
2. 在 `~/.dsh/profiles/desktop/package.json` 的 `dependencies` 与 `dsh.profile.bundles` 里加上 `dsh-toutiao`
3. 重启 DeepSeek Harness 应用

## 结构

```
lib/index.js         插件入口：apply(ctx)、5 个工具、ctx.provide('toutiao')、定时、路由挂载
lib/routes.mjs       设置面板 / 立即抓取的 HTTP 路由
lib/config-schema.mjs  Config（schemastery）
lib/client.js        设置面板卡片（window.__ModuleLoader__，注册到 settings.section）
lib/panel.css        面板样式（tt- 前缀，--dsw-alias-* 令牌）
src/core.mjs         业务核心：缓存 + getHot/search/article/digest/draft/status
src/{http,hot,search,article,digest,draft}.mjs  采集与解析
```

## 声明

采集均为公开可访问的页面与接口，低频、单机、仅做聚合与个人使用；请遵守平台服务条款，不要高频抓取或二次分发。
