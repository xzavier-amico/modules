# Pluto TV — Loon 插件

- Loon：`loon/pluto/pluto-adfree.plugin` + `js/pluto_adfree.js`
- Egern：`egern/pluto/pluto-adfree.yaml`

去广告。做法是让 stitcher 不把广告缝进视频，而不是去拦广告素材。

## 为什么不能拦广告域名

Pluto 是服务端拼接（SSAI）：直播和点播都走自家 stitcher
（`cfd-v4-service-channel-stitcher-*.prd.pluto.tv`），广告片被直接拼进 HLS，
用 `#EXT-X-DISCONTINUITY` / `#EXT-X-CUE-OUT` 和 ID3 标出。客户端只是照单播放，
所以拦广告素材域名没有用，拦了只会让正片跟着断。

用 Google DAI 承载的那批频道更直观，实测媒体清单：

```
#EXT-X-DISCONTINUITY
#EXT-X-CUE-OUT:210.043
#EXTINF:9.009,
https://dai.google.com/linear/pods/v1/p/.../slate/0/.../0.ts
```

广告就是清单里的普通分片。

## 那改什么

stitcher 的会话 JWT 里有一个 `serverSideAds` 标志，它来自 boot 接口的查询参数：

```
GET https://boot.pluto.tv/v4/start?...&serverSideAds=true
→ JWT payload: {"serverSideAds": true, ...}
```

同一接口传 `false`，JWT 里就是 `false`。网页端一直传 `false`（网页自己用 IMA
做客户端广告），App 传 `true` 走服务端拼接。

模块把 App 的 boot 请求改成 `serverSideAds=false`，stitcher 返回的就是纯内容清单。
不碰视频流、不碰 stitcher 响应。

## 规则

| 域名 | 策略 | 用途 |
| --- | --- | --- |
| `pluto.tv` | PROXY | 接口、boot、stitcher |
| `plutotv.net` | PROXY | 视频 CDN |
| `doubleclick.net` | REJECT | 客户端广告（IMA） |
| `springserve.com` | REJECT | 广告同步 |

美国内容需要美国节点；不在美国，或想指定别的策略组，把前两条的 `PROXY`
改成 `DIRECT` 或你的策略组名。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 关闭后脚本不做任何修改 |
| `verbose_log` | false | 打印 boot 请求的改写结果 |

## 注意

- 需开启 MitM：`boot.pluto.tv`。
- 会话 JWT 的有效期是 8 小时（`refreshInSec: 28800`）。开启模块后如果还有广告，
  先强制退出 App 再打开，让它重新走一次 boot。
- 这套做法基于 boot 接口的实际行为（参数会写进签名 JWT）。**App 端效果需要实测**：
  如果强制退出后仍有广告，说明 App 没走 `boot.pluto.tv/v4/start`，把 `verbose_log`
  打开，日志里没有 `pluto: boot` 就是没命中。
- 补充实测：用 `serverSideAds=false` 的美国直播流连续采样 15 分钟，广告位仍然会拼一段
  5~25 秒的 Pluto 台标 bumper（分片名里带 `ad_bumper`），但清单里没有真正的广告片。
  所以开启模块后，原来放广告的位置可能看到一小段台标动画，这是 stitcher 的转场，不是广告。
- 图标：Streaming.png
