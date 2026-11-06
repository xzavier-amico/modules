# Spotify — Loon

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-premium.plugin`

直接改写 `bootstrap` 与 `user-customization-service` 的 protobuf：把账号状态改成
premium、关掉广告位、移除免费版的试听时长上限与队列/随机限制。

不做整包重编码，而是按字段号走进消息、只替换目标字段，其余字节原样写回（未知字段、
字段顺序都不动）。旧版脚本播几秒就跳歌，主要就是重编码时丢了字段。

## 歌词

`js/spotify_meta.js` 先把曲目元数据里的 `has_lyrics` 改成 true。Spotify 的
`Track` 消息（librespot `protocol/proto/metadata.proto`）里有
`optional bool has_lyrics = 18`，客户端看到 false 就直接显示「无歌词」，
连 `color-lyrics` 都不请求，代理层拦不到任何东西。这个脚本只处理
`/metadata/4/track/` 的响应，顶层就是 `Track`，改字段 18 后其余字节原样写回。

`js/spotify_lyrics.js` 在**请求阶段**处理 `color-lyrics/v2/track/{id}`：

- 官方返回了非空歌词 → 原样放行，不动官方歌词；
- 官方 404 / 空歌词 → 用 `open.spotify.com/oembed` 取歌名与歌手，去配置的歌词源找；
- 找到逐行歌词就按客户端的格式回写，`provider` 标成对应来源；
- 只有纯文本时退到 `UNSYNCED`；
- 任何一步失败或超过 6.5 秒，都原样放行，不影响播放。

两种响应格式都支持：旧版客户端要 JSON，新版客户端要 protobuf
（`0a c2 09 08 01 12 1b …`，字段定义取自 EeveeSpotify 的 `lyrics.proto`：
`Response.data=1`、`LyricsData.timeSynchronized=1 / lines=2 / providedBy=5`、
`LyricsLine.offsetMs=1 / content=2`）。脚本按响应内容自动判断，不用手动切。

歌词源：

| 值 | 说明 |
| --- | --- |
| `lrclib` | 默认。[LRCLIB](https://lrclib.net) 社区曲库，覆盖广，中文偏弱 |
| `auto` | 依次尝试 lrclib → musixmatch → 网易云 → QQ 音乐 |
| `musixmatch` | 沿用 EeveeSpotify 的做法：固定 app_id 换匿名 token，再取逐行字幕 |
| `netease` | 网易云，中文曲库最好 |
| `qq` | QQ 音乐，中文曲库好，接口返回明文 LRC |

网易云和 QQ 音乐不需要 token；Musixmatch 的匿名 token 每次请求前现取，会多一次往返。

注意：逐字歌词（syllables）没有做，只做逐行同步。

**已知限制**：官方没有歌词的歌，Spotify 客户端根本不会请求 `color-lyrics` 接口
（它从曲目元数据里就知道没有词），代理层拦不到任何请求，所以这类歌注入不了。
实测把 `Track` 的 `has_lyrics`（字段 18）改成 true 也没能触发请求，
客户端似乎不走 `/metadata/4/track/` 这个接口。要解决只能做客户端注入，
参见 [EeveeSpotify](https://github.com/whoeevee/EeveeSpotifyReborn)。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 总开关，关闭后脚本不做任何修改 |
| `block_ads` | true | 广告属性 + 广告/推广位远程配置 |
| `unlock_playback` | true | 试听时长、队列上限、强制随机等限制 |
| `lyrics_source` | lrclib | 歌词来源，见上表 |
| `verbose_log` | false | 打印改写前后的字节数与歌词注入结果 |

注意：

- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。
