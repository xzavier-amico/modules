# Delivery Ad-Free — Egern 模块

- Egern：`egern/delivery/delivery-adfree.yaml`
- Loon：`loon/delivery/delivery-adfree.plugin`

京东 / 美团 / 饿了么：域名层拒绝广告服务，MITM 层改写独立广告接口，并保守过滤信息流里的广告条目。

## 拦截方式

**1. 域名层（REJECT）**

| App | 域名 | 用途 |
| --- | --- | --- |
| 京东 | `img-x.jd.com` | 广告素材 CDN |
| 京东 | `ccc-x.jd.com`、`cc.m.jd.com`、`x.jd.com` | 广告点击 |
| 京东 | `c-nfa.jd.com` | 曝光 / 效果监测 |
| 京东 | `dsp-x.jd.com`、`bdsp.x.jd.com` | 广告投放（DSP） |
| 京东 | `ads-union.jd.com`、`jzt.jd.com`、`addata.jd.com` | 联盟广告 / 京准通 / 广告数据 |
| 京东 | `knicks.jd.com`、`mars.jd.com`、`orbit.jd.com` | 营销服务 |
| 美团 | `impdsp.meituan.com` | 美团 DSP（首页返回 `This is MtDsp`） |
| 美团 | `ad.e.waimai.sankuai.com` | 外卖广告接口 |
| 饿了么 | `adashx.ut.ele.me` / `h-adashx` / `v6-adashx` | 阿里妈妈广告曝光与点击统计 |
| 三家通用 | `pangolin-sdk-toutiao*.com`、`pglstatp-toutiao.com`、`pangle.io` | 穿山甲广告 SDK |
| 三家通用 | `gdt.qq.com`、`pgdt.gtimg.cn` | 优量汇广告 SDK |
| 三家通用 | `mobads.baidu.com`、`cpro*.baidu.com` | 百度联盟广告 SDK |
| 三家通用 | `irs01.com`、`irs01.net` | 艾瑞广告监测 |

**2. MITM 改写（响应换成 `{}`）**

| 接口 | 作用 |
| --- | --- |
| `wmapi.meituan.com/api/v*/startpicture` | 美团外卖开屏素材 |
| `wmapi.meituan.com/api/v*/loadInfo` | 美团外卖开屏配置 |
| `wmapi.meituan.com/api/v*/openscreen` | 美团外卖开屏曝光回调 |
| `rms.meituan.com/diancan/api/queryAdBoard` | 美团点餐页广告板 |
| `homepage-gw.jd.com/npromotion` | 京东首页促销楼层 |

这三个接口都只返回广告数据，改成 `{}` 后客户端拿不到素材就直接跳过，
不会留白块。饿了么的开屏接口没有可靠抓包，暂时只做域名层。

**3. 信息流过滤（保守，`js/delivery_clean.js`）**

跑在美团 / 饿了么 / 京东的主接口响应上，只删数组里明确带广告标记的条目：

- `is_ad` / `isAd` 为 true
- `ad_type` / `adType` 有值，并且同时带 `ad_id` / `adId`
- `card_type` / `cardType` 以 `ad_` / `ad-` 开头

只删数组元素，不删对象字段；没有命中、解析失败、结构对不上都原样放行。
body 里出现 16 位以上连续数字时直接跳过——JSON 往返会截断超过 2^53 的数字，
宁可这条不处理，也不要把订单号、商品 ID 改坏。

字段名是按常见写法猜的，可能一条都命中不了；命中不了就是没效果，不会帮倒忙。

## 没有拦什么

- `api.m.jd.com`、`api.smart.jd.com`、`mapi.m.jd.com`：京东的业务 API 网关。
  不少公开广告列表会把 `mapi.m.jd.com` 一起拦掉，实测那会让京东 App 直接打不开。
- `client-api.ele.me`、`newton-api.ele.me`：饿了么业务接口，拦了会白屏。
- `grand.ele.me`：解析到 `sopush` 推送，拦了收不到消息。
- `d.meituan.net`、`report.meituan.com`、`wmlog.meituan.com`：统计与日志域名，
  不是广告；拦掉可能影响优惠券归因，收益也看不见。
- `mads.meituan.com`：解析到点评会员营销，用途不明确，先不拦。

## 能解决什么、不能解决什么

- **能解决**：开屏广告（美团）、点餐页广告板（美团）、首页促销楼层（京东）、
  广告 SDK 的素材与曝光、广告点击与监测。
- **部分解决**：首页信息流里的广告条目——脚本按 `is_ad` / `ad_type`+`ad_id` /
  `card_type=ad_*` 三个标记删，命中就删，命中不了就没效果。字段名是猜的，
  想做到「干净」还是需要一份真实抓包，按实际结构改脚本。
- **也不能解决**：「我的」「设置」里的推广入口。入口是 App 本地 UI 或接口下发的
  位置，只能让它加载不出内容，删不掉入口本身。

## 注意

- 域名层不需要 MITM；MITM 层的改写需要装证书并开启 MITM，域名是
  `wmapi.meituan.com`、`rms.meituan.com`、`homepage-gw.jd.com`。
- 第三方广告 SDK 那一段是全局规则，其它 App 用到同一批 SDK 时也会一起被拦。
- 过滤脚本跑在三家的主接口上，响应体很大时会有一次 JSON 解析开销；如果觉得 App 变慢，
  把 `delivery.clean` 这条脚本规则删掉即可，域名层和开屏改写不受影响。
- 如果某个 App 出现白屏、列表加载不出来，先把本模块关掉确认是不是误伤，再把对应
  域名或改写删掉。三家都是高频交易类 App，宁可少拦也不要拦错。
- 如果开了 MITM 后美团 / 京东出现打不开、一直转圈或「网络异常」，多半是 App 做了
  证书固定（SSL Pinning），代理改不了它的流量。先把本模块关掉确认；确认是固定就只能
  走客户端注入，代理层没有别的办法。
- 和 `ADBlock` 模块有重叠：那边也有美团 `wmapi.meituan.com` 开屏的重写，两边同时开
  不冲突，只是同一条请求会被处理两次。
