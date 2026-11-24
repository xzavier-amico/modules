# Weibo Clean — Loon 插件

- Loon：`loon/weibo/weibo-clean.plugin` + `js/weibo_clean.js`
- Egern：`egern/weibo/weibo-clean.yaml`
- Shadowrocket：`shadowrocket/weibo/weibo-clean.sgmodule`

微博去开屏、时间线推广卡片、评论区软广与商业热搜。只改 JSON 响应，不碰图片与视频流。

## 改了什么

| 接口 | 处理 |
| --- | --- |
| `/wbapplua/wbpullad.lua`、`/2/push/active` | 开屏与冷启动广告：清空 `ads` / `cached_ad`，把投放有效期推到 2040 年 |
| `/2/statuses/unread_hot_timeline`、`friends_timeline`、`container_timeline`、`bilateral_timeline` | 推荐与关注时间线：过滤带 `promotion`、`ad_state`、`mblogtypename` 为「广告/热推」或 `readtimetype="adMblog"` 的推广微博 |
| `/2/statuses/extend` | 微博正文详情页：剥离正文下方的 `head_cards`、`trend`、`ad_info` 等推广商品卡 |
| `/2/comments/build_comments` | 评论区：过滤 `datas` / `root_comments` 里带 `adType`、`is_ad` 或 `type=1` 广告评论，删 `comment_bubble` |
| `/2/search/finder`、`container_timeline`、`container_discover`、`/2/page`、`/2/cardlist` | 发现页与热搜榜：过滤 `cards` / `card_group` 里带 `promotion`、`is_ad`、`card_type=22` 或带「商 / 广告 / 热推」角标的商业热搜 |
| `/2/profile/me` | 我的页：去 `vip_center`；`clean_ui=true` 时额外隐藏钱包、借钱、游戏等营销入口 |

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 去开屏、时间线推广、评论区软广与商业热搜 |
| `clean_ui` | false | 精简「我的」页钱包、借钱、游戏等营销卡片 |

## 注意

- 需开启 MitM：`api.weibo.cn`、`m.weibo.cn`、`mapi.weibo.com`、`sdkapp.uve.weibo.com`。
- Loon 请确保在 MitM 页面开启「MitM over HTTP/2」。
- 自动保护字符串外的 16+ 位微博 `mid` / `id` 整数，不会因 `JSON.parse` 截断导致评论或转发对不上号。
