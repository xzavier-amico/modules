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

## 第二道：清单里删广告段

`serverSideAds=false` 之后 stitcher 仍然会在广告位塞东西。实测一份美国直播流的清单，
广告时段长这样：

```
#EXT-X-DISCONTINUITY
#EXT-X-PROGRAM-DATE-TIME:2026-11-07T03:23:47.667Z
#EXT-X-KEY:...URI=".../494_Pluto_TV_OandO/clip/58e5..._plutotv_error_30_.../hls_300_keyfile_0.key"
#EXTINF:5,
https://siloh-ns1.plutotv.net/494_Pluto_TV_OandO/clip/58e5..._plutotv_error_30_.../hls_300-00000.ts
```

关键点：**广告没有任何 `_ad/creative` 标记，也没有 `EXT-X-CUE-OUT`**，它就是
另一个 clip 的分片——路径前缀和正片（`.../c6009f_pluto/clip/604b...`）完全不同。

所以按 clip 目录分组判断：同一部片子的分片都在同一个目录下，广告来自别的目录。
按目录累计时长，占绝对大头的就是正片，占比很小的目录整组删掉。另外两种老形态
（`_ad_bumper` 标记、`CUE-OUT` 区间）也一并兼容。

几条安全边界：

- 只处理点播清单（有 `#EXT-X-ENDLIST`、声明 `PLAYLIST-TYPE:VOD`，或长清单且
  media sequence 为 0）。直播清单原样放行——直播删段会让客户端在缓冲里跳段。
- 删完只在相邻两段来自不同 clip 时补 `#EXT-X-DISCONTINUITY`；同一 clip 内部是连续的，
  多插一个反而会让播放器误判时间戳跳变。
- 保留时长不足 60% 视为判断错了，整份清单原样放行——宁可留广告，不能把正片删了。

## 第三道：清掉会话里的 adBreaks

进度条上的广告块、左上角的 Ad 角标、广告期间禁止拖动，都来自 stitcher 会话
（`/v3/session.json`）里的 `adBreaks` 数组。清单里的广告段删掉之后，这份元数据
也得跟着清空，否则会出现「画面已经是正片，进度条还在报广告」的错位。

`pluto_session.js` 把 `adBreaks` 换成 `[]`，只做字符串级替换，不解析整份 JSON
（点播会话约 1.7MB）。直播会话（`streamType: "channel"`）不动——直播广告删不掉，
角标留着至少能知道现在在广告里。

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
