# BiliBili Clean — Egern 模块

- Egern：`egern/bilibili/bilibili-clean.yaml` + `js/bilibili_clean.js`、`js/bilibili_quality.js`、`js/bilibili_grpc.js`
- Loon：`loon/bilibili/bilibili-clean.plugin`

精简版，只保留四件事：去广告、去会员推广、去遥测、播放请求自动要最高画质。
不重写首页、不换 CDN、不碰播放签名。App / gRPC 与网页版 API 共用同一套过滤，
网页版由 `web` 开关控制（默认开启）。

## 改了什么

| 接口 | 处理 |
| --- | --- |
| `app.bilibili.com/x/v2/splash/*` | 开屏：清空 `list` / `event_list` / `brand_list` |
| `app.bilibili.com/x/v2/feed/index*` | 首页：删 `cm_*` / `ad_*` / 游戏推广卡，大图 banner 只删其中的广告项；竖屏流删 `vertical_ad_*` |
| `app.bilibili.com/x/v2/search/square` | 搜索：同上 |
| `api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd` | 网页推荐流：只过滤 `data.item` 里 `goto=ad` 的条目 |
| `api.bilibili.com/x/web-interface/wbi/search/type` | 网页搜索：过滤 `data.result` / 分组 `data` 里的广告项 |
| `api.bilibili.com/x/web-interface/wbi/search/square` | 网页搜索热词 / 推荐位：过滤广告项 |
| `api.bilibili.com/x/web-interface/archive/related` | 网页相关推荐：过滤 `data` 数组里的广告项 |
| `api.bilibili.com/x/web-interface/view` | 网页详情：删 `cm_config` / `cm_ipad` / `cm_under_player`，过滤 `relates` 广告 |
| `api.bilibili.com/x/web-interface/wbi/view/detail` | 网页详情聚合：交给同一套详情处理 |
| `api.bilibili.com/x/polymer/web-dynamic/v1/feed/all` | 网页动态：删 `DYNAMIC_TYPE_AD` 条目 |
| `api.bilibili.com/pgc/view/web/season` | 网页番剧页：删 `result.payment`（会员付费块） |
| `api.live.bilibili.com/xlive/web-interface/v1/index/getList` | 网页直播首页：只删 `banner` 里带 `is_ad` / `show_ad_icon` 的卡片 |
| `api.live.bilibili.com/xlive/web-room/v1/index/getInfoByRoom` | 网页直播间：只删 banner 与购物位 |
| `api.bilibili.com/x/vip/ads/materials` | 大会员广告素材：清空 |
| `api.bilibili.com/pgc/view/v2/app/season` | 番剧页：删 `data.payment`（会员付费块） |
| `api.bilibili.com/pgc/page/*` | 番剧页：删 `module_style` / `module_type` 为 `ad` 的模块 |
| `api.live.bilibili.com/xlive/...` | 直播推荐：删广告卡 |
| `api.bilibili.com/pgc/activity/deliver/material/receive` | 番剧弹窗广告：返回 `close_win` |
| `app.bilibili.com/x/resource/show/tab*` | 底部 tab：删「发布」+「会员购」，顶部删「游戏中心」，并重排 `pos` |
| `app.bilibili.com/x/v2/account/mine` | 我的页：删 `vip_section` / `vip_section_v2` 和「我的服务」「大会员」分区 |

只按结构删数组元素，不改对象键；形状对不上就原样放行。

## 详情页 / 评论区（gRPC）

视频详情、评论、播放器状态走的是 gRPC（protobuf over HTTP/2），不是 JSON，
由 `bilibili_grpc.js` 处理。只按字段号整条删或按条件删重复项，其余字节原样保留。

| 接口 | 处理 |
| --- | --- |
| `bilibili.app.view.v1.View/View` | 删 `cms`(30)、`cm_config`(31)、`tf_panel_customized`(34)、`cm_ipad`(41)、`cm_under_player`(48)；相关推荐里 `goto=cm/game` 或带 `cm`/`unique_id` 的删掉；`otype=3`（广告跳转）或带 `ad_tab_info` 的定制 Tab(32) 删掉 |
| `bilibili.app.view.v1.View/RelatesFeed`、`PlayerRelates` | 相关推荐里的广告条目 |
| `bilibili.app.view.v1.View/ViewProgress` | 删过程引导卡 `video_guide` |
| `bilibili.app.view.v1.View/TFInfo` | 删办卡免流推广 `tf_toast` / `tf_panel_customized` |
| `bilibili.app.viewunite.v1.View/View` | 删视频下方广告 `cm`(7)；详情 Tab 里模块 `18`（番剧活动横幅）/ `29`（大会员横幅）/ `55`（up 主分享好物）整块删，模块 `28` 的推荐卡按广告规则过滤 |
| `bilibili.app.viewunite.v1.View/AIRelateAsync` | 删 `cm`(1)；异步 Tab 里的推广模块与推荐广告卡同 `View/View` |
| `bilibili.app.viewunite.v1.View/RelatesFeed` | 推荐卡里广告类型（4/5/11）或带 `cm`/`cm_stock` 的删掉 |
| `bilibili.app.viewunite.v1.View/ViewProgress` | 删 `video_guide`(1) |
| `bilibili.app.viewunite.v1.View/PlayPause` | 暂停广告：整条返回空消息 |
| `bilibili.app.viewunite.v1.View/ViewEndPage` | 播放结束页广告：整条返回空消息 |
| `bilibili.main.community.reply.v1.Reply/MainList` | 删评论列表广告 `cm`(11)；删带 `b23.tv/cm`、`b23.tv/mall`、商品页链接的置顶评论；删 `type=3` 的评论区顶部带货卡 |
| `bilibili.app.dynamic.v2.Dynamic/DynAll`、`DynVideo` | 删 `dynamic_list` 里 `card_type=15`（广告卡）的条目 |

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

两条路径都改：REST 的 `*/playurl` 改 query 里的 `qn` / `fourk` / `fnval`；gRPC 的
`bilibili.app.playurl.v1.PlayURL/PlayView`、`bilibili.pgc.gateway.player.v2.PlayURL/PlayView`
和 `bilibili.app.playerunite.v1.Player/PlayViewUnite` 改请求体里的 `qn(3)` / `fnval(5)` / `fourk(8)`
（playerunite 的字段在 `vod(1)` 里面）。服务端按账号权限返回实际能给的最高档：
大会员给 4K，普通账号自动落到 1080P，不会报错。

`fnval` 会补上 4K 位（128）——很多客户端只带了 1080P 的位，不补的话即使 qn=120
服务端也不会给 4K。gRPC 请求体改之前会先确认 `qn` 的值是已知清晰度，字段号对不上就
整条放行，不会把播放请求改坏。

**限制**：画质由服务端按账号权限下发，代理层只能把「请求要什么」提到最高。非大会员
账号拿到 4K 流是不可能的；伪造 `accept_quality` 只会让界面显示 4K、实际播 1080P，
所以没有做。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 开屏、首页、搜索、番剧页、直播推荐、番剧弹窗、详情页、评论区、暂停广告 |
| `hide_vip` | true | 番剧页 payment 块、大会员广告素材、VIP 卡片、我的页大会员推广 |
| `clean_ui` | true | 底部「发布」+「会员购」、顶部「游戏中心」、「我的」页的「我的服务」分区 |
| `auto_quality` | true | playurl 的 qn 改成 120（4K） |
| `web` | true | 支持网页版：处理网页推荐、搜索、相关推荐、详情、动态、番剧与直播 API；关闭后网页版请求完全放行 |

## 注意

- 需开启 MitM：`app.bilibili.com`、`api.bilibili.com`、`api.live.bilibili.com`、
  `app.biliapi.net`、`api.biliapi.net`、`grpc.biliapi.net`、`grpc.bilibili.com`。
- 详情页 / 评论区依赖 gRPC 的 MITM。如果客户端对 HTTP/2 gRPC 的
  MITM 支持不好，表现是详情页转圈或评论刷不出来 —— 这时把 `block_ads` 关掉仍会
  保留 MITM，需要从模块里去掉 `grpc.biliapi.net` 才会完全恢复。
- 「我的」页顶部的会员入口仍是 App 本地 UI，不走 HTTP，代理层删不掉；能删的是接口下发的
  VIP 卡片、大会员推广块、我的服务分区和番剧页付费块。
- 网页版只处理 API 返回的 JSON，不改网页 HTML 里的 `__INITIAL_STATE__`；网页首屏如果直接内嵌了
  某些广告数据，脚本看不到。`web` 关闭后所有网页 API 原样放行。
- 首页广告卡如果换了新的 `card_type` 命名，脚本会当成普通卡片放行，不会误删内容。
- 模块对 `bilibili.com`、`biliapi.net` 的 QUIC 直接 REJECT，强制回落 TCP；HTTP/3 走 UDP
  不经过代理，不拒绝时 gRPC 与 playurl 的请求/响应脚本拿不到。
