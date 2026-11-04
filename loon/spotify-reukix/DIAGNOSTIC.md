# 播放诊断版（临时）

这个分支只用于定位 **8～10 秒自动跳歌** 的原因，不是最终版本。

## 和正式版的区别

- 只保留去广告属性：`ads=false`、`nft-disabled=1`、两个 `madprops` 开关。
- **不写入** `type=premium`、`unrestricted`、`subscription-enddate`、`audio-quality`。
- **不写入** `player-license`、`catalogue`、`on-demand`、`high-bitrate`、
  `streaming-rules`、`financial-product`、`product-expiry`。
- 不加载 `Spotify-capabilities.js`，不修改设备能力/HiFi 声明。
- 暂时移除 `pam-view-service`、`37i9...` 拦截和 `gabo`/`pendragon` 空响应。
- 暂时移除 QUIC REJECT。app2smile #274 中有用户反馈，Quantumult X 里
  `udp_drop_list = 443, STUN, QUIC` 会导致同样的跳歌，注释掉后恢复。

这样客户端会按服务端下发的真实账号状态请求音频，只保留去广告效果。
如果这个版本播放正常，说明问题出在“客户端误以为自己有 Premium 播放权限”
或设备 HiFi 能力声明上，再逐项加回即可定位。

## 测试步骤

1. 安装本分支的 `spotify-reukix-diag.plugin`，停用正式版插件，避免两个插件同时生效。
2. Spotify 设置 → 音质：先改成 **Normal / High**，不要用 Very High / Lossless。
3. 完全退出 Spotify，清理 Spotify 缓存（或卸载重装），再打开。
4. 播放一个歌单，先不要只点单曲；观察是否还会在 8～10 秒跳歌。
5. 如果仍然跳歌：停用本插件（或关闭 Spotify 的 MitM），再播放同一歌单。
   - 停用后正常 → 问题在 Loon 的 MitM/规则/脚本。
   - 停用后仍然跳歌 → 问题在 Spotify 账号/地区/免费额度或服务端，不在插件。

## 下一步

- 诊断版正常：先只加回 QUIC REJECT 测试。
  - 加回后跳歌 → 原因就是 QUIC REJECT。
  - 加回后正常 → 再逐项加回 `type=premium` → `unrestricted` → `audio-quality`
    → capabilities → PAM/gabo 规则，每次只加一项。
- 诊断版仍跳歌：用 `spotify-reukix-diag2.plugin`，把 `guc3-spclient.spotify.com`
  从 MitM 中排除，再测试是否为 playplay / audio-key 的 MitM/H2 处理导致；
  同时用“完全停用插件”做对照。

## 诊断版 2：排除 guc3

`spotify-reukix-diag2.plugin` 只改 MitM：

```
hostname = spclient.wg.spotify.com, *-spclient.spotify.com, -guc3-spclient.spotify.com
```

这样 playplay / audio-key 走 `guc3-spclient.spotify.com` 时不再经过 Loon 解密；
bootstrap/customize 如果走其它 shard，仍然可以打补丁。测试时先保持蜂窝 + 锁屏，
如果还卡，再用 Wi-Fi + 亮屏做对照，区分是 Loon 还是 iOS 后台网络。
