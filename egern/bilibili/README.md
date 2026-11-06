# BiliBili Clean — Egern 模块

- Egern：`egern/bilibili/bilibili-clean.yaml` + `js/bilibili_clean.js`、`js/bilibili_quality.js`、`js/bilibili_grpc.js`
- Loon：`loon/bilibili/bilibili-clean.plugin`

精简版，只保留四件事：去广告、去会员推广、去遥测、播放请求自动要最高画质。
不重写首页、不换 CDN、不碰播放签名。

## 改了什么

| 接口 | 处理 |
| --- | --- |
| `app.bilibili.com/x/v2/splash/*` | 开屏：清空 `list` / `event_list` / `brand_list` |
| `app.bilibili.com/x/v2/feed/index*` | 首页：删 `card_type=ad`、`card_goto=ad`、`ad_info` 非空的卡片 |
| `app.bilibili.com/x/v2/search/square` | 搜索：同上 |
| `api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd` | 网页推荐流：同上 |
| `api.bilibili.com/x/vip/ads/materials` | 大会员广告素材：清空 |
| `api.bilibili.com/pgc/view/v2/app/season` | 番剧页：删 `data.payment`（会员付费块） |
| `api.bilibili.com/pgc/page/*` | 番剧页：删 `module_style` / `module_type` 为 `ad` 的模块 |
| `api.live.bilibili.com/xlive/...` | 直播推荐：删广告卡 |
| `api.bilibili.com/pgc/activity/deliver/material/receive` | 番剧弹窗广告：返回 `close_win` |

只按结构删数组元素，不改对象键；形状对不上就原样放行。

## 详情页 / 评论区（gRPC）

视频详情、评论、播放器状态走的是 gRPC（protobuf over HTTP/2），不是 JSON，
由 `bilibili_grpc.js` 处理。只按字段号整条删或按条件删重复项，其余字节原样保留。

| 接口 | 处理 |
| --- | --- |
| `bilibili.app.view.v1.View/View` | 删 `cms`(30)、`cm_config`(31)、`tf_panel_customized`(34)、`cm_ipad`(41)、`cm_under_player`(48)；相关推荐里 `goto=cm/game` 或带 `cm`/`unique_id` 的删掉 |
| `bilibili.app.view.v1.View/RelatesFeed`、`PlayerRelates` | 相关推荐里的广告条目 |
| `bilibili.app.view.v1.View/ViewProgress` | 删过程引导卡 `video_guide` |
| `bilibili.app.view.v1.View/TFInfo` | 删办卡免流推广 `tf_toast` / `tf_panel_customized` |
| `bilibili.app.viewunite.v1.View/View` | 删视频下方广告 `cm`(7) |
| `bilibili.app.viewunite.v1.View/AIRelateAsync` | 删 `cm`(1) |
| `bilibili.app.viewunite.v1.View/RelatesFeed` | 推荐卡里广告类型（4/5/11）或带 `cm`/`cm_stock` 的删掉 |
| `bilibili.app.viewunite.v1.View/ViewProgress` | 删 `video_guide`(1) |
| `bilibili.app.viewunite.v1.View/PlayPause` | 暂停广告：整条返回空消息 |
| `bilibili.app.viewunite.v1.View/ViewEndPage` | 播放结束页广告：整条返回空消息 |
| `bilibili.main.community.reply.v1.Reply/MainList` | 删评论列表广告 `cm`(11)；删带 `b23.tv/cm`、`b23.tv/mall`、商品页链接的置顶评论；删 `type=3` 的评论区顶部带货卡 |

gRPC 帧的 flag 是 1 表示消息体 gzip（帧级压缩，不是 `Content-Encoding`），脚本会
先解压再按未压缩回写；解压不了就整条放行，不做半截修改。

**限制**：`PlayPause` / `ViewEndPage` 是整条置空，不是挑字段删，所以这两个接口返回的
其他数据（比如结束页的推荐位）也一起没了。这是有意的：B 站没给这两条留「只删广告」的
字段边界，挑着删反而容易把页面搞崩。

## 遥测

| 域名 / 路径 | 处理 |
| --- | --- |
| `data.bilibili.com` | REJECT（埋点） |
| `cm.bilibili.com` | REJECT（广告与商业上报） |
| `adtrack.qianwen.com` | REJECT（第三方广告归因） |
| `tkio-redirect.solar-engine.com` | REJECT（第三方广告归因） |
| `api.bilibili.com/x/report/click/*` | reject 404（点击埋点） |

## 画质

`playurl` 请求里的 `qn` 统一改成 `120`（4K），并补 `fourk=1`。服务端按账号权限
返回实际能给的最高档：大会员给 4K，普通账号自动落到 1080P，不会报错。

**限制**：只覆盖 REST 的 `*/playurl`。新版 App 有一部分播放信息走 gRPC
（`grpc.biliapi.net/bilibili.app.playurl.v1.PlayURL/PlayView`），gRPC 的 protobuf
请求体不在这个脚本的改写范围里；这类请求会沿用 App 里上次选的清晰度。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 开屏、首页、搜索、番剧页、直播推荐、番剧弹窗、详情页、评论区、暂停广告 |
| `hide_vip` | true | 番剧页 payment 块、大会员广告素材、VIP 卡片 |
| `auto_quality` | true | playurl 的 qn 改成 120（4K） |

## 注意

- 需开启 MitM：`app.bilibili.com`、`api.bilibili.com`、`api.live.bilibili.com`、`grpc.biliapi.net`。
- 详情页 / 评论区依赖 `grpc.biliapi.net` 的 MITM。如果客户端对 HTTP/2 gRPC 的
  MITM 支持不好，表现是详情页转圈或评论刷不出来 —— 这时把 `block_ads` 关掉仍会
  保留 MITM，需要从模块里去掉 `grpc.biliapi.net` 才会完全恢复。
- 「我的」页里的会员入口是 App 本地 UI，不走 HTTP，代理层删不掉；能删的是接口下发的
  VIP 卡片、大会员广告素材和番剧页付费块。
- 首页广告卡如果换了新的 `card_type` 命名，脚本会当成普通卡片放行，不会误删内容。
- gRPC 的 `playurl`（`bilibili.app.playurl.v1.PlayURL/PlayView`）没有改写，自动画质
  只对 REST 的 `*/playurl` 生效。
