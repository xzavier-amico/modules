# Spotify — Loon

## Spotify Premium（推荐）
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-premium.plugin`

直接改写 `bootstrap` 与 `user-customization-service` 的 protobuf：把账号状态改成
premium、关掉广告位、移除免费版的试听时长上限与队列/随机限制。

与下面两个 001ProMax 版本的区别：不做整包重编码，而是按字段号走进消息、只替换目标
字段，其余字节原样写回（未知字段、字段顺序、非规范 varint 都不动）。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `spoof_premium` | true | 总开关，关闭后脚本不做任何修改 |
| `block_ads` | true | 广告属性 + 广告/推广位远程配置 |
| `unlock_playback` | true | 试听时长、队列上限、强制随机等限制 |
| `verbose_log` | false | 打印改写前后的字节数 |

注意：

- **不要**与下面的 `spotify.plugin` 同时启用，两者会改写同一个响应。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。

## 001ProMax/Surge 版（脚本版）
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify.plugin`

## 001ProMax/Surge 纯 Rewrite 版（无脚本，通过 mock 服务器）
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-rewrite.plugin`

## 说明
- 脚本版：timeout=60，max-size=-1，本地托管 js
- 纯 Rewrite 版：无脚本超时问题，但依赖外部 mock 服务器
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）
- 修改配置后需重新登录 Spotify
