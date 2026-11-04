# Spotify AD (Reukix) — Loon

基于 [Reukix/ukix](https://github.com/Reukix/ukix) 的 Spotify 模块转换，适配 **Loon 3.5.3 及以上版本**。

## 安装

```
https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify-reukix/spotify-reukix.plugin
```

安装后请确认：

- Loon 版本不低于 **3.5.3**（新版 Script / Rewrite 语法）。
- 已开启 MitM，并信任 Loon 证书。
- 已启用插件中的 MitM 主机：`spclient.wg.spotify.com`、`*-spclient.spotify.com`。
- 修改配置后重新启动 Spotify，必要时退出账号后重新登录。

## 包含内容

- **Premium 解锁脚本**
  - `Spotify-proto.js`：处理 `bootstrap` 与 `user-customization-service/v1/customize` 的 protobuf 响应，只写入广告、随机播放、离线等客户端功能属性；保留服务端下发的 `assignedValues`、账号属性和顶层未知字段，不再强制覆盖播放授权字段。
  - `Spotify-capabilities.js`：处理 `device-capabilities/v1/capabilities`，把设备能力标记为 Premium，用于维持 UI 和音质选项；不参与服务端播放授权。
- **Rewrite**
  - `pendragon`、`gabo-receiver-service` 返回空 200 响应。
  - 拦截 `pam-view-service`、广告歌单 `37i9dQZF1EYkqdzj48dyYq`。
  - 删除 `user-customization-service/v1/customize` 请求中的 `if-none-match`，避免命中缓存。
- **Rule**
  - 拒绝 Spotify 的 QUIC 请求，确保 HTTP 流量可被 MitM 与脚本处理。

## 播放兼容性说明

新版 Spotify 的播放授权由服务端 `playplay` 等接口决定。旧版脚本会强制写入：

- `player-license` / `player-license-v2`
- `financial-product`
- `catalogue`
- `streaming-rules`
- `on-demand`
- `high-bitrate`
- `product-expiry`

这些值会让客户端误以为自己有 Premium 播放授权，但服务端实际返回的是免费账号授权。两边不一致时，Spotify 会先尝试播放，几秒后拿不到音频密钥便自动跳到下一首（常见表现为 **3～10 秒卡断/跳歌**）。

当前版本已移除这些强制播放授权字段，只保留：

- 去广告：`ads=false`、广告 ID 限制
- 随机播放：`shuffle=false`、`smart-shuffle=AVAILABLE`
- 离线/歌词：`offline`、`offline-backup`、`lyrics-offline`
- 账号展示：`type=premium`、`subscription-enddate`

如果更新后播放正常但某些 Premium 展示项消失，这是为了避免和服务端授权冲突而做的取舍；优先保证能正常听歌。

## 关于 search / scroll 脚本

`js/` 目录中仍保留 `Spotify-search.js`、`Spotify-scroll.js`、`Spotify-gabo.js` 供参考，但插件**默认不再启用**：

- `Spotify-search.js` 会在 `browsita/v1/browse` 响应前 666 字节内直接翻转 protobuf tag（`0x32` → `0x7A`），新版本 Spotify 的 Home / Search 响应中该字段可能已是正常内容，翻转后会导致 **Home、Search 显示 “Something went wrong”**。
- `Spotify-scroll.js` 同样直接在 `scrollsita` 响应中改写固定字节（`0xF2 0x01` → `0xF7 0x07`），存在误伤正常数据的风险。
- Premium 属性解锁后，首页/搜索广告通常已由服务端按 Premium 账号处理；再叠加这两个字节级脚本收益有限、风险很高。

## 与 Surge 版的转换差异

- 使用 Loon 3.5.1(983)+ 的 `script(...) with ...` 新语法，不再使用 `script-path=`、`type=`、`max-size=` 等 Surge 参数。
- 使用 Loon 新 Rewrite 语法（`request if ... then ...`），替代 Surge 的 `[Header Rewrite]` / `[URL Rewrite]`。
- JavaScript 按 Loon API 调整：
  - 响应体统一按 `Uint8Array`（`$response.body`）处理；
  - 移除 Quantumult X 的 `$task` / `$response.bodyBytes` 分支；
  - 使用 `$response.status`、`$done({ body })`；
  - `Spotify-proto.js` 在解析失败或字段结构无法安全合并时原样放行；服务端新增的顶层字段会按原始字节保留，不再因为字段变化而放弃 Premium 修改。
- 插件规则只使用 Loon 插件允许的 `REJECT` 策略。

## 说明

- `Spotify-proto.js` 内置 protobufjs 运行时与 Spotify protobuf 定义，文件较大，首次加载可能稍慢；该脚本超时设置为 30 秒。
- 本插件仅用于学习与网络调试，请支持 Spotify 官方服务。
- 原始模块与脚本版权归 [Reukix](https://github.com/Reukix/ukix) 及原作者所有。
