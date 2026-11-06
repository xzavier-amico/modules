# Spotify — Egern 模块

## Spotify Premium（推荐）
- Egern：`egern/spotify/spotify-premium.yaml` + `js/spotify_premium.js`
- Loon：`loon/spotify/spotify-premium.plugin`

直接改写 `bootstrap` 与 `user-customization-service` 的 protobuf：把账号状态改成
premium、关掉广告位、移除免费版的试听时长上限与队列/随机限制。

和下面 001ProMax 的脚本版不同，这里不做整包重编码：按字段号走进消息、只替换目标
字段，其余字节原样写回，未知字段、字段顺序、非规范 varint 都保留。旧脚本会让歌曲
播几秒就被跳过，主要就是重编码时丢了字段。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 总开关，关闭后脚本不做任何修改 |
| `block_ads` | true | 广告属性 + 广告/推广位远程配置 |
| `unlock_playback` | true | 试听时长、队列上限、强制随机等限制 |
| `verbose_log` | false | 打印改写前后的字节数 |

注意：

- **不要**与 `spotify.yaml` 同时启用，两者会改写同一个响应。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。

## 001ProMax/Surge 版（脚本版）
- Egern：`egern/spotify/spotify.yaml` + `js/spotify_crack.js`
- Loon：`loon/spotify/spotify.plugin`

## 001ProMax/Surge 纯 Rewrite 版（无脚本，通过 mock 服务器）
- Egern：`egern/spotify/spotify-rewrite.yaml`
- Loon：`loon/spotify/spotify-rewrite.plugin`

## 说明
- 脚本版：protobuf 解析去广告，timeout=60，max-size=-1（legacy）
- 纯 Rewrite 版：通过 mock 服务器返回修改后响应，无脚本超时问题，但依赖外部 mock 服务器（`https://mock.trigram-masques-8r.workers.dev/music`）
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）
- 修改配置后需重新登录 Spotify
- 图标：Spotify.png
