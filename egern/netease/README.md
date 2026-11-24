# NetEase Music Clean — Egern 模块

- Egern：`egern/netease/netease-clean.yaml` + `js/netease_clean.js`
- Loon：`loon/netease/netease-clean.plugin`
- Shadowrocket：`shadowrocket/netease/netease-clean.sgmodule`

网易云音乐去开屏、首页横幅广告、搜索买榜词与评论区推广。

## 改了什么

| 层级 / 接口 | 处理 |
| --- | --- |
| 域名规则 (`rule_sets`) | 拒绝 QUIC (`163.com`、`126.net`)，拦截 `iadmat*.nosdn.127.net`、`iadmusicmat*.music.126.net`、`admusicpic.music.126.net` 等开屏素材 CDN |
| URL Rewrite (`url_rewrites`) | `/eapi/ad/`、`/eapi/sp/loading/ad` 直接拦截 |
| `/eapi/batch`、`/homepage/block/page` | 首页发现流：过滤 `HOMEPAGE_BANNER` 里的商业广告轮播图（保留新歌/活动图）以及纯广告 `blocks[]`；`clean_ui=true` 时额外隐藏直播间、语音房、KTV、商城模块 |
| `/eapi/search/hot`、`default` | 搜索热词：过滤带 `adInfo`、`alg="ad"`、`iconType=5` 的买榜推广词 |
| `/eapi/v1/resource/comments`、`/comment/` | 评论区：清理顶部 `banner`、`adInfo` 与带 `isAd` / `adMark` 的推广评论 |

## 参数 (`env_schema`)

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | `"true"` | 去开屏、首页横幅广告、搜索买榜词与评论区广告 |
| `clean_ui` | `"false"` | 额外移除首页发现流里的直播、语音房、KTV、商城等泛娱乐模块 |
