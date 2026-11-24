# Shopping Clean（原 Delivery Clean）— Egern 模块

- Egern：`egern/delivery/delivery-clean.yaml` + `js/delivery_clean.js`
- Loon：`loon/delivery/delivery-clean.plugin`
- Shadowrocket：`shadowrocket/delivery/delivery-clean.sgmodule`

**京东、淘宝、拼多多、美团、饿了么**五合一去开屏、首页弹窗浮层与搜索/推荐信息流 CPC/CPM/P4P 竞价广告（目录路径保留 `delivery/` 以兼容已导入用户的远程更新链接）。

## 为什么之前装了完全没效果

1. **旧脚本的 `if (/\d{16,}/.test(body))` 自杀式早退（最根本原因）**：
   旧脚本第 29 行直接用 `/\d{16,}/.test(body)` 测试整段原始文本（**连引号里面的字符串都算**）。而京东、淘宝、美团、饿了么的几乎每一条 JSON 响应里都包含 16~19 位的订单号、商品 `skuId`、`shopId`、`traceId` 或毫秒时间戳拼接串。结果旧脚本在 `JSON.parse` 之前就 **99.9% 直接 `$done({})` 放弃改写**了！
   现已改为**只用占位符保护字符串外的 16+ 位整数**，序列化后再原样还原，既不会早退，也绝不丢失 64 位整数精度。
2. **京东 POST `functionId` 与真实楼层结构**：
   京东 `client.action` 的 `functionId` 经常放在 POST 请求体或响应结构里（`floorList` / `floors` / `subFloors`），并不叫旧脚本盲猜的 `card_type: "ad_*"`。现已改为**不限制 URL query 必带 `functionId`**，直接按响应特征结构识别 `welcomeHome`、`personinfoBusiness` 与商品流。

## 覆盖范围（五合一购物 & 外卖）

| 平台 | 域名 / 接口 | 处理 |
| --- | --- | --- |
| **京东** (`api.m.jd.com` / `homepage-gw.jd.com`) | `client.action` / `api`、`npromotion` | 拦截开屏与促销网关；删首页 `floatLayer` / `xview` / `topAtmosphere` / `shimmer` 浮层弹窗，过滤 `floorList` 与 `subFloors` 广告楼层；过滤搜索/推荐流带 `adIcon` / `adword` / `exposalUrl` 的竞价商品；`clean_ui=true` 时隐藏「我的」页白条 / 金条 / 借钱 / 小金库 / 互动游戏楼层 |
| **淘宝 / 天猫** (`guide-acs.m.taobao.com` / `trade-acs.m.taobao.com`) | `gw/mtop.*` | 规则拦截 `tanx.com`、`alimama.com`、`simba.taobao.com`；Rewrite 拦截开屏与营销接口；脚本剥离首页 `containers` / `sections` 与搜索结果里的 `is_p4p` / `p4p_data` / `poplayer` 直通车广告（兼容 JSON 与 MTOP JSONP）；`clean_ui=true` 时隐藏「我的淘宝」借钱、芭芭农场、斗地主小游戏楼层 |
| **拼多多** (`api.pinduoduo.com` / `api.yangkeduo.com`) | `/api/oak/`、`carnival`、`cappuccino/splash`、`search` | 规则拦截 `t-dsp` / `m-ad.pinduoduo.com`；Rewrite 拦截开屏与大促弹窗；脚本删 `activity_integration_popup` / `popup_list` / `float_window`，过滤 `goods_list` 里带 `p_search.is_ad` / `ad` 的竞价商品；`clean_ui=true` 时隐藏多多视频、现金大转盘入口 |
| **美团 / 美团外卖** (`wmapi` / `apimobile` / `mapi` / `i.meituan.com` / `wx.waimai`) | `startpicture`、`queryAdBoard`、`poilist`、`module_list` | Rewrite 拦截开屏、点餐广告板与灵珑营销包；脚本过滤 `poilist` / `module_list`（含 `string_data` 内嵌 JSON）里带 `charge_info` (CPC/CPM 计费串)、`ad_mark`、`is_ad` 的竞价排名店铺，删 `ad_banner` / `floating_layer` |
| **饿了么** (`waimai-guide` / `client-api` / `newton-api.ele.me`) | `h5/mtop.*` | 过滤 `is_p4p`、`p4p_data`、`brand_ad`、`ad_data` 竞价商家卡，删 `float_ad` / `popup_ad` |

## 参数 (`env_schema`)

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | `"true"` | 去五家购物与外卖平台的开屏、弹窗浮层与搜索/推荐流竞价推广卡片 |
| `clean_ui` | `"false"` | 额外隐藏京东白条/金条/借钱、淘宝借钱/小游戏、拼多多多多视频/领现金大转盘等模块 |
