# Zhihu Clean — Egern 模块

- Egern：`egern/zhihu/zhihu-clean.yaml` + `js/zhihu_clean.js`
- Loon：`loon/zhihu/zhihu-clean.plugin`
- Shadowrocket：`shadowrocket/zhihu/zhihu-clean.sgmodule`

知乎去开屏、推荐流伪装广告、回答页夹层广告与评论区推广。只改 JSON 响应，不碰回答正文与图片。

## 改了什么

| 接口 | 处理 |
| --- | --- |
| `/commercial_api/launch_v2`、`real_time_launch_v2` | 开屏广告：清空 `launch_ads` / `ads` / `launch` |
| `/topstory/recommend`、`/topstory/hot-lists` | 首页推荐流与热榜：过滤 `data[]` 里 `type="feed_advert"`、带 `adjson`、`ad`、`promotion_extra` 或视频 `is_ad` 的广告卡 |
| `/api/v4/questions/*/answers`、`/api/v4/answers/*`、`/next-bff`、`next-data`、`next-render` | 回答列表与详情：剥离 `ad_info`、`adjson`、`activity_topping_info` 等回答间插页广告 |
| `/api/v4/comment_v5/*`、`/api/v4/comments/*` | 评论区：删 `ad_plugin_infos` 与带 `ad_info` / `is_ad` 的推广评论 |
| `/api/v4/search/*` | 搜索与热搜：过滤商业推广搜索词与广告结果 |

## 参数 (`env_schema`)

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | `"true"` | 去开屏、信息流伪装广告、回答页夹层广告与评论区插件广告 |
| `clean_ui` | `"false"` | 额外过滤推荐流里的盐选故事 (`km_sku`)、训练营与回答页MCN带货卡 |
