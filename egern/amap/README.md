# AMap Clean — Egern 模块

- Egern：`egern/amap/amap-clean.yaml` + `js/amap_clean.js`
- Loon：`loon/amap/amap-clean.plugin`
- Shadowrocket：`shadowrocket/amap/amap-clean.sgmodule`

高德地图（iOS 17.3.x）：去开屏、首页信息流、路线页、打车页运营位和「我的」页面广告，
同时拒绝广告素材与已知遥测域名。

三端共用同一份 `amap_clean.js`，接口与字段说明见
[`loon/amap/README.md`](../../loon/amap/README.md)。

## 改动概要

- **域名层**：`optimus-ads.amap.com`（广告素材）、`logs.amap.com` /
  `dualstack-logs.amap.com`（日志）、`adashx.ut.amap.com` 等三个入口（阿里系上报）、
  `awaken.amap.com`（H5 日志）。
- **URL Rewrite**：开屏、首页 AI 推荐、路线页广告、搜索场景推荐、广告 GIF / 图片、
  打车订单 Tip，改成空响应或 1x1 占位图；`m5-x.amap.com` 的行为流上传与
  `alc/collect` 也返回空 200（`amapstream` 路径带双斜杠，用 `\/+` 匹配）。
- **JSON 脚本**：开屏素材置为未开始；首页删广告卡、保留其余卡片；「我的」删 `tipData`、
  `好友动态`、`猜你喜欢` 与推荐 / 广告卡；消息、热词、运营位、AOCS 配置按字段清空；
  AOCS 里的 `taxi` 只删营销位、保留打车开关，`sportsHomeConfig` 删 `banner_list`，
  `splashscreen` / `amap_basemap_config` / `navi_end` 里的开屏与导航结束页广告归零；
  AI 探索页的 SSE 流不拦——回空流会弹「网络错误」。
- **「我的」页路径**：17.3 起改为 `/ws/faas/amap-navigation/usr-profile-fc/homeV2`
  （地址取自 AOCS `amap_basemap_config.usercenter_performance_optimization.home_api_url`），
  旧版 `dsp/profile/index/nodefaas` 同时保留。

## 需要 MITM

```text
*.amap.com
```

整域解密，因为各版本 App 的网关不固定：`m5.amap.com`、`m5-zb.amap.com` 是主网关，
`sns.amap.com` 承载消息盒子，`amap-aos-info-nogw.amap.com` 承载开屏和部分首页接口，
新版还会用 `aos.amap.com` 之类没列过的子域。

模块同时对 `amap.com` 的 QUIC 直接 REJECT。高德的网关走 HTTP/3，UDP 不经过 MITM，
不拒绝的话脚本连响应都看不到。

地图 / 定位 / 导航业务域名（`restapi.amap.com`、`apilocate.amap.com`、
`m5.amap.com`）不拉黑，否则导航会坏。

## 注意事项

- 脚本遇到解析失败、结构变化、16 位以上连续数字时一律原样放行，不会把响应改坏。
- 「我的」页的卡片是按 `dataType` 和广告标记过滤的；如果高德换了新的卡片类型，
  脚本会放行，不会误删。出现新广告时按 `loon/amap/README.md` 里的列表抓包。
- 天气卡片默认保留；不需要可在 YAML 的 `url_rewrites` 里加
  `/ws/valueadded/weather` → `http://reject-dict/`。
- 和 `ADBlock` 模块有部分重叠（`m5.amap.com/ws/valueadded/`、`sns.amap.com/ws/msgbox/pull`
  等），同时开启会重复处理同一条请求；二选一时建议保留本模块。
