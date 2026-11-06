# Spotify — Egern 模块

- Egern：`egern/spotify/spotify-premium.yaml` + `js/spotify_premium.js`
- Loon：`loon/spotify/spotify-premium.plugin`

直接改写 `bootstrap` 与 `user-customization-service` 的 protobuf：把账号状态改成
premium、关掉广告位、移除免费版的试听时长上限与队列/随机限制。

不做整包重编码，而是按字段号走进消息、只替换目标字段，其余字节原样写回（未知字段、
字段顺序都不动）。旧版脚本播几秒就跳歌，主要就是重编码时丢了字段。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 总开关，关闭后脚本不做任何修改 |
| `block_ads` | true | 广告属性 + 广告/推广位远程配置 |
| `unlock_playback` | true | 试听时长、队列上限、强制随机等限制 |

注意：

- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。
- 图标：Spotify.png
