# Spotify Enhance — Loon 插件

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-enhance.plugin`

同一份插件适用于 iPhone / iPad 和 **Loon for Mac**：`desktop=auto` 按 User-Agent
自动识别客户端，桌面端只写展示 / 广告属性，默认不写播放授权。

功能：

1. **伪装 Premium**：改写 `bootstrap` / `user-customization-service` 的 protobuf，关闭广告位，移除免费版的试听时长、队列与强制随机限制。
2. **歌词补全**：官方没有歌词时用第三方歌词补全 Now Playing，并补齐 scrollsita 歌词卡。
3. **广告过滤**：过滤首页 / 搜索 / 滚动页的赞助内容，并拦截广告域名。

脚本按字段号局部改写，未知字段和字段顺序原样保留，不做整包重编码。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 伪装 Premium；关闭后不再改账号状态，歌词补全不受影响 |
| `block_ads` | true | 关闭广告属性、广告与推广位配置 |
| `unlock_playback` | auto | `auto` 移动端开启、桌面端关闭；强制 `true` / `false` 覆盖。桌面端写播放授权容易跳歌 |
| `enable_lyrics` | true | 补全歌词；关闭后不加载歌词脚本 |
| `lyrics_source` | auto | 歌词源；`auto` 并发查询网易云 / QQ / LRCLIB，不自动查 Musixmatch |
| `desktop` | auto | `auto` 按 User-Agent 识别 iPhone / iPad 与 Loon for Mac；识别不准时手动指定 `ios` / `macos` |
| `lyrics_script` | hans | 补全的第三方歌词默认转简体（`hans`）；`source` 保持歌词源原文。官方歌词不受影响 |
| `ignore_han_variants` | true | 查歌词时把繁体曲名 / 歌手按简体比较；关闭后繁简写法必须完全一致 |

## 时区

`js/spotify.headers.js` 挂在请求阶段，固定把 URL 里的 `timezone=` 改成账号地区对应的时区。账号地区由 `js/spotify.js` 从 bootstrap / UCS 的 `country` 属性抄到本地存储 `spotify.account.region`；没有记录时看请求里的 `market=XX`，仍然没有就用 `Asia/Hong_Kong`。中国大陆账号会得到 `Asia/Shanghai`，台湾 `Asia/Taipei`，香港 `Asia/Hong_Kong`。

时区只影响请求参数，不改系统时间。脚本不改 `Accept-Language`：Spotify 的歌词语言由账号 / 客户端语言配置决定，改请求头只能影响接口的本地化文案，改不了歌词文本。

## 歌词

1. `js/spotify.js` 把曲目元数据里的 `has_lyrics` 改为 `true`，客户端才会请求 `color-lyrics`；同时把同一条响应里的曲名、歌手、时长存进本地存储（`spotify.track.meta.v2`，最多 24 首）。
2. `js/spotify_lyrics.js` 处理 `color-lyrics/v{N}/track/{id}`：官方有歌词时原样放行；404 / 空歌词时先读上面那份元数据（零外部请求），没有命中才退回公开的 oEmbed / embed 页面，再用第三方歌词合成同结构响应。
3. 合成结果写入 `spotify.lyrics.cache.v2`：同一首歌再次请求时直接命中，不再重复查源。命中缓存保留 24 小时；查不到或超时不缓存，下次会重新查询；最多 24 首（总大小仍限制在 400KB）。换了歌词源（`auto` ↔ `lrclib`）时会按曲目 id 复用旧缓存。从 oEmbed / embed 拿到的曲名、歌手与封面色也会写回 `spotify.track.meta.v2`。

合成规则：

- `auto` 同时请求网易云、QQ、LRCLIB，首个通过歌名 / 歌手 / Live 校验的同步歌词胜出；只有纯文本时等全部结束，或在 5 秒后先发纯文本，避免一直等到总超时。
- 候选请求全部并行：LRCLIB 对完整曲名和去掉装饰括号后的曲名各发 `get` + `search`；网易云 / QQ 搜索后同时请求排名前 3 的候选歌词。任一同步歌词先通过校验就直接返回。
- 歌名比较会忽略 `feat.` / `ft.` / `with` / `prod.`、`Remastered 2011` / `2011 Remaster`、`Radio Edit`、`Single Version`、`Album Version`、`Bonus Track`、`Deluxe Edition`、`Explicit` / `Clean` 等版本后缀；歌手按 `feat.` / `ft.` / `with` 和多歌手分隔符拆分，任意一位匹配即可。
- 曲名 / 歌手比较默认做繁→简折叠（OpenCC t2s 表）：Spotify 的中文元数据常是繁体，网易云 / QQ 返回简体，不折叠时「說謊」对不上「说谎」、「周杰倫」对不上「周杰伦」。关闭 `ignore_han_variants` 后恢复逐字比较。
- 补全歌词默认转简体（`lyrics_script=hans`）：只对判定为繁体的歌词做转换，网易云 / QQ 的简体歌词、英文与日文歌词原样保留；官方歌词不经过这一步。词表随脚本下发（约 30KB），首次用到时才构建，非繁体文本零逐字开销。
- 曲名里带 `()` / `（）` 的装饰信息（影视剧名、节目名、歌手名等）会先去掉再查一次；括号里含 `Live`、`Remix`、`Acoustic`、`伴奏`、`版` 等版本词时保留，避免把现场版查成录音室版。返回结果仍按完整曲名或去掉装饰后的曲名校验。
- `DJ版` / `DJ Remix` / `(DJ)` / `- DJ` 这类标记会先从曲名里去掉再查，并跳过歌手约束（DJ 版通常挂别人名字）；时长容差放宽到 60 秒，避免混音版比原曲长而匹配失败。
- LRCLIB 并行候选都没命中时，会再用歌名搜一次；仍按歌手 / 版本 / Live / 时长校验，不会拿别人的同名歌。
- 第三方请求超时、429、5xx 或所有源都没结果时都不写缓存，下次打开会立即重试。
- 歌词页总时限 4.5 秒（从官方响应到达开始算），单个外部请求 4 秒；纯文本在 3.5 秒兜底。打开 Now Playing 时 feed 可能刚把 scrollsita 里的曲名 / 歌手写进缓存，歌词脚本会每 100ms 看一次元数据、最多 2 秒，命中就直接查歌词，不必等 open.spotify.com。scrollsita 补卡**不等歌词**：打开 Now Playing 时客户端先渲染列表，晚到的响应只更新模型、不重绘，所以收到 scroll 就立刻补卡，内容由随后的 color-lyrics 响应填充。
- protobuf 补齐官方字段（含歌词卡使用的 `previewLines`），并将歌词额度限制归一为可显示状态。
- 配色：未激活行黑字，当前 / 已唱行白字；命中元数据缓存时不再请求 embed，用缓存里的封面色，没有缓存时用默认中灰底。
- scrollsita 列表缺少歌词 section 时立刻补一格：读到 `spotify.lyrics.miss` 不补（有歌词请求在路上时旧标记不作数）；补在头部 section 之后；官方已有则不重复补。

歌词源：`lrclib`、`musixmatch`、`netease`、`qq`、`auto`（默认）。
- LRCLIB 把完整曲名、去掉 `feat.` / `remaster` 等后缀的曲名、繁→简折叠后的写法，以及歌名-only 的兜底搜索全部放进第一批并行请求（对应 EeveeSpotify 的 `strippedTrackTitle`），返回结果仍会重新校验歌手 / Live / 时长。
- 网易云在「歌名 / 时长已匹配、只差歌手写法」时，会把候选歌词与歌手 alias 查询并行预取；alias 确认后直接复用，不重复请求，也不放松歌手校验。
- `extended-metadata` 是批量接口，可能到几 MB；脚本只解析包含 `spotify:track:` 的子消息，图片 / Credits / Canvas 等大块直接跳过，且用字段级 canonical 检查代替整包 `serialize` 拷贝。超过 12MB 的响应仍原样放行。


## 广告域名兜底

脚本关闭服务端广告开关，域名层再拦截广告素材与曝光回传：

| 域名 | 用途 |
| --- | --- |
| `ads.spotify.com`、`adeventtracker.spotify.com`、`aet.spotify.com` | Spotify 自有广告、曝光回传与广告播放跟踪像素 |

音频广告由服务端插入音频流，域名层无法拦截。Google 广告域名（`doubleclick` /
`googlesyndication` / `adservice` / `googletagservices`）属于通用广告，已统一由
[ADBlock](../adblock/) 拦截，本模块不再重复声明；只装 Spotify 模块时建议同时启用 ADBlock。

## 播放衔接

模块不改写「交叉淡入淡出 / Gapless」相关开关，也不会给免费号强行解锁
crossfade；这两项保持服务端与 App 自己的设置。AutoMix 仍在远程配置里强制关闭
（`automix_enabled=0`），避免下一首按节拍提前混进来。修改后需要重启 App（或切换
网络）让客户端重新拉取 bootstrap / 远程配置，旧缓存里的开关才会被覆盖。

## iPhone / iPad 与 macOS

`desktop=auto` 会读取请求的 User-Agent：`iPhone` / `iPad` 走移动端规则，
`Macintosh` / `Darwin` 走桌面端规则。自动识别不对时，把 `desktop` 改成 `ios`
或 `macos` 强制指定。

桌面端差异：

- 只写 `ads`、`name`、`type`、`product`、`catalogue`、`nft-disabled` 以及
  `com.spotify.madprops.*` 这些展示 / 广告属性，默认不写 `player-license`、
  `streaming-rules`、`on-demand`、`high-bitrate` 等播放授权字段。桌面端的播放
  授权由服务端判定，强行写会让客户端以为有 Premium 播放权，几秒后拿不到音频密钥
  就跳歌。
- `unlock_playback=auto` 在桌面端默认关闭；需要尝试时手动改成 `true`。
- 桌面端歌词页走 `color-lyrics/v2/track/{id}/image/{封面}`：官方客户端把歌词和封面色
  合到一个「image」路径上，格式仍由 `?format=json` 决定。桌面端跑在 CEF 里，这条请求
  是跨域 fetch，**先发 OPTIONS 预检再发 GET**：预检响应只有 CORS 头、没有 body，
  脚本如果当成「官方没歌词」回一份歌词 JSON，`Access-Control-Allow-*` 就被顶掉，
  浏览器判 `PreflightMissingAllowOriginHeader`，歌词页直接显示「无法加载这首歌曲的
  歌词，请稍后再试」。所以歌词脚本对 `OPTIONS`（以及任何带 `Allow-Methods` /
  `Max-Age` 的响应）一律原样放行；合成响应时以原响应头为底、只换 body，保证 CORS 头
  和 `Vary: Origin` 留着。
- 桌面端合成歌词必须带 `lyrics.previewLines`（歌词卡预览列表）。客户端对它直接
  `.map()`，缺字段会抛 `TypeError`，整页歌词同样退化成「无法加载」。protobuf 补的是
  字段 17，JSON 也会补同一份数据。
- 桌面端不做请求阶段的缓存直达：凭空造跨域响应要自己补 CORS 头，稍有出入整条请求就
  废；官方请求本身很快（没歌词就是 404），统一走响应阶段合并响应头更稳。iOS 仍按原
  来的请求阶段命中缓存。
- `bootstrap` / `user-customization-service` 的外层结构可能和 iOS 不同，脚本会先走
  已知路径，再递归找 `UcsResponse`；只有确认是 UCS 才改写。

安装后需开启 MitM，并在系统 / 钥匙串中信任 Loon 证书，然后完全退出并重新打开
Spotify。桌面端如果一直看不到脚本执行记录，说明请求可能走了 QUIC；通用插件默认
拒绝 QUIC，个别版本因此跳歌时改用 macOS 兼容入口：

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-enhance-mac.plugin`

该入口固定桌面模式、默认关闭 `unlock_playback`，且不主动拒绝 QUIC。已经安装通用
插件的用户不需要再装它。

## 注意

- 只支持逐行同步歌词，未实现逐字歌词。
- 插件删除 `if-none-match` 并清除 `extended-metadata` 请求体里的 etag，避免 304 空响应导致脚本拿不到 body。
- 脚本 URL 带 `?v=日期`；客户端元数据有缓存，更新后需重启 App 或打开未缓存的歌单。
- 参数定义随插件保存；新增或删除参数后需要重新导入插件才会更新。脚本按 `?v=` 缓存，更新后需重启 App。
- 新增参数同理：`[Argument]` 清单随安装保存在本地，远程新增的开关不会自动出现。需要删除插件后重新添加（可给插件 URL 加 `?v=日期` 绕过 raw 缓存），设置页才会显示「歌词字形」「忽略简繁」。重新添加后其它参数会回到默认值，按需再调。
- `force_zh_hans` 已由 `lyrics_script` 取代：只转换补全的第三方歌词字形，不改 `Accept-Language`，也不影响官方歌词。
- `spotify.headers` 请求脚本固定伪装时区；旧安装需要重新导入插件才会带上它。脚本不改 `Accept-Language`。
- 需开启 MitM：`*-spclient.spotify.com`、`spclient.wg.spotify.com`。
- 音质、下载与 Spotify Connect 由服务端判定，脚本无法修改。
