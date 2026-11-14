# Tubi — Loon 插件

- Loon：`loon/tubi/tubi-clean.plugin` + `js/tubi_adfree.js` + `js/tubi_caption.js`
- Egern：`egern/tubi/tubi-clean.yaml`
- Shadowrocket：`shadowrocket/tubi/tubi-clean.sgmodule`

去广告 + 字幕翻译。去广告的做法是让播放器根本拿不到广告位，顺带让广告接口回答
「没有广告」，视频流本身不动；字幕翻译只在播放器请求带 `tlang` 标记的字幕轨时生效。

## 为什么可以这么做

Tubi 的广告是客户端插入（CSAI），不是把广告缝进视频里。实测一部片子的 HLS 媒体清单：
833 个分片、单一 `k4ctumsr.mp4` 源、没有任何 `#EXT-X-DISCONTINUITY` 或 `EXT-X-CUE-OUT`。
广告位写在内容元数据里（`monetization.cue_points`，例如 `[0,105,543,950,...]`），
播到对应秒数时播放器再单独发一个请求要广告，拿到 `{ ads: [...] }` 后插进去播。
广告列表为空时播放器直接继续正片，这是它自己的正常分支。

所以最省事的一刀是**把 cue_points 清空**：没有广告位，播放器不会在 50 分钟那种中途
位置发起广告请求，也就不会走到「广告服务没返回 → 补一段备用推广片」的兜底分支。
后者是纯改广告响应治不了的：两个 30 秒、无缝衔接、不能跳过，正是兜底推广片的形态。

## 改写了什么

| 请求 | 原响应 | 改成 |
| --- | --- | --- |
| `tubitv.com/oz/videos/<id>/content` 等内容 / 接口 JSON | `monetization.cue_points: [0,105,…]` | `cue_points` 清空，其余字段原样 |
| `rainmaker*.production-public.tubi.io/…/rev/vod/…` | `{"ads":[…],"metrics":{…}}` | `ads` 清空，`metrics.responseTime` 补上，其余字段原样 |
| `ads.adrise.tv`、`ads.tubi.io`、`ads.production-public.tubi.io`、`ads.tubitv.com` | VAST / VMAP / JSON | 空 VAST（沿用原版本号）、空 VMAP、或清空 `ads` |

`ads` / `cue_points` / `ad_breaks` / `ad_pods` 这几个字段只要确实是数组就清空（含嵌套），
JSON 里内嵌的 VAST 字符串只替换那一个字段；其余响应原样放行。所以接口换形状时
最差也只是脚本不生效，不会把播放改坏。

## 字幕翻译

Tubi 的字幕是一整份 SRT，地址在内容元数据的 `subtitles` 数组里
（`http(s)://s.adrise.tv/<uuid>.srt`）。脚本把第一条字幕轨复制一份，URL 追加
`?tlang=<caption_lang>`（默认 `zh-Hans`），语言名设为 `Chinese`，字幕菜单里会多出
「中文」。Tubi 播放器只认固定的语言名枚举（`chinese`），所以简繁由 URL 的 `tlang`
决定，菜单标签统一显示「中文」。播放器请求这条轨时，`tubi_caption.js` 才会把 SRT
文本送去翻译。默认是双语：英文原句在上、中文翻译在下，序号、时间轴、换行和 BOM
原样保留；原英文字幕轨始终不受影响，`bilingual=false` 时中文轨只显示翻译。
追加的 URL 还带 `trv`（翻译版本）和 `bl`（`1` 双语 / `0` 纯中文）：App 把字幕 URL
当作字幕缓存键，改这两个参数就会换一条新 URL，旧缓存自然失效；`bl` 同时是该轨内容的
唯一依据，缓存内容不会和参数对不上。以后改了翻译逻辑，把 `tubi_adfree.js` 里的
`TRACK_VERSION` 加一即可让所有客户端重新拉取。
网页端读 `/oz/videos/<id>/content`，手机 App 读
`/api/v2/mobile/contents`（返回 `{ "<content_id>": { …视频对象… } }`），脚本两种
形状都会递归查找 `subtitles` 并追加。

翻译接口按下面的顺序选择，密钥接口失败时自动回退到免费的 Edge，全部失败则
原样返回英文字幕，不影响播放：

| `translate_provider` | `translate_key` | 实际接口 |
| --- | --- | --- |
| `auto`（默认） | 空 / `none` | 微软 Edge 免费接口 |
| `auto` | `AIza…` | Google Cloud Translation v2 |
| `auto` | 其它 | DeepL（`:fx` 结尾走 free 端点） |
| `edge` / `deepl` / `google` | 按指定 | 显式指定；DeepL / Google 失败仍回退 Edge |

一部 1700 条字幕的片子会按 800 条 / 28k 字符一批并发翻译，首次加载通常几秒。
Edge 接口未公开、可能限流；在意稳定性就填一个 DeepL 或 Google Cloud 密钥。

## 为什么不是直接 reject

Tubi 带反广告拦截：网页端会去拉 `https://mcdn.tubitv.com/js/ads.js` 这个诱饵，
播放器里还有 `MAX_AD_REQUEST_BLOCKED_CONTINUOUS_COUNT` 计数和
`AD_REQUEST_BLOCKED_ERROR`。把广告域名直接 reject 会被计入拦截次数，轻则弹提示，
重则不给播。返回合法的空广告响应走的是正常业务分支，不触发这些检测。

## 规则（美国线路）

Tubi 只在美国可用。插件的 `[Rule]` 段把它的域名固定指向 `PROXY`：

| 域名 | 用途 |
| --- | --- |
| `tubitv.com` | App 接口、网页、静态资源 |
| `tubi.com` | 301 跳到 tubitv.com |
| `tubi.tv` | 302 跳到 gdpr.tubi.tv |
| `tubi.video` | 视频 CDN |
| `tubi.io` | 接口与广告 |
| `adrise.tv` | 广告（`ads.adrise.tv`） |

这样不会被「国内直连」之类的规则带走，导致 MITM 看不到流量、插件静默失效。
如果你本身在美国，或想指定某个节点/策略组，把 `[Rule]` 里这六行的 `PROXY`
改成 `DIRECT` 或你的策略组名即可。

## 网页版

网页版读 `tubitv.com/oz/videos/<id>/content` 的内容元数据，和 App 的
`/api/v2/mobile/contents` 共用同一套 `cue_points` / `subtitles` 结构，所以模块默认
同时处理两者：

- `web=true`（默认）：网页版内容元数据也会清空 `cue_points` 并追加中文轨；
- `web=false`：只处理 App 接口，网页版内容原样放行。

广告域名（`ads.*`、`rainmaker*`、`adrise.tv`）与空 VAST / VMAP 是网页版和 App 共用
的，不受 `web` 影响。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 去广告；关闭后只跳过广告改写，字幕翻译仍按 `caption_lang` 工作 |
| `caption_lang` | `zh-Hans` | 追加的字幕轨语言：`zh-Hans` / `zh-Hant` / `off` |
| `bilingual` | true | 双语字幕：中文轨保留英文原句并在下方显示翻译；`false` 只显示中文 |
| `translate_key` | 空 | DeepL Auth Key 或 Google Cloud Translation API Key（`AIza` 开头）；留空用免费 Edge |
| `translate_provider` | `auto` | `auto` / `edge` / `deepl` / `google` |
| `web` | true | 同时处理网页版 `tubitv.com/oz/` 的内容元数据；关闭后只改 App |

## 注意

- 需开启 MitM，插件用的是通配：`tubitv.com`、`*.tubitv.com`、`tubi.io`、`*.tubi.io`、
  `*.adrise.tv`。别收窄成具体主机名——广告请求换个子域（比如 `ads.tubitv.com`）
  就会从 MITM 漏掉，表现是「开头能去广告，播到一半的 mid-roll 又出来了」。
- 别再用别的规则 reject 上面这些域名，会和本插件冲突（见上一节）。
- 广告位被清掉后，暂停、拖动进度都不会再触发广告；观感上就是直接进正片。
- 字幕轨是追加而不是替换：播放时要在字幕菜单里选「中文」（默认双语，英文在上、中文在下）；看不到就先退出
  片子重进，让 App 重新拉一次内容元数据。若某个版本的 App 会丢掉字幕 URL 的查询参数，
  翻译不会触发（会正常播放英文字幕），这属于客户端行为，脚本侧无法补救。
- 图标：`icon/tubi.png`（Tubi 官方 App 图标）
