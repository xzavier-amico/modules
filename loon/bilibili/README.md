# BiliBili Clean — Loon 插件

- Loon：`loon/bilibili/bilibili-clean.plugin` + `js/bilibili_clean.js`、`js/bilibili_quality.js`
- Egern：`egern/bilibili/bilibili-clean.yaml`

精简版，只保留四件事：去广告、去会员推广、去遥测、播放请求自动要最高画质。
不重写首页、不换 CDN、不碰播放签名。

## 改了什么

| 接口 | 处理 |
| --- | --- |
| `app.bilibili.com/x/v2/splash/*` | 开屏：清空 `list` / `event_list` / `brand_list` |
| `app.bilibili.com/x/v2/feed/index*` | 首页：删 `cm_*` / `ad_*` / 游戏推广卡，大图 banner 只删其中的广告项；竖屏流删 `vertical_ad_*` |
| `app.bilibili.com/x/v2/search/square` | 搜索：同上 |
| `api.bilibili.com/x/web-interface/wbi/index/top/feed/rcmd` | 网页推荐流：同上 |
| `api.bilibili.com/x/vip/ads/materials` | 大会员广告素材：清空 |
| `api.bilibili.com/pgc/view/v2/app/season` | 番剧页：删 `data.payment`（会员付费块） |
| `api.bilibili.com/pgc/page/*` | 番剧页：删 `module_style` / `module_type` 为 `ad` 的模块 |
| `api.live.bilibili.com/xlive/...` | 直播推荐：删广告卡 |
| `api.bilibili.com/pgc/activity/deliver/material/receive` | 番剧弹窗广告：返回 `close_win` |
| `app.bilibili.com/x/resource/show/tab*` | 底部 tab：删「发布」+「会员购」，顶部删「游戏中心」，并重排 `pos` |
| `app.bilibili.com/x/v2/account/mine` | 我的页：删 `vip_section` / `vip_section_v2` 和「我的服务」「大会员」分区 |

只按结构删数组元素，不改对象键；形状对不上就原样放行。

详情页、评论区、动态页走的是 gRPC（protobuf over HTTP/2），由 `bilibili_grpc.js` 按字段号删：
`view.v1.View` 的 `cms` / 广告配置 / 广告 Tab、`viewunite.v1.View` 的 `cm` 与详情 Tab 里的推广模块、
`Reply/MainList` 的评论广告与带货置顶、`Dynamic/DynAll`、`DynVideo` 的广告卡（`card_type=15`）。
完整字段表见 [`egern/bilibili/README.md`](../../egern/bilibili/README.md)。

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
服务端也不会给 4K。gRPC 请求体改之前会先确认 `qn` 的值是已知清晰度
（6/16/32/64/74/80/112/116/120/125/126/127），字段号对不上就整条放行，不会把播放请求改坏。

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

## 注意

- 需开启 MitM：`app.bilibili.com`、`api.bilibili.com`、`api.live.bilibili.com`、
  `app.biliapi.net`、`api.biliapi.net`、`grpc.biliapi.net`、`grpc.bilibili.com`。
- 「我的」页顶部的会员入口仍是 App 本地 UI，不走 HTTP，代理层删不掉；能删的是接口下发的
  VIP 卡片、大会员推广块、我的服务分区和番剧页付费块。
- 首页广告卡如果换了新的 `card_type` 命名，脚本会当成普通卡片放行，不会误删内容。
- 模块对 `bilibili.com`、`biliapi.net` 的 QUIC 直接 REJECT，强制回落 TCP；HTTP/3 走 UDP
  不经过代理，不拒绝时 gRPC 与 playurl 的请求/响应脚本拿不到。
