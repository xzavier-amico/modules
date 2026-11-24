# Delivery Clean — Loon 插件

- Loon：`loon/delivery/delivery-clean.plugin` + `js/delivery_clean.js`
- Egern：`egern/delivery/delivery-clean.yaml`
- Shadowrocket：`shadowrocket/delivery/delivery-clean.sgmodule`

美团、饿了么、京东去开屏、弹窗浮层与信息流 CPC/CPM 推广卡片。只改 JSON 响应，不碰图片与支付下单链路。

## 为什么之前装了没感觉（本次修复点）

1. **QUIC (HTTP/3) 绕过 MITM**：美团、京东、饿了么全面启用了 QUIC，之前缺少 `PROTOCOL, QUIC` 拒绝规则，请求直接走 UDP 绕过了代理。现已对 `jd.com`、`meituan.com`、`sankuai.com`、`ele.me` 强制拒绝 QUIC 回退 HTTPS。
2. **HTTP/2 未声明 `h2 = true`**：网关大量使用 HTTP/2，未开启 `h2 = true` 时 `requires-body` 拿不到响应体。
3. **16 位数字大整数检查误杀 99% 响应**：旧版脚本用 `/\d{16,}/.test(body)` 检查整段原始文本（含字符串内的订单号、SKU ID、traceId），一旦命中就直接 `$done({})` 退出。现已改为**占位符保护字符串外的 16+ 位整数**，既不早退也不丢精度。
4. **Loon Rewrite 语法与真实接口补齐**：将旧版 Surge 风格的 `reject-dict` 改为 Loon 原生 `request if ${url} ~= ... then reject_dict(200)`，并按三家平台的真实接口结构重写过滤逻辑。

## 改了什么

| 平台 | 接口 / 范围 | 处理 |
| --- | --- | --- |
| 京东 (`api.m.jd.com`) | `functionId=start` / `home_launchConfig` / `splash` | 清空开屏数组并把投放时间推到 2040 年 |
| 京东 (`api.m.jd.com`) | `functionId=welcomeHome` | 删首页 `floatLayer` / `xview` / `topAtmosphere` / `shimmer` 浮层弹窗，过滤 `floorList` 广告楼层 |
| 京东 (`api.m.jd.com`) | `functionId=personinfoBusiness` | 过滤「我的」页 `floors` 里的广告楼层；`clean_ui=true` 时额外删白条 / 金条 / 借钱楼层 |
| 京东 (`api.m.jd.com`) | `functionId=search` / `uniformRecommend` / `wareBusiness` | 过滤商品流里带 `adIcon` / `isAd` / `adword` 的推广商品 |
| 美团 (`*.meituan.com`) | `/api/v<n>/startpicture` / `loadInfo` / `openscreen` |Rewrite 直接返回空字典 + 脚本兜底推迟有效期 |
| 美团 (`*.meituan.com`) | 外卖与主站信息流 (`poilist` / `module_list` / `card_list`) | 过滤带 `is_ad` / `ad_mark` / `charge_info` (CPC/CPM 计费串) / `adInfo` 的竞价排名店铺，删 `ad_banner` / `floating_layer` |
| 饿了么 (`waimai-guide.ele.me`) | `h5/mtop.*` 推荐与商家流 | 过滤 `is_ad` / `ad_data` / `brand_ad` / `is_p4p` / `p4p_data` 推广卡片，删 `float_ad` / `popup_ad` |

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 去开屏、弹窗浮层与商家/商品流里的竞价推广卡片 |
| `clean_ui` | false | 在京东「我的」页额外隐藏白条、金条、借钱等金融营销楼层 |

## 注意

- 需开启 MitM：`api.m.jd.com`、`api.smart.jd.com`、`wmapi.meituan.com`、`apimobile.meituan.com`、`mapi.meituan.com`、`wx.waimai.meituan.com`、`s3plus.meituan.net`、`waimai-guide.ele.me`。
- Loon 请在 MitM 设置中确保开启「MitM over HTTP/2」。
