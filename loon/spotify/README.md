# Spotify — Loon

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-premium.plugin`

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

注意：

- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 首次生效需要让 App 重新拉 bootstrap：切换一次网络或重启 App。
- 音质、下载、Spotify Connect 由服务端判定，脚本改不了。
