# Xiaohongshu Clean — Loon 插件

- Loon：`loon/xiaohongshu/xiaohongshu-clean.plugin` + `js/xiaohongshu_clean.js`
- Egern：`egern/xiaohongshu/xiaohongshu-clean.yaml`

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

## 界面精简（默认关闭）

`clean_ui` 打开后额外做两件事：

- `/homefeed/categories` 删掉 `homefeed.shop`（购物）、`homefeed.sketch`（市集）、`homefeed.live`（直播）三个 tab
  —— 这是**顶部**分类栏，不是底部导航栏；
- `/system_service/config` 里再删 `store`（商城入口）。

默认关闭是因为删 tab 属于改界面，不是去广告；想要更干净再打开。
底部「首页 / 购物 / ＋ / 消息 / 我」那套导航不受影响，脚本没处理过，见下面的「已知没做的」。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 首页、搜索、评论区、开屏、商品推广位、启动配置里的推广字段 |
| `clean_ui` | false | 顶部分类栏的购物 / 市集 / 直播 tab 与商城入口（底部导航栏不动） |

两个都关掉时脚本直接返回，不解析 JSON。

## 注意

- 需开启 MitM：`edith.xiaohongshu.com`、`www.xiaohongshu.com`、`pages.xiaohongshu.com`。
- 只删数组元素与字段，不动 `success` / `code` / `has_more` / `cursor`，分页不受影响。
- 某一页被删空时保留原样，避免客户端把空页当成加载失败。
- 响应超过 8 MB、不是 JSON、状态码 ≥ 300、解析失败、处理中抛异常，全部原样放行。
- 图片与视频走 `*.xhscdn.com`，不在 MITM 范围内，也不做任何改写。
- 广告位字段（`is_ads` / `ads` / `show_tags`）是当前版本的结构；App 换字段后最差是不生效，
  不会误删正常笔记。
- 小红书接口走 HTTP/2，Loon 需在 MitM 页面打开「MitM over HTTP/2」，模块里也写了 `h2 = true`。
- 脚本 URL 带 `?v=` 版本号；改脚本不改版本号时，客户端会一直跑缓存里的旧脚本。

## 排障：先确认脚本到底有没有跑起来

模块"一点感觉都没有"时，先按这四层查，别急着改脚本：

1. **MITM**：`edith.xiaohongshu.com`、`www.xiaohongshu.com`、`pages.xiaohongshu.com` 都在 MitM 列表里，CA 证书已安装并信任。
2. **HTTP/2**：Loon 在 MitM 页面打开「MitM over HTTP/2」。模块里写了 `h2 = true`，但部分版本以页面开关为准；不开时 `requires-body` 拿不到 body，脚本等于空转。
3. **QUIC**：模块自带 `PROTOCOL, QUIC` 的 REJECT 规则。HTTP/3 走 UDP，不经过代理，不拒绝时脚本看不到这些请求。
4. **脚本缓存**：脚本 URL 带 `?v=` 版本号。改完脚本必须同步改版本号，或删掉模块重新导入，否则客户端还在跑缓存里的旧脚本。

## 抓真实结构（Xiaohongshu Probe）

`xiaohongshu-probe` 是排障专用模块：只把接口路径与响应结构写进脚本日志，**不改写任何内容**，也没有任何过滤效果。

| 平台 | 文件 |
| --- | --- |
| Loon | `loon/xiaohongshu/xiaohongshu-probe.plugin` |
| Egern | `egern/xiaohongshu/xiaohongshu-probe.yaml` |
| Shadowrocket | `shadowrocket/xiaohongshu/xiaohongshu-probe.sgmodule` |

装上后按平时的方式刷首页、进直播间、切几次底栏，然后在客户端的脚本日志里看 `[XHS]` 开头的行：

```text
[XHS] Q POST /api/sns/v10/homefeed
[XHS] R /api/sns/v10/homefeed 200 48213B
[XHS] R keys=success,data
[XHS] R data=array[20]
[XHS] R [0] keys=id,model_type,note_card model_type=note note_card{...} type=normal
[XHS] R [1] keys=id,model_type,live_info model_type=live live_info{room_id}
[XHS] R count model_type → note:18 live:2
[XHS] R ★ bottom_tab = [{"name":"购物", ...
```

- `Q` 行：这次刷出了哪些接口。首页 / 直播 / 底栏分别由哪个接口下发，一眼能看出来；
- `count` 行：广告卡、直播卡到底有没有 `is_ads` / `model_type` 标记；
- `★` 行：名字像 tab / 底栏 / 直播 / 广告的字段，结构原样带出来。

每个路径最多记 3 次，翻页不会刷屏。抓完就关掉：它会对每个小红书接口都打日志。

## 已知没做的（等真实结构再补）

- **直播推荐**：`homefeed` 里的直播卡没有任何 live 判定，会原样留下；
- **底部导航栏**：脚本只动 `/homefeed/categories`（顶部 分类 tab）和 `config.store`，底部「首页 / 购物 / ＋ / 消息 / 我」这套从来没碰过。

要补这两项，需要上面 Probe 抓到的真实结构：字段名猜错会误删正常内容，所以没直接上。

