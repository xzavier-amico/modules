# AMap Clean — Loon 插件

- Loon：`loon/amap/amap-clean.plugin` + `js/amap_clean.js`
- Egern：`egern/amap/amap-clean.yaml`
- Shadowrocket：`shadowrocket/amap/amap-clean.sgmodule`

高德地图（iOS 17.x）：去开屏、首页推荐、探索页推荐、搜索推荐、打车页营销位、
路线页与「我的」页面广告，同时拒绝广告素材与已知遥测域名。

## 改了什么

**1. 域名层（REJECT）**

| 域名 | 用途 |
| --- | --- |
| `optimus-ads.amap.com` | 广告素材 CDN（首页左上角 GIF、运营图） |
| `logs.amap.com` | 日志上传 |
| `dualstack-logs.amap.com` | 双栈日志上传 |
| `adashx.ut.amap.com` / `h-adashx` / `v6-adashx` | 阿里妈妈系曝光、点击、行为上报 |
| `awaken.amap.com` | H5 日志（`/ws/h5_log`），冷启动一次几十条 |

`apiinit.amap.com` 也在公开广告列表里，但它是高德 SDK 的初始化域名，其它接入高德 SDK
的 App 也会请求；默认不拦，避免误伤。

**2. URL Rewrite（只返回广告的接口）**

| 接口 | 处理 |
| --- | --- |
| `*/ws/asa/ads_attribution` | 广告归因，直接失败 |
| `*/ws/aos/alimama/*` | 开屏广告，返回空 200 |
| `*/ws/faas/amap-navigation/card-service-route-plan?` | 路线规划下方广告，返回 `{}` |
| `m5-x.amap.com/+ws/shield/amapstream/upload` | 行为流上报，返回空 200（路径带双斜杠，`\/+` 兼容） |
| `m5-x.amap.com/ws/shield/alc/collect` | 日志 / 行为采集，返回空 200 |
| `optimus-ads.amap.com/uploadimg/*` | 广告图，返回 1x1 占位图 |
| `*/uploadimg/*.gif` | 首页左上角 GIF，返回 1x1 占位图 |
| `*/ws/boss/order_web/*_information` | 打车订单页顶部 Tip 广告，返回空 200 |
| `*/ws/faas/amap-navigation/main-page-(assets\|aiqs)` | 首页资产 / AI 快捷搜索配置，返回 `{}` |
| `ai.amap.com/v1/ai_rec/home_qs` | 探索页的 AI 快捷搜索流，返回 `{}` |
| `*/ws/info_bff/rankingCard` | 首页榜单卡，返回 `{}` |
| `*/ws/shield/search_business/process/marketingOperationStructured` | 搜索页营销运营位，返回 `{}` |

最后一条如果影响订单页，先删掉它。

**3. JSON 清理（`js/amap_clean.js`）**

| 接口 | 处理 |
| --- | --- |
| `/ws/valueadded/alimama/splash_screen` | 把 `data.ad[*]` 的 `display_time` 归零，创意起止时间推到未来 |
| `/ws/faas/amap-navigation/main-page` | 删广告卡，保留其余正常卡片；清 `mapBizList`、`business_position`、`pull3.msgs` |
| `/ws/faas/amap-navigation/usr-profile-fc/homeV2` | 17.3 起「我的」页的真实接口（地址取自 AOCS `amap_basemap_config.usercenter_performance_optimization.home_api_url`）：删 `tipData`，删 `UserCenterNearbyCard`（猜你喜欢）、`UserCenterInteractCard`（好友动态）、`UserCenterMemberVideoCard` 等广告卡 |
| `/ws/shield/dsp/profile/index/nodefaas` | 旧版「我的」，处理方式同上，保留兼容 |
| `/ws/shield/search/new_hotword` | 清 `header_hotword` |
| `/ws/promotion-web/resource` | 清 `icon` / `banner` / `tips` / `popup` / `bubble` / `other` |
| `/ws/msgbox/pull` | 清 `msgs` 与 `pull3.msgs` |
| `/ws/message/notice/list` | 清 `noticeList` |
| `/ws/shield/frogserver/aocs/updatable` | 把角标、运营层、AI 入口、`routeresult_banner` / `taxi_activity` / `TrainOrderBanner` / `EndNaviC3AdCard` 置空；`taxi` 配置删营销位（banner / 福利中心 / 券 / 活动）但保留打车功能开关；`sportsHomeConfig` 删 `banner_list`；`splashscreen` 的每日次数与实时开屏素材归零；`amap_basemap_config` 的 `splash.maxShowTimePerDay` / `ai_splash.duration` / `recommend_poi_switch` / `is_show_creator_card` / `show_landmark_exploration_card` / `task_poi_card_coupon_switch` / `recommend_poi_main.door_switch` 归零，并把 `usercenter_performance_optimization.timeout` 从 7 天改成 0、把广告卡移出 `cacheCards`；`navi_end` 的 `navi_end_advertisement` / `collect_oil` 归零并清 `operator_btns` |
| `/ws/shield/search/nearbyrec_smart` | 删券、活动、商品推荐与 `modules` 里对应的模块 |
| `/ws/shield/dsp/profile/index/nodefaasv3` | 17.x「我的」页：删 `tipData` / `wallet`，`cardList` 只留「足迹」和 B 端入口卡，入口列表按 id 白名单收窄 |
| `/ws/boss/car/order/content_info` | 打车页：删 `lubanData.skin` / `kingToolBoxBubble` / `popup`，工具箱只留城际 / 顺风车 / 专车 / 品质 / 包车 |
| `/ws/amap/hitch/passenger/content_info` | 顺风车页：删 `lubanData.banner` |
| `/ws/shield/scene/recommend` | 搜索场景：`shadingWords` 只留快捷入口 / 历史 / 搜索发现，工具卡只留 102 / 103 / 106 / 151 |
| `/ws/shield/search_business/process/middleLayer/sug` | 搜索联想：只留普通内容和推广词条 |
| `/ws/c3frontend/af-search/search` | 搜索首页：清快捷入口角标文案 |
| `/ws/amc/server/conv/raise_list` | 消息会话列表：只留分类会话和系统会话 |
| `/ws/smartui/near_recommend` | 附近推荐：删 `operation_activity` |
| `/ws/opc/tools/list` | 工具列表：删每个工具的 `tips`，去掉推广工具（id 547） |
| `/v1/ai_rec/home_explore` | 「探索」Tab 的 SSE 流：逐个事件把 `MdCard_Explore_0` / `ContentCard_0` / `AiCardContainer_0` / `PmtContainer` / `PmtMultiCard` 从 `modules` 和 `regions.content` 里一起删掉，保留地图与点位模块（`AiMapPoints` / `AiExploreMap` / `AiMapRoutes`），流结构与 `is_done` 不动 |

「我的」页的卡片列表由 AOCS 的 `amap_basemap_config.usercenter_performance_optimization.timeout`
控制缓存时长，默认 `604800000` 毫秒（7 天）。缓存期内 App 根本不会请求 `homeV2`，脚本也就没机会
过滤——这是「我的」页广告一直清不掉的原因。脚本把这个值改成 0，并把 `UserCenterNearbyCard`
（猜你喜欢）、`UserCenterInteractCard`（好友动态）、`UserCenterMemberVideoCard`（会员视频）
从 `cacheCards` 里摘掉，这样即使命中缓存也不会恢复这几张卡。

所有改写都只动结构，不改对象键名；解析失败、结构对不上、字符串外出现 16 位以上
连续数字（JSON 往返会丢精度）时原样放行。AOCS 配置里 URL 字符串内的 16 位 ID
（如 shopId）不会触发这条保护。

卡片过滤保留原来的容器形状（数组进数组出、对象进对象出），并且一张卡都剩不下时
不做改动——卡片列表为空正是客户端弹「网络不畅」的原因。

## 需要 MITM 的域名

```text
*.amap.com
```

整域解密，因为各版本 App 的网关不固定：`m5.amap.com`、`m5-zb.amap.com` 是主网关，
`sns.amap.com` 承载消息盒子，`amap-aos-info-nogw.amap.com` 承载开屏和部分首页接口，
新版还会用 `aos.amap.com` 之类没列过的子域。白名单少一个，那个接口就静默不生效。


## 没有做什么

- **不拦地图、定位、导航业务域名**：`restapi.amap.com`、`apilocate.amap.com`、
  `m5.amap.com` 同时承载地图瓦片、定位、路线规划。拦了导航会直接不可用。
- **不删本地 UI 入口**：底部 Tab、设置页入口是 App 本地 UI，代理层只能让它下发不了
  内容，删不掉入口本身。
- **不能阻止核心位置上传**：导航必须上传起终点和位置才能算路。代理层只能拦已知的
  日志 / 曝光上报，不能在不破坏导航的前提下切断位置数据。
- **天气卡片没动**：`/ws/valueadded/weather` 可以返回 `{}`，但天气本身不是广告，
  默认保留，想要更干净可自行在插件里加一条 `reject-dict`。

## 和 ADBlock 模块的关系

`ADBlock` 模块里已经有几条高德规则（`m5.amap.com/ws/valueadded/`、`sns.amap.com/ws/msgbox/pull`、
`optimus-ads.amap.com` 等）。两个模块同时开启不会冲突，但同一条请求可能被处理两次；
如果只想保留一套，建议留 AMap Clean 的脚本版，把 ADBlock 里对应的几条高德规则停用。

## 如果广告又出来了

1. 在 Loon / Egern / Shadowrocket 的请求日志里找高德地图的请求，记下完整 URL；
2. 看响应体是 JSON 还是图片 / protobuf；
3. 如果是新的 JSON 接口，把 URL 和响应体（脱敏后）发过来，按真实结构补脚本；
4. 如果是新的图片 / 视频地址，直接加到 `[Rewrite]` / `url_rewrites`。

需要重点抓的接口：

```text
开屏   /ws/valueadded/alimama/splash_screen
       /ws/aos/alimama/splash_screen
首页   /ws/faas/amap-navigation/main-page
我的   /ws/faas/amap-navigation/usr-profile-fc/homeV2
       /ws/shield/dsp/profile/index/nodefaas（旧版）
搜索   /ws/shield/search/new_hotword
       /ws/shield/search/nearbyrec_smart
       /ws/shield/scene/recommend
消息   /ws/msgbox/pull
       /ws/message/notice/list
探索   /v1/ai_rec/home_explore
打车   /ws/promotion-web/resource
配置   /ws/shield/frogserver/aocs/updatable
上报   任何包含 log / stat / report / track / collect / beacon / aos-info 的域名
```

抓包时请一并提供高德版本号（设置 → 关于高德地图）。

## 规则来源

接口清单与字段取舍参考了 [可莉的高德地图去广告](https://hub.kelee.one)（`Amap_remove_ads.lpx`），
在其基础上改成三端共用的 JS 实现，并补上「探索」页 SSE 流的过滤。
