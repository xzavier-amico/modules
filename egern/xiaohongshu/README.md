# Xiaohongshu Clean — Egern 模块

- Egern：`egern/xiaohongshu/xiaohongshu-clean.yaml` + `js/xiaohongshu_clean.js`
- Loon：`loon/xiaohongshu/xiaohongshu-clean.plugin`

小红书去广告，只改 JSON 响应，不碰图片与视频。

## 改了什么

| 接口 | 处理 |
| --- | --- |
| `/api/sns/v<n>/homefeed` | 首页瀑布流：删 `data[]` 里 `is_ads` 为 `true` 的卡片，推荐词、话题等非笔记卡片保留 |
| `/api/sns/v<n>/search/notes` | 搜索结果：删 `data.items[]` 里 `ads` 为 `true` 的笔记 |
| `/api/sns/v<n>/note/comment/list` | 评论区：删 `show_tags` 带 `is_ads` 的评论，子评论里的广告一起删 |
| `/api/sns/v<n>/note/widgets` | 视频播放页商品推广位：清空 `data` |
| `/api/sns/v<n>/note/feed` | 笔记详情相关推荐：删 `is_ads` 条目（`tabfeed` / `videofeed` / `imagefeed` / `redtube` 同理） |
| `/api/sns/v<n>/system_service/splash_config` | 开屏：把 `ads_groups` 的 `start_time` / `end_time` 推到 2040 年，素材永远不到期 |
| `/api/sns/v<n>/system_service/config` | 启动配置：删 `splash` / `loading_img` / `app_theme` / `cmt_words` / `highlight_tab` / `watermark_pic_path` |

纯广告接口直接用 URL Rewrite 返回 404，不浪费一次解析：

- `/api/sns/v<n>/ads`、`/api/sns/v<n>/tag/ads`
- `/api/sns/v<n>/search/notes/recommend_info`（搜索联想里的推广词）

## 脚本结构

`js/xiaohongshu_clean.js` 由 `src/xiaohongshu/clean.js` 构建，三端内容一致（Shadowrocket 额外前置兼容层）。

1. 按 `path` 分发到对应接口，非目标接口直接返回；
2. `JSON.parse` 失败、状态码 ≥ 300、响应超过 8 MB 直接放行；
3. 只删数组元素与字段，不动 `success` / `code` / `has_more` / `cursor`；
4. 一页被删空时保留原样，避免客户端把空页当成加载失败；
5. 有改动才 `JSON.stringify` 回写，没改动返回空对象。

## 界面精简（默认关闭）

`clean_ui` 打开后额外做两件事：

- `/homefeed/categories` 删掉 `homefeed.shop`（购物）、`homefeed.sketch`（市集）、`homefeed.live`（直播）三个 tab；
- `/system_service/config` 里再删 `store`（商城入口）。

默认关闭是因为删 tab 属于改界面，不是去广告；想要更干净再打开。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 首页、搜索、评论区、开屏、商品推广位、启动配置里的推广字段 |
| `clean_ui` | false | 购物 / 市集 / 直播 tab 与商城入口 |

两个都关掉时脚本直接返回，不解析 JSON。

## 注意

- 需开启 MitM：`edith.xiaohongshu.com`、`www.xiaohongshu.com`、`pages.xiaohongshu.com`。
- 响应超过 8 MB、不是 JSON、状态码 ≥ 300、解析失败、处理中抛异常，全部原样放行。
- 图片与视频走 `*.xhscdn.com`，不在 MITM 范围内，也不做任何改写。
- 广告位字段（`is_ads` / `ads` / `show_tags`）是当前版本的结构；App 换字段后最差是不生效，
  不会误删正常笔记。
