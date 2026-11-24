# Delivery Clean — Egern 模块

- Egern：`egern/delivery/delivery-clean.yaml` + `js/delivery_clean.js`
- Loon：`loon/delivery/delivery-clean.plugin`
- Shadowrocket：`shadowrocket/delivery/delivery-clean.sgmodule`

美团、饿了么、京东去开屏、弹窗浮层与信息流 CPC/CPM 推广卡片。只改 JSON 响应，不碰图片与支付下单链路。

## 为什么之前装了没感觉（本次修复点）

1. **QUIC (HTTP/3) 绕过 MITM**：美团、京东、饿了么全面启用了 QUIC，之前缺少 `PROTOCOL, QUIC` 拒绝规则，请求直接走 UDP 绕过了代理。现已对 `jd.com`、`meituan.com`、`sankuai.com`、`ele.me` 强制拒绝 QUIC 回退 HTTPS。
2. **16 位数字大整数检查误杀 99% 响应**：旧版脚本用 `/\d{16,}/.test(body)` 检查整段原始文本（含字符串内的订单号、SKU ID、traceId），一旦命中就直接 `$done({})` 退出。现已改为**占位符保护字符串外的 16+ 位整数**，既不早退也不丢精度。
3. **真实接口与字段补齐**：按京东 `functionId`、美团外卖 `poilist`/`module_list` 的 `charge_info`/`ad_mark`、饿了么 `mtop` 的 `is_p4p`/`brand_ad` 重写过滤逻辑。

## 改了什么

| 平台 | 接口 / 范围 | 处理 |
| --- | --- | --- |
| 京东 (`api.m.jd.com`) | `functionId=start` / `home_launchConfig` / `splash` | 清空开屏数组并把投放时间推到 2040 年 |
| 京东 (`api.m.jd.com`) | `functionId=welcomeHome` | 删首页 `floatLayer` / `xview` / `topAtmosphere` / `shimmer` 浮层弹窗，过滤 `floorList` 广告楼层 |
| 京东 (`api.m.jd.com`) | `functionId=personinfoBusiness` | 过滤「我的」页 `floors` 里的广告楼层；`clean_ui=true` 时额外删白条 / 金条 / 借钱楼层 |
| 京东 (`api.m.jd.com`) | `functionId=search` / `uniformRecommend` / `wareBusiness` | 过滤商品流里带 `adIcon` / `isAd` / `adword` 的推广商品 |
| 美团 (`*.meituan.com`) | `/api/v<n>/startpicture` / `loadInfo` / `openscreen` | URL Rewrite 拦截 + 脚本兜底推迟有效期 |
| 美团 (`*.meituan.com`) | 外卖与主站信息流 (`poilist` / `module_list` / `card_list`) | 过滤带 `is_ad` / `ad_mark` / `charge_info` (CPC/CPM 计费串) / `adInfo` 的竞价排名店铺，删 `ad_banner` / `floating_layer` |
| 饿了么 (`waimai-guide.ele.me`) | `h5/mtop.*` 推荐与商家流 | 过滤 `is_ad` / `ad_data` / `brand_ad` / `is_p4p` / `p4p_data` 推广卡片，删 `float_ad` / `popup_ad` |

## 参数 (`env_schema`)

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | `"true"` | 去开屏、弹窗浮层与商家/商品流里的竞价推广卡片 |
| `clean_ui` | `"false"` | 在京东「我的」页额外隐藏白条、金条、借钱等金融营销楼层 |
