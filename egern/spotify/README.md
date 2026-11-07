# Spotify — Egern 模块

- Egern：`egern/spotify/spotify-premium.yaml` + `js/spotify_premium.js`
- Loon：`loon/spotify/spotify-premium.plugin`

直接改写 `bootstrap` 与 `user-customization-service` 的 protobuf：把账号状态改成
premium、关掉广告位、移除免费版的试听时长上限与队列/随机限制。

不做整包重编码，而是按字段号走进消息、只替换目标字段，其余字节原样写回（未知字段、
字段顺序都不动）。旧版脚本播几秒就跳歌，主要就是重编码时丢了字段。

## 广告域名兜底

脚本改的是服务端下发的广告开关，域名层再拦一层真正投放广告的域名：

| 域名 | 用途 |
| --- | --- |
| `ads.spotify.com`、`adeventtracker.spotify.com` | Spotify 自有广告与曝光回传 |
| `pubads.g.doubleclick.net`、`securepubads.g.doubleclick.net`、`googleads.g.doubleclick.net` | Google 广告投放 |
| `pagead2.googlesyndication.com`、`tpc.googlesyndication.com` | Google 广告素材与点击 |
| `adservice.google.com`、`www.googletagservices.com` | Google 广告服务 |

免费号的音频广告是服务端缝进音频流里的，拦域名没有用；这一层能挡的是展示位、
播客里的外链广告和广告曝光回传。`doubleclick` / `googlesyndication` 是全局域名，
其它 App 用到时也会一起被拦。纯规则，不需要 MITM。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 总开关，关闭后脚本不做任何修改 |
| `block_ads` | true | 广告属性 + 广告/推广位远程配置 |
| `unlock_playback` | true | 试听时长、队列上限、强制随机等限制 |
| `lyrics_source` | lrclib | 官方没歌词时用的歌词源 |

## 歌词

两段脚本配合：

1. `js/spotify_meta.js` 把曲目元数据里的 `has_lyrics` 改成 `"true"`。客户端读的是
   `SPTPlayerTrack.metadata()["has_lyrics"]`，值为 false 时直接显示「暂无歌词」，
   连 `color-lyrics` 都不请求，代理层拦不到任何东西。主路径是
   `extended-metadata` 的 `TRACK_V4`（`Track.has_lyrics`，字段 18）；
   `context-resolve` / `connect-state` 的 `ContextTrack.metadata` 作为兜底，
   两处都改。之前只改 `/metadata/4/track/` 没效果，是因为 iOS 客户端不走那个接口。
2. `js/spotify_lyrics.js` 处理 `color-lyrics/v2/track/{id}`：官方有歌词就原样
   放行；官方没有（404 / 空歌词）就取 `open.spotify.com/oembed` 的曲名歌手，
   去配置的歌词源找，合成 Spotify 的 protobuf 歌词返回。

另外 `js/spotify_premium.js` 改 `ios-feature-lyrics` 下的三个 UCS 开关：

- `enable_lyrics`、`is_get_lyrics_v2_enabled` → true
- `is_lyrics_card_element_enabled` → **false**

最后这个开关名字容易看反：它管的是 Now Playing 里那张「单行歌词」预览卡片。打开后
客户端用卡片替代整页歌词，表现就是「能显示一行，但没有专门的歌词页」。真实账号的
抓包里它是 false，歌词页照常显示。

歌词源：`lrclib`（默认，曲库全但中文偏弱）、`musixmatch`、`netease`、`qq`、
`auto`（依次尝试 lrclib → musixmatch → 网易云 → QQ）。

注意：

- 逐字歌词（syllables）没有做，只做逐行同步。
- `user-customization-service` / `color-lyrics` 的 etag 在 HTTP 头里，插件在
  `[Rewrite]` / `header_rewrites` 里删掉了 `if-none-match`：不删的话服务端会回
  304、响应体为空，脚本只能放行，客户端继续用缓存里的旧值（开关是关的、歌词是
  404），表现就是「改了配置没生效」。
- `extended-metadata` 的 etag **在请求体里**（`ExtensionQuery.etag`，字段 2），
  HTTP 头删了也没用。客户端带上本地缓存的 etag，服务端只回「没变」的空数组，
  客户端继续用本地那份 `has_lyrics = false` 的实体 —— 响应改得再对也到不了客户端。
  所以 `spotify_meta.js` 还挂了一个 **请求阶段**，把这些 etag 抹掉，强制服务端回
  完整数据。这条是「歌词页出不来」的真正原因：Now Playing 里那行歌词是界面自己
  拉的，而「查看完整歌词」的入口看的是元数据里的 `has_lyrics`。
- 脚本 URL 都带 `?v=日期`，否则 Loon / Egern 会一直用缓存里的旧脚本，改了等于没改。
- 元数据在客户端有缓存；改完要重启 App，或换一个没打开过的歌单才会重新拉取。
- 如果某首歌客户端仍然不请求 `color-lyrics`，说明它的 `has_lyrics` 不是从这两个
  接口来的（客户端本地生成），代理层就无能为力了，只能靠 EeveeSpotify 那种
  进程内注入。
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。
- 图标：Spotify.png
