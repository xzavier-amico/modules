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
| `lyrics_source` | auto | 歌词源；`auto` 并发查询网易云 / QQ / LRCLIB / Musixmatch（官方上游，排最后兜底） |
| `desktop` | auto | `auto` 按 User-Agent 识别 iPhone / iPad 与 Loon for Mac；识别不准时手动指定 `ios` / `macos` |
| `lyrics_script` | hans | 官方与第三方歌词默认转简体（`hans`）；`source` 保持原文。官方响应按 `language` 判断，并把 `zh-Hant` 同步改成 `zh-Hans` |
| `meta_script` | source | `hans` 把界面里的曲名 / 歌手 / 专辑名转成简体；`source` 保持 Spotify 原文。含日文假名的名称保持原样，且与歌词字形互不影响 |
| `ignore_han_variants` | true | 查歌词时把繁体曲名 / 歌手按简体比较；关闭后繁简写法必须完全一致 |
| `sync_plain_lyrics` | true | 只有纯文本歌词时按歌曲时长把每行均分出时间轴（伪同步），让它能跟着滚动；关闭则保持整屏纯文本 |
| `lyrics_isrc` | true | 前面几轮都搜不到时，用 Deezer 公开接口反查 ISRC，再用 ISRC 直查 Musixmatch、并用 Deezer 的规范曲名重查一遍曲库 |
| `prefetch_lyrics` | true | 打开 Now Playing 时顺手把队列里下一首的歌词查好写进缓存，切歌后直接命中；fire-and-forget，不阻塞卡片渲染 |

## 时区

`js/spotify.headers.js` 挂在请求阶段，固定把 URL 里的 `timezone=` 改成账号地区对应的时区。账号地区由 `js/spotify.js` 从 bootstrap / UCS 的 `country` 属性抄到本地存储 `spotify.account.region`；没有记录时看请求里的 `market=XX`，仍然没有就用 `Asia/Hong_Kong`。中国大陆账号会得到 `Asia/Shanghai`，台湾 `Asia/Taipei`，香港 `Asia/Hong_Kong`。

时区只影响请求参数，不改系统时间。脚本不改 `Accept-Language`：Spotify 的歌词语言由账号 / 客户端语言配置决定，改请求头只能影响接口的本地化文案，改不了歌词文本。

## 歌词

1. `js/spotify.js` 把曲目元数据里的 `has_lyrics` 改为 `true`，客户端才会请求 `color-lyrics`；同时把同一条响应里的曲名、歌手、时长存进本地存储（`spotify.track.meta.v2`，最多 24 首）。
2. `js/spotify_lyrics.js` 处理 `color-lyrics/v{N}/track/{id}`：iOS 缓存未命中时由 Loon 请求脚本并行代发官方请求与第三方查询，同步歌词谁先到就先返回；官方歌词仍按 `lyrics_script` 转简体。桌面端保留官方响应后补全流程，避免改变 CEF 的 CORS 行为。查歌词优先读客户端元数据缓存（零额外请求），没有命中才退回公开的 oEmbed / embed 页面。
3. 合成结果写入 `spotify.lyrics.cache.v2`：同一首歌再次请求时直接命中，不再重复查源。命中缓存保留 24 小时；查不到或超时不缓存，下次会重新查询；最多 24 首（总大小仍限制在 400KB）。换了歌词源（`auto` ↔ `lrclib`）时会按曲目 id 复用旧缓存。从 oEmbed / embed 拿到的曲名、歌手与封面色也会写回 `spotify.track.meta.v2`。

合成规则：

- `auto` 同时请求网易云、QQ、LRCLIB、Musixmatch，首个通过歌名 / 歌手 / Live 校验的同步歌词胜出；Musixmatch 是 Spotify 的官方歌词上游、能用 `track_spotify_id` 直查，排在最后只做兜底。iOS 上它与官方请求并行竞速。只有纯文本时继续等同步歌词或官方结果，并保留原有超时兜底。
- 候选请求全部并行：LRCLIB 对完整曲名和去掉装饰括号后的曲名各发 `get` + `search`；网易云 / QQ 搜索后同时请求排名前 3 的候选歌词。任一同步歌词先通过校验就直接返回。
- 歌名比较会忽略 `feat.` / `ft.` / `with` / `prod.`、`Remastered 2011` / `2011 Remaster`、`Radio Edit`、`Single Version`、`Album Version`、`Bonus Track`、`Deluxe Edition`、`Explicit` / `Clean` 等版本后缀；歌手按 `feat.` / `ft.` / `with` 和多歌手分隔符拆分，任意一位匹配即可。
- 曲名 / 歌手比较默认做繁→简折叠（OpenCC t2s 表）：Spotify 的中文元数据常是繁体，网易云 / QQ 返回简体，不折叠时「說謊」对不上「说谎」、「周杰倫」对不上「周杰伦」。关闭 `ignore_han_variants` 后恢复逐字比较。
- 歌词默认转简体（`lyrics_script=hans`）：官方歌词按 `language` 判断（`zh-Hant` / `zh-TW` / `zh-HK` 直接转，并同步改成 `zh-Hans`；`lines` 与 `previewLines` 都改，protobuf 与桌面端 JSON 都覆盖），第三方歌词只在整段判定为繁体时转换；简体 / 英文 / 日文歌词原样保留。词表随脚本下发（约 30KB），首次用到时才构建，非繁体文本零逐字开销。
- 界面曲名 / 歌手 / 专辑名默认保持原文（`meta_script=source`）。改成 `hans` 后，Now Playing、歌词卡、首页 / 搜索 / 滚动页以及 `/metadata/4/track`、`extended-metadata` 里的这三种名称会按同一份 OpenCC 表转成简体；含日文假名的名称（如「宇多田ヒカル」）保持原样。歌单 / 专辑 / 歌手 / 搜索 / 资料库也会一并转换：Pathfinder（`api-partner.spotify.com/pathfinder`，JSON）改 `name` / `title` 字段；spclient 的 `playlist/v2`、`collection/v2`、`searchview`、`album/v2`、`artist/v2`、`metadata/4/album|artist` 等 protobuf 接口则改写其中可严格按 UTF-8 解码的文本字段（URI / ID / 图片 / 二进制不动）。Pathfinder 请求会把 `Accept-Encoding` 改成 `identity`，避免 zstd 未解压导致读不到 JSON。歌词缓存仍记录 Spotify 原文，避免转简体后和繁体曲库对不上；关闭补全歌词时单独开 `hans` 也不会顺手打开 `has_lyrics`。
- 曲名里带 `()` / `（）` 的装饰信息（影视剧名、节目名、歌手名等）会先去掉再查一次；括号里含 `Live`、`Remix`、`Acoustic`、`伴奏`、`版` 等版本词时保留，避免把现场版查成录音室版。返回结果仍按完整曲名或去掉装饰后的曲名校验。
- `DJ版` / `DJ Remix` / `(DJ)` / `- DJ` 这类标记会先从曲名里去掉再查，并跳过歌手约束（DJ 版通常挂别人名字）；时长容差放宽到 60 秒，避免混音版比原曲长而匹配失败。
- LRCLIB 并行候选都没命中时，会再用歌名搜一次；仍按歌手 / 版本 / Live / 时长校验，不会拿别人的同名歌。
- 严格校验（歌名 + 歌手 + Live + 时长）一条都没命中时，会再跑一轮放宽匹配：曲名必须完全相等（不是前缀 / 包含），歌手可以不写一致，两边都有时长时按 12 秒容差。曲库里「歌手写法不同 / 挂的制作人不同 / 合唱拆成单人」这类其实有歌词的曲子靠这一轮救回来。
- 只有纯文本歌词时（`sync_plain_lyrics`），按歌曲时长把每行均分出时间轴再返回：从第 1.2 秒排到最后 4 秒，`syncType` 仍是 `LINE_SYNCED`，所以歌词页能跟着滚。这是编出来的时间轴，只用来兜底 —— 有真正的同步歌词时一律以真歌词为准（伪同步不会让这一轮提前收工）。时长未知或不足 20 秒时不编，保持 `UNSYNCED`。
- 前面几轮都落空时（`lyrics_isrc`），用 Deezer 公开 API（无需 token）按曲名 + 歌手反查这首歌，拿到规范曲名 / 歌手 / 时长 / ISRC 后同时打两枪：① Musixmatch 用 `track_isrc` 直查字幕，完全不依赖名字匹配；② 用 Deezer 的规范写法把 LRCLIB / 网易云 / QQ 再查一遍。这一轮通常已经过了客户端 4.5 秒窗口，结果是写进缓存（下次打开歌词页 / 卡片直接命中）。
- 第三方请求超时、429、5xx 或所有源都没结果时都不写缓存，下次打开会立即重试。
- 歌词查询总时限 4.5 秒；iOS 竞速从请求阶段开始计时，桌面端从官方响应到达后开始计时。单个外部请求默认 4 秒；纯文本保留 3.5 秒兜底窗口。打开 Now Playing 时 feed 可能刚把 scrollsita 里的曲名 / 歌手写进缓存，歌词脚本会每 100ms 看一次元数据、最多 2 秒，命中就直接查歌词，不必等 open.spotify.com。scrollsita 补卡**不等歌词**：打开 Now Playing 时客户端先渲染列表，晚到的响应只更新模型、不重绘，所以收到 scroll 就立刻补卡，内容由随后的 color-lyrics 响应填充。
- protobuf 补齐官方字段（含歌词卡使用的 `previewLines`），并将歌词额度限制归一为可显示状态。
- 配色：未激活行黑字，当前 / 已唱行白字；命中元数据缓存时不再请求 embed，用缓存里的封面色，没有缓存时用默认中灰底。
- scrollsita 列表缺少歌词 section 时立刻补一格，补在最前面；官方已有则不重复补；列表形状认不出来（没有 section id / 曲目引用，body 里也没有当前曲目的 URI）时原样放行，不往里插，避免把整包结构写坏后出现「整页空白」。
- `spotify.lyrics.miss`（5 分钟内不补空卡）只在**确实有源回过答**（200 / 404）且都说没歌词时才写：全部请求失败属于临时故障（后台被挂起、代理断开、上游 5xx），不写 miss，否则回到前台的这段时间歌词卡会一直被挡掉。有歌词请求在路上（`spotify.lyrics.pending`）时旧 miss 不作数。
- 换 body 时会按新长度重算 `Content-Length`、去掉 `Content-Encoding`、保留 / 补齐 CORS 头：沿用旧长度或旧的 gzip 声明，客户端会截断或解压失败，表现是 Now Playing 正常、卡片列表整块空白。

歌词源：`lrclib`、`musixmatch`、`netease`、`qq`、`auto`（默认）。
- LRCLIB 把完整曲名、去掉 `feat.` / `remaster` 等后缀的曲名、繁→简折叠后的写法，以及歌名-only 的兜底搜索全部放进第一批并行请求（对应 EeveeSpotify 的 `strippedTrackTitle`），返回结果仍会重新校验歌手 / Live / 时长。
- 网易云在「歌名 / 时长已匹配、只差歌手写法」时，会把候选歌词与歌手 alias 查询并行预取；alias 确认后直接复用，不重复请求，也不放松歌手校验。
- `extended-metadata` 是批量接口，可能到几 MB；脚本只解析包含 `spotify:track:` 的子消息，图片 / Credits / Canvas 等大块直接跳过，且用字段级 canonical 检查代替整包 `serialize` 拷贝。超过 12MB 的响应仍原样放行。


## 预取下一首

切歌时歌词页才第一次查第三方源，快慢就取决于网络。预取把这段等待提前：

1. `js/spotify.js` 处理 **connect-state** 响应时，按 PlayerState 的字段号读出播放队列（`track` = 7、`prev_tracks` = 19、`next_tracks` = 20），写进本地存储 `spotify.queue`（当前曲目 + 接下来最多 8 首）。connect-state 是热路径（每次状态变化、前台轮询都会打），所以这里**只做去重写入、不发任何请求**，队列没变就不写。
2. `js/spotify.feed.js` 在滚动页（Now Playing）补歌词卡时，读 `spotify.queue` 拿到下一首的 id，交给 `js/spotify_lyrics.js` 的预取入口去查歌词并写进 `spotify.lyrics.cache.v2`。**fire-and-forget**：不等待、不阻塞 scroll 响应（多等一秒列表就可能不被客户端采用）。
3. 换到下一首时，客户端请求 `color-lyrics`，请求阶段直接命中缓存，卡片和歌词页都不再等第三方源。

约束：

- 队列里的 `current` 必须与当前滚动页的曲目一致才会预取，避免用上一首的队列乱查。
- 下一首必须在 `spotify.track.meta.v2` 里有曲名 / 歌手才会预取：没有元数据就要先回源 `open.spotify.com`，那一步比歌词本身还慢，没意义。
- 同一首 30 分钟内只试一次（`spotify.prefetch.v1`），已经缓存过的直接跳过，所以滚动页反复刷新几乎零开销。
- 关闭 `prefetch_lyrics` 后只跳过第 2 步，队列照常记录（不产生请求）。

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
  2026-11-15 在 Spotify 1.3.9.2055（macOS 14.8.9）上复测过一次：把开关打开、重启
  Loon 与 App 后，客户端的属性缓存（`~/Library/Application Support/Spotify/
  PersistentCache/offline.bnk`）里确实出现了模块写入的桌面播放授权字段
  （`player-license` / `player-license-v2` = premium、`streaming-rules` 空、
  `on-demand`），随后连续播放 30s + 50s 没有跳歌、没有中断——单看这一轮，「几秒后
  跳歌」没有复现。但只有两段短样本，且免费号的属性块里 `type` / `catalogue` 仍是
  free，无法确认客户端真正吃到的就是 premium 播放授权，所以桌面端默认仍然关闭，
  保持现状。
- 同一轮还发现：1.3.9 的桌面端 `remote-config-resolver/v3/configuration` 返回
  **JSON**（`{"configuration":{"assignedValues":[…]}}`，属性在 `desktop-ui` scope），
  `nebula/v1/configuration/attributes` 也换成了 JSON
  （`{"attributes":{"type":{"stringValue":"free"},…}}`）。脚本现在按首字节嗅探分流：
  以 `{` 开头的走 JSON 改写，其余仍走原来的 protobuf 路径，iOS 不受影响。
  - 账号属性：按同一份 `forced` / `STRIPPED` 表处理，`type` / `catalogue` /
    `name` / `ads` 等照写，`on-demand-trial` 之类的试用键照删；值类型跟着原属性走
    （`boolValue` / `stringValue` / `longValue`），`country_code` 也会被记进
    `spotify.account.region` 供时区伪装使用（桌面端只有这个键，没有 protobuf 那套
    `country`）。
  - 远程配置：规则语义与 protobuf 一一对应（0 删除、1 改已存在的 bool、2 强制
    bool、其它改字符串枚举），缺的强制项只补「响应里本来就有的 scope」，不会把
    iOS 那批 scope 塞进桌面端响应。桌面端新增了一小批 `desktop-ui` 的广告 /
    赞助 / 升级位开关（`enableSponsorshipLabelsOn*`、`enableSponsoredPlaylist*`、
    `enable_ad_feedback_*`、`enableLyricsUpsell` 等），只关名字里明确是广告 /
    赞助 / 升级的项。
  - 结构对不上的 JSON 一律原样放行，避免把别的接口写坏。

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
- 桌面客户端**不显示方案与有效期**：`xpui` 里没有引用 `product-expiry` /
  `subscription-enddate` / `financial-product`，设置 → 账户 只有登录方式与「管理账户」
  链接。有效期只在网页账号页（`spotify.com/account` → `your-plan` / `plan-details`），
  那里是 Spotify 服务端渲染的真实账号数据，代理改不到，所以永远显示免费版的信息。
  这几个字段照写，是为了让原生层的权益判定与展示串一致，别指望在 App 里看到。
  客户端 UI 里唯一直接读改写结果的是 `productState.ads`（广告闸门），所以肉眼能看到的
  变化基本是「广告位 / upsell 消失」，不是「多了个 Premium 标识」。
- 判断改写是否生效，最可靠的是抓一条 `nebula/v1/configuration/attributes`：
  `type` 应为 `premium`、`on-demand-trial` / `smart-shuffle` 应被删除、
  `financial-product` 应为 `pr:premium,tc:0`。客户端内则看广告位与 upsell 是否消失。
- 桌面端不做请求阶段的缓存直达：凭空造跨域响应要自己补 CORS 头，稍有出入整条请求就
  废；官方请求本身很快（没歌词就是 404），统一走响应阶段合并响应头更稳。iOS 仍按原
  来的请求阶段命中缓存。
- `bootstrap` / `user-customization-service` 的外层结构可能和 iOS 不同，脚本会先走
  已知路径，再递归找 `UcsResponse`；只有确认是 UCS 才改写。

安装后需开启 MitM，并在系统 / 钥匙串中信任 Loon 证书，然后完全退出并重新打开
Spotify。桌面端如果一直看不到脚本执行记录，说明请求可能走了 QUIC；通用插件会按
User-Agent 识别 Loon for Mac，并默认拒绝 QUIC 以确保请求经过 MITM。

## 注意

- 只支持逐行同步歌词，未实现逐字歌词。
- 歌词卡只在客户端「第一次」为这首歌拉 scrollsita 的那条响应里补：拿到的列表不会再插入新卡，所以换歌后的第一次进 Now Playing 是关键时机。补卡不等歌词，内容由随后的 `color-lyrics` 响应填充。
- Now Playing 正常但卡片列表（scrollsita）整块空白时，先把 `enable_lyrics` 关掉只留去广告再复现一次：仍空白说明与补卡无关（去广告只删广告 section，不删正常卡片）；恢复空白前的样子说明问题在补卡 / 歌词链路。脚本换 body 时会按新长度重算 `Content-Length`、去掉 `Content-Encoding`、保留 CORS 头——以前这几项沿用旧值，客户端会截断或解压失败，表现正好是「整页卡片空白」。
- 插件删除 `if-none-match` 并清除 `extended-metadata` 请求体里的 etag，避免 304 空响应导致脚本拿不到 body。
- 脚本 URL 带 `?v=日期`；客户端元数据有缓存，更新后需重启 App 或打开未缓存的歌单。

  > 改完脚本客户端毫无变化时，先确认不是缓存：Loon 按 **URL** 缓存脚本
  > （`/Library/Application Support/com.loon.Loon/scripts/<md5(url)>.js`），插件内容
  > 没变就不会重新下载，而 raw 的 CDN 在推送后还会继续给一阵旧内容。排查顺序：
  > ① `curl` 带 `?v=` 的地址确认 raw 已是新内容；② 删掉
  > `remotePlugin/<hash>.lpx` 让 Loon 重新下载插件（或直接在 Loon 里更新插件），
  > 它会连带把脚本重新拉一遍；③ 重启 Loon 与 App。
  >
  > 注意：只清 `scripts/` 里的脚本缓存、插件却不重新下载时，带 `requires_body`
  > 的那几条脚本（`spotify.config` / `spotify.meta` / bootstrap）会静默不执行——
  > 表现是「账号属性没改写，但歌词还正常」，很容易误判成代码问题。
- 参数定义随插件保存；新增或删除参数后需要重新导入插件才会更新。脚本按 `?v=` 缓存，更新后需重启 App。
- 新增参数同理：`[Argument]` 清单随安装保存在本地，远程新增的开关不会自动出现。需要删除插件后重新添加（可给插件 URL 加 `?v=日期` 绕过 raw 缓存），设置页才会显示「歌词字形」「界面字形」「忽略简繁」。重新添加后其它参数会回到默认值，按需再调。
- `force_zh_hans` 已由 `lyrics_script` 取代：官方与第三方歌词都按这个开关转字形，不改 `Accept-Language`。
- `spotify.headers` 请求脚本固定伪装时区；旧安装需要重新导入插件才会带上它。脚本不改 `Accept-Language`。
- 需开启 MitM：`*-spclient.spotify.com`、`spclient.wg.spotify.com`、`api-partner.spotify.com`（界面名称字形）。
- 音质、下载与 Spotify Connect 由服务端判定，脚本无法修改。
