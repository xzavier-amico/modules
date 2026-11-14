# Pluto TV — Egern 模块

- Egern：`egern/pluto/pluto-adfree.yaml` + `js/pluto_adfree.js`
- Loon：`loon/pluto/pluto-adfree.plugin`

去广告 + 字幕翻译。去广告的做法是让 stitcher 不把广告缝进视频，而不是去拦广告素材；
字幕翻译在播放器请求外挂 WebVTT 分片时进行，默认英文原句在上、中文翻译在下。

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

模块把 App 的 boot 请求改成 `serverSideAds=false`，减少服务端广告插入。
服务端仍可能下发拼接广告，因此还需要下面的 HLS 过滤；视频分片本身不改。

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

所以按 clip 分组判断：同一部片子的所有分片都在同一个 clip 下，广告来自别的 clip。
按 clip 累计时长，占绝对大头的是正片，占比很小的 clip 整组删掉。另外两种老形态
（`_ad_bumper` 标记、`CUE-OUT` 区间）也一并兼容。

分组键取的是 **clip ID**（`/clip/<id>/` 或 `/creative/<id>/` 里的 `<id>`），不是
分片所在的目录。点播清单会把同一部片子切成多个 range 目录
（`.../clip/<content>/720p/.../hls/0-1155588`、`.../hls/1155589-2447457`），
按目录分组会把它们当成不同 clip，短的那个 range 会被误删。分片地址是相对路径时，
用当前生效的 `EXT-X-KEY` URI 取 clip ID（key 和分片在同一个 clip 目录下）。

几条安全边界：

- 只处理点播清单。除了 `#EXT-X-ENDLIST`、`PLAYLIST-TYPE:VOD`，还认 URL 里的
  `/vod/`、`/movie/`、`/episode/`：stitcher 的点播会话有时也是滚动窗口（只有几个
  分片、media sequence 不为 0），只看清单内容会把它当成直播漏掉。直播清单原样放行。
- 明确标记（广告路径、creative、bumper、CUE 区间）独立删除，不再因广告超过 40%
  而整份放行。只有完整点播清单有主要内容时，才按短 clip 推断无标记广告。
- 短 clip 按每次连续出现的时长（不超过约 60 秒）判断；同一个 30 秒广告重复多次，
  不会再因全片累计超过 60 秒漏掉。60% 保留保护只约束这类时长推断。
- 删段后保留已有不连续边界，在删段接缝补 `#EXT-X-DISCONTINUITY`，恢复生效的
  KEY / MAP，并为 AES-128 隐式 IV 写入原始分片序号，避免删段导致正片解密失败。
- 不再按文件名排除 `master.m3u8`：脚本根据内容区分主清单和媒体清单。
- 整个窗口只有广告、或滚动窗口只有无标记 clip 时，当前无缓存实现不能可靠推断
  正片身份，会放行。尚无用户此次漏广告的实际清单；离线回归不代表真机问题已完全解决。

## 第三道：清掉会话里的 adBreaks

进度条上的广告块、左上角的 Ad 角标、广告期间禁止拖动，都来自 stitcher 会话
（`/v3/session.json`）里的 `adBreaks` 数组。清单里的广告段删掉之后，这份元数据
也得跟着清空，否则会出现「画面已经是正片，进度条还在报广告」的错位。

`pluto_session.js` 把 `adBreaks` 换成 `[]`，只做字符串级替换，不解析整份 JSON
（点播会话约 1.7MB）。直播会话（`streamType: "channel"`）不动——直播广告删不掉，
角标留着至少能知道现在在广告里。

## 字幕翻译

Pluto 的字幕是外挂 WebVTT，不是烧进视频流的 CEA-608。主清单里能看到：

```
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",
  DEFAULT=NO,FORCED=NO,URI="subtitle/subs/en/playlist.m3u8?...",LANGUAGE="en"
```

字幕播放列表里是一串 `siloh-*.plutotv.net` 上的 `.vtt` 分片，每个分片是标准
WebVTT（带 `X-TIMESTAMP-MAP`）。`pluto_manifest.js` 复制一条 `NAME="Chinese"`、
`LANGUAGE="zh"` 的字幕轨指向同一个 URI，原英文轨保留；`pluto_subtitle.js` 在分片
响应里翻译 cue 文本。

双语同时显示靠 WebVTT 的 cue 定位：一条字幕拆成两条同时段的 cue，英文原句在上、
中文翻译在下。源字幕自带 `line:0%`（歌词贴顶）时保留原位置；普通对白让中文落在
90%，英文按自己的行数往上让。SRT 没有定位能力，所以 Tubi 那边只能把两行挤在一条
cue 里。

直播每 5 秒一个分片，只有带 cue 的分片才会发起翻译。Edge 免费接口可能限流，
在意稳定性就填一个 DeepL 或 Google Cloud 密钥；翻译失败时原样返回英文字幕，
不影响播放。

## 规则

模块**不再在 `rules` 里指定 `PROXY`**：Egern 的模块规则按名字引用策略，名字对应的
代理/策略组不存在时规则不可用，模块也会跟着报错。Pluto 美国内容需要美国节点，
请在主配置里自行把下面两个域名指向你的美国策略组：

| 域名 | 用途 |
| --- | --- |
| `pluto.tv` | 接口、boot、stitcher |
| `plutotv.net` | 视频 CDN |

`doubleclick.net` 与 `springserve.com` 属于通用广告域名，已统一由
[ADBlock](../adblock/) 拦截，本模块不再重复声明。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 关闭后广告改写全部跳过 |
| `caption_lang` | `zh-Hans` | 字幕翻译语言：`zh-Hans` / `zh-Hant` / `off` |
| `bilingual` | true | 双语字幕：英文原句在上、中文翻译在下；`false` 只显示中文 |
| `translate_key` | 空 | DeepL Auth Key 或 Google Cloud Translation API Key（`AIza` 开头）；留空用免费 Edge |
| `translate_provider` | `auto` | `auto` / `edge` / `deepl` / `google` |

## 注意

- 需开启 MitM：`boot.pluto.tv`、`pluto.tv`、`*.pluto.tv`、`*.prd.pluto.tv`、
  `*.plutotv.net`。点播媒体清单和字幕分片也会从 `siloh-*.plutotv.net` 直接下发，
  不加这条 HLS / 字幕脚本不会执行。视频分片本身不改写，只有 `.m3u8` 和 `.vtt`
  响应会被脚本处理。
- 字幕轨默认仍是关闭的，需要在播放器的字幕菜单里打开。菜单里会多一条
  `Chinese`；如果播放器只显示原来的 `English`，选它也是同一份双语内容。
- 字幕按分片翻译：直播每 5 秒一片，每个分片要等一次翻译请求（通常几百毫秒）。
  播放器会预取后面的分片，正常播放时基本感知不到。
- 会话 JWT 的有效期是 8 小时（`refreshInSec: 28800`）。开启模块后如果还有广告，
  先强制退出 App 再打开，让它重新走一次 boot。
- 这套做法基于 boot 接口的实际行为（参数会写进签名 JWT 和 `stitcherParams`）。
  **App 端效果需要实测**：如果强制退出后仍有广告，说明 App 没走
  `boot.pluto.tv/v4/start`，抓包确认一下 boot 请求的域名和路径是不是变了。
- 点播的转场 bumper 现在会被删掉。直播频道没有清单可改，原位置上仍然是那段台标
  动画，这是 stitcher 的转场，不是广告。
- 图标：`icon/pluto.png`（Pluto TV 官方 App 图标）
