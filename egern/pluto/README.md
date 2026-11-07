# Pluto TV — Egern 模块

- Egern：`egern/pluto/pluto-adfree.yaml` + `js/pluto_adfree.js`
- Loon：`loon/pluto/pluto-adfree.plugin`

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

## 第二道：清单里删广告段

`serverSideAds=false` 之后 stitcher 不再缝第三方广告，但还有两样东西留得下来：

- 转场 bumper：分片名里带 `_ad_bumper` 的 Pluto 台标动画，5~25 秒
- 部分片源残留的 `_ad/creative`，常见形式是百分号编码的 `_ad%2Fcreative`

所以再加一层清单过滤：命中这些标记的分片整段删掉；另外落在
`#EXT-X-CUE-OUT` 与 `#EXT-X-CUE-IN` 之间的分片也一并删，这样不依赖分片命名。

几条安全边界：

- 只处理点播清单（有 `#EXT-X-ENDLIST`、且不是 master）。直播清单原样放行——
  直播的广告就是当时的播出内容，删段会让时间轴错位、反复重缓冲。
- 删段时保留 `#EXT-X-DISCONTINUITY`：广告前后的正片来自不同编码，时间戳本来就有跳变。
- 裁掉超过 40% 时长视为判断错了，整份清单原样放行——宁可留广告，不能把正片删了。

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

## 注意

- 需开启 MitM：`boot.pluto.tv`、`pluto.tv`、`*.pluto.tv`、`*.prd.pluto.tv`
  （清单在 `service-manifest-generator-*.prd.pluto.tv`）。视频 CDN 不用 MITM。
- 会话 JWT 的有效期是 8 小时（`refreshInSec: 28800`）。开启模块后如果还有广告，
  先强制退出 App 再打开，让它重新走一次 boot。
- 这套做法基于 boot 接口的实际行为（参数会写进签名 JWT 和 `stitcherParams`）。
  **App 端效果需要实测**：如果强制退出后仍有广告，说明 App 没走
  `boot.pluto.tv/v4/start`，抓包确认一下 boot 请求的域名和路径是不是变了。
- 点播的转场 bumper 现在会被删掉。直播频道没有清单可改，原位置上仍然是那段台标
  动画，这是 stitcher 的转场，不是广告。
- 图标：Streaming.png
