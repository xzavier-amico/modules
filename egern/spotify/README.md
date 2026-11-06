# Spotify — Egern 模块

- Egern：`egern/spotify/spotify-premium.yaml` + `js/spotify_premium.js`
- Loon：`loon/spotify/spotify-premium.plugin`

直接改写 `bootstrap` 与 `user-customization-service` 的 protobuf：把账号状态改成
premium、关掉广告位、移除免费版的试听时长上限与队列/随机限制。

不做整包重编码，而是按字段号走进消息、只替换目标字段，其余字节原样写回（未知字段、
字段顺序都不动）。旧版脚本播几秒就跳歌，主要就是重编码时丢了字段。

## 歌词

`js/spotify_lyrics.js` 处理 `color-lyrics/v2/track/{id}`：

- 官方返回了非空 `lyrics.lines` → 原样放行，不动官方歌词；
- 官方 404 / 空歌词 → 用 `open.spotify.com/oembed` 取歌名与歌手，查
  [LRCLIB](https://lrclib.net) 的 `syncedLyrics`，转换成 Spotify 的
  `LINE_SYNCED` JSON 返回（`provider` 标为 LRCLIB）；
- LRCLIB 没有逐行歌词时退到 `plainLyrics`（`UNSYNCED`）；
- 任何一步失败或超过 4.5 秒，都原样放行，不影响播放。

注意：LRCLIB 是社区曲库，华语/小众曲目可能查不到；逐字歌词（syllables）没有做，
只做逐行同步。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 总开关，关闭后脚本不做任何修改 |
| `block_ads` | true | 广告属性 + 广告/推广位远程配置 |
| `unlock_playback` | true | 试听时长、队列上限、强制随机等限制 |
| `verbose_log` | false | 打印改写前后的字节数与歌词注入结果 |

注意：

- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。
- 图标：Spotify.png
