# Spotify — Egern 模块

- Egern：`egern/spotify/spotify-premium.yaml` + `js/spotify.js` + `js/spotify.feed.js` + `js/spotify_lyrics.js`
- Loon：`loon/spotify/spotify-premium.plugin`

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
| `unlock_playback` | true | 移除试听时长、队列上限、强制随机等限制 |
| `enable_lyrics` | true | 补全歌词；关闭后不补元数据、歌词与歌词卡 |
| `lyrics_source` | auto | 歌词源；`auto` 并发查询网易云 / QQ / LRCLIB，不自动查 Musixmatch |
| `prefetch` | true | 换歌时预取当前曲目，下一次状态轮询再预取下一首；快速连续切歌会跳过。关闭后只在打开歌词页时查询 |
| `desktop` | auto | 设备类型；`auto` 按 UA 识别 iPhone / iPad 与 Mac，识别不准时手动指定 |

## 歌词

1. `js/spotify.js` 把曲目元数据里的 `has_lyrics` 改为 `true`，客户端才会请求 `color-lyrics`；同时把同一条响应里的曲名、歌手、时长存进本地存储（`spotify.track.meta`，最多 24 首）。
2. `js/spotify_lyrics.js` 处理 `color-lyrics/v{N}/track/{id}`：官方有歌词时原样放行；404 / 空歌词时先读上面那份元数据（零外部请求），没有命中才退回公开的 oEmbed / embed 页面，再用第三方歌词合成同结构响应。
3. 合成结果写入 `spotify.lyrics.cache`：同一首歌再次请求时直接命中，不再重复查源。命中缓存保留 24 小时；查不到或超时不缓存，下次会重新查询；最多 24 首（总大小仍限制在 400KB）。换了歌词源（`auto` ↔ `lrclib`）时会按曲目 id 复用旧缓存。从 oEmbed / embed 拿到的曲名、歌手与封面色也会写回 `spotify.track.meta`，下次连公开页面都不用请求。

合成规则：

- `auto` 同时请求网易云、QQ、LRCLIB，首个通过歌名 / 歌手 / Live 校验的同步歌词胜出；只有纯文本时等全部结束，或在 5 秒后先发纯文本，避免一直等到总超时。
- 候选请求全部并行：LRCLIB 对完整曲名和去掉装饰括号后的曲名各发 `get` + `search`；网易云 / QQ 搜索后同时请求排名前 3 的候选歌词。任一同步歌词先通过校验就直接返回，不再按候选顺序一个个等。
- 歌名比较会忽略 `feat.` / `ft.` / `with` / `prod.`、`Remastered 2011` / `2011 Remaster`、`Radio Edit`、`Single Version`、`Album Version`、`Bonus Track`、`Deluxe Edition`、`Explicit` / `Clean` 等版本后缀；歌手按 `feat.` / `ft.` / `with` 和多歌手分隔符拆分，任意一位匹配即可。
- 曲名里带 `()` / `（）` 的装饰信息（影视剧名、节目名、歌手名等）会先去掉再查一次；括号里含 `Live`、`Remix`、`Acoustic`、`伴奏`、`版` 等版本词时保留，避免把现场版查成录音室版。返回结果仍按完整曲名或去掉装饰后的曲名校验。
- LRCLIB 并行候选都没命中时，会再用歌名搜一次；仍按歌手 / 版本 / Live / 时长校验，不会拿别人的同名歌。
- 第三方请求超时、429、5xx 或所有源都没结果时都不写缓存，下次打开会立即重试。
- 歌词页总时限 5 秒，单个外部请求 4 秒；scrollsita 补卡只等 4 秒，超时就不补卡。
- protobuf 补齐官方字段（含歌词卡使用的 `previewLines`），并将歌词额度限制归一为可显示状态。
- 配色：未激活行黑字，当前 / 已唱行白字；命中元数据缓存时不再请求 embed，用缓存里的封面色，没有缓存时用默认中灰底。
- scrollsita 列表缺少歌词 section 时先查歌词并写入 `spotify.lyrics.cache`，只有查到才补一格；官方已有则不重复补，查不到也不补空卡。
- 预取歌词（`prefetch`，默认开）：`connect-state` 换歌后的第一次响应先查当前曲目，下一次轮询再按 `PlayerState.next_tracks` 查下一首（`spotify.queue` 按字段号 7 / 19 / 20 区分 current / prev / next，不会把上一首当成下一首）。当前曲目最多等 1.5 秒、下一首最多等 1 秒；1.5 秒内连续切歌会跳过预取，避免拖慢播放状态。歌词页和滚动页补卡通常直接命中缓存。
- Loon / Egern 的脚本在 `$done` 之后会释放执行资源，不能真正后台跑网络请求；所以下一首的预取放在下一次 `connect-state` 轮询里，并限制等待时间，而不是在补卡响应里硬等。

歌词源：`lrclib`、`musixmatch`、`netease`、`qq`、`auto`（默认）。
- LRCLIB 先按完整曲名查，再用去掉 `feat.` / `remaster` 等后缀的曲名重试（对应 EeveeSpotify 的 `strippedTrackTitle`），返回结果仍会重新校验歌手 / Live / 时长。
- `extended-metadata` 是批量接口，可能到几 MB；脚本只解析包含 `spotify:track:` 的子消息，图片 / Credits / Canvas 等大块直接跳过，且用字段级 canonical 检查代替整包 `serialize` 拷贝。超过 12MB 的响应仍原样放行。


## 播放衔接

模块保留「交叉淡入淡出」开关，并让客户端读取 App 里的播放设置
（`use_playback_settings_crossfade=1`）；AutoMix 在远程配置里强制关闭
（`automix_enabled=0`）。这样「设置 → 播放 → 交叉淡入淡出」不会消失，滑杆关到 0
就不会再出现下一首提前混进来。修改后需要重启 App（或切换网络）让客户端重新拉取
bootstrap / 远程配置，旧缓存里的开关才会被覆盖。

### 没有歌词时的排查

模块不提供歌词排障开关，也不会因为缺少额外环境变量而跳过歌词。可以先确认这几点：

- `color-lyrics` 请求是否被 MITM：检查证书与 `*-spclient.spotify.com`。
- 客户端是否请求了歌词：`has_lyrics` 没被改写时客户端不会请求，重启 App 或打开未缓存的歌单让元数据重新拉取。
- 官方对「没有歌词」有时回 200 + 空体（protobuf 请求尤其常见），脚本会按没有歌词处理并去第三方补；只有响应头 `content-length > 0`（说明上游有 body，只是没交到脚本手里）时才原样放行。
- `open.spotify.com` 返回 400 通常是出口节点被风控；曲名 / 歌手一般来自客户端自己的元数据缓存，只有刚装模块、缓存还没写进去时才会退回 oEmbed / embed，换节点再试通常就好。

## 广告域名兜底

脚本关闭服务端广告开关，域名层再拦截广告素材与曝光回传：

| 域名 | 用途 |
| --- | --- |
| `ads.spotify.com`、`adeventtracker.spotify.com`、`aet.spotify.com` | Spotify 自有广告、曝光回传与广告播放跟踪像素 |

音频广告由服务端插入音频流，域名层无法拦截。Google 广告域名（`doubleclick` /
`googlesyndication` / `adservice` / `googletagservices`）属于通用广告，已统一由
[ADBlock](../adblock/) 拦截，本模块不再重复声明；只装 Spotify 模块时建议同时启用 ADBlock。

## 注意

- `spotify.lyrics` 必须带 `body_required: true`。Egern 不开这个开关时既不把 body 交给脚本，也不接受脚本返回的 body，表现为「日志里查到了歌词但界面不显示」。没有 body 的 404 / 200 空响应仍会进脚本。
- 只支持逐行同步歌词，未实现逐字歌词。
- 模块删除 `if-none-match` 并清除 `extended-metadata` 请求体里的 etag，避免 304 空响应导致脚本拿不到 body。
- 桌面端广告接口 `/ads/v1|v2/` 由 `url_rewrites` 直接 reject（404）；Loon 插件里对应的是 `reject(404)`。
- Egern 不支持按参数加载脚本；关闭补全歌词后脚本仍会加载，但会立即返回。
- 脚本 URL 带 `?v=日期`；客户端元数据有缓存，更新后需重启 App 或打开未缓存的歌单。
- 已删除的参数（例如 `lyrics_debug`）在旧安装里可能仍显示；需要在客户端删除模块后重新导入，并完全退出 App 再打开。脚本按 URL 缓存，只改 `?v=` 而不重新导入时，旧脚本可能继续运行。
- 需开启 MitM：`*-spclient.spotify.com`、`spclient.wg.spotify.com`。
- 音质、下载与 Spotify Connect 由服务端判定，脚本无法修改。
