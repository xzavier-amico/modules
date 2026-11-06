# BiliBili Clean — Loon 插件

- Loon：`loon/bilibili/bilibili-clean.plugin` + `js/bilibili_clean.js`、`js/bilibili_quality.js`
- Egern：`egern/bilibili/bilibili-clean.yaml`

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
| `block_ads` | true | 开屏、首页、搜索、番剧页、直播推荐、番剧弹窗 |
| `hide_vip` | true | 番剧页 payment 块、大会员广告素材、VIP 卡片 |
| `auto_quality` | true | playurl 的 qn 改成 120（4K） |
| `verbose_log` | false | 打印改写前后的字节数 |

## 注意

- 需开启 MitM：`app.bilibili.com`、`api.bilibili.com`、`api.live.bilibili.com`。
- 「我的」页里的会员入口是 App 本地 UI，不走 HTTP，代理层删不掉；能删的是接口下发的
  VIP 卡片、大会员广告素材和番剧页付费块。
- 首页广告卡如果换了新的 `card_type` 命名，脚本会当成普通卡片放行，不会误删内容。
