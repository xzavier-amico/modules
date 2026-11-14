# Spotify — Loon

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-premium.plugin`

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

## 歌词

1. `js/spotify.js` 把曲目元数据里的 `has_lyrics` 改为 `true`，客户端才会请求 `color-lyrics`；同时把同一条响应里的曲名、歌手、时长存进本地存储（`spotify.track.meta`，最多 24 首）。
2. `js/spotify_lyrics.js` 处理 `color-lyrics/v{N}/track/{id}`：官方有歌词时原样放行；404 / 空歌词时先读上面那份元数据（零外部请求），没有命中才退回公开的 oEmbed / embed 页面，再用第三方歌词合成同结构响应。
3. 合成结果写入 `spotify.lyrics.cache`：同一首歌再次请求时直接命中，不再重复查源。命中缓存保留 24 小时，查不到的结果只保留 10 分钟；最多 8 首。从 oEmbed / embed 拿到的曲名、歌手与封面色也会写回 `spotify.track.meta`。

合成规则：

- `auto` 同时请求网易云、QQ、LRCLIB，首个通过歌名 / 歌手 / Live 校验的同步歌词胜出；只有纯文本时等全部结束，或在 5 秒后先发纯文本，避免一直等到总超时。
- 歌名比较会忽略 `feat.` / `ft.` / `with` / `prod.`、`Remastered 2011` / `2011 Remaster`、`Radio Edit`、`Single Version`、`Album Version`、`Bonus Track`、`Deluxe Edition`、`Explicit` / `Clean` 等版本后缀；歌手按 `feat.` / `ft.` / `with` 和多歌手分隔符拆分，任意一位匹配即可。
- LRCLIB 按歌手搜不到时会再用歌名搜一次，仍按歌手 / 版本 / Live / 时长校验，不会拿别人的同名歌。
- 第三方请求超时、429 或 5xx 不写「无歌词」短缓存，下次打开会立即重试；只有所有源都明确没结果才记 10 分钟。
- 总时限 15 秒，单个外部请求 8 秒。
- protobuf 补齐官方字段（含歌词卡使用的 `previewLines`），并将歌词额度限制归一为可显示状态。
- 配色：未激活行黑字，当前 / 已唱行白字；命中元数据缓存时不再请求 embed，用缓存里的封面色，没有缓存时用默认中灰底。
- scrollsita 列表缺少歌词 section 时补一格；官方已有则不重复补。

歌词源：`lrclib`、`musixmatch`、`netease`、`qq`、`auto`（默认）。
- LRCLIB 先按完整曲名查，再用去掉 `feat.` / `remaster` 等后缀的曲名重试（对应 EeveeSpotify 的 `strippedTrackTitle`），返回结果仍会重新校验歌手 / Live / 时长。
- `extended-metadata` 是批量接口，可能到几 MB；脚本只解析包含 `spotify:track:` 的子消息，图片 / Credits / Canvas 等大块直接跳过，且用字段级 canonical 检查代替整包 `serialize` 拷贝。超过 12MB 的响应仍原样放行。


## 广告域名兜底

脚本关闭服务端广告开关，域名层再拦截广告素材与曝光回传：

| 域名 | 用途 |
| --- | --- |
| `ads.spotify.com`、`adeventtracker.spotify.com`、`aet.spotify.com` | Spotify 自有广告、曝光回传与广告播放跟踪像素 |

音频广告由服务端插入音频流，域名层无法拦截。Google 广告域名（`doubleclick` /
`googlesyndication` / `adservice` / `googletagservices`）属于通用广告，已统一由
[ADBlock](../adblock/) 拦截，本模块不再重复声明；只装 Spotify 模块时建议同时启用 ADBlock。

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
- 桌面端歌词页走 `color-lyrics/v2/track/{id}`。没有 body 时按 `Content-Type` /
  `Accept` 判断客户端要 JSON 还是 protobuf，桌面端默认 JSON。
- `bootstrap` / `user-customization-service` 的外层结构可能和 iOS 不同，脚本会先走
  已知路径，再递归找 `UcsResponse`；只有确认是 UCS 才改写。

安装后需开启 MitM，并在系统 / 钥匙串中信任 Loon 证书，然后完全退出并重新打开
Spotify。桌面端如果一直看不到脚本执行记录，说明请求可能走了 QUIC；通用插件默认
拒绝 QUIC，个别版本因此跳歌时改用旧的兼容入口：

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-premium-mac.plugin`

该入口固定桌面模式、默认关闭 `unlock_playback`，且不主动拒绝 QUIC。已经安装通用
插件的用户不需要再装它。

## 注意

- 只支持逐行同步歌词，未实现逐字歌词。
- 插件删除 `if-none-match` 并清除 `extended-metadata` 请求体里的 etag，避免 304 空响应导致脚本拿不到 body。
- 脚本 URL 带 `?v=日期`；客户端元数据有缓存，更新后需重启 App 或打开未缓存的歌单。
- 需开启 MitM：`*-spclient.spotify.com`、`spclient.wg.spotify.com`。
- 音质、下载与 Spotify Connect 由服务端判定，脚本无法修改。
