# Spotify AD (Reukix) — Loon

基于 [Reukix/ukix](https://github.com/Reukix/ukix) 的 Spotify 模块转换，适配 **Loon 3.5.3 及以上版本**。

## 安装

```
https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify-reukix/spotify-reukix.plugin
```

安装后请确认：

- Loon 版本不低于 **3.5.3**（新版 Script / Rewrite 语法）。
- 已开启 MitM，并信任 Loon 证书。
- 已启用插件中的 MitM 主机：`spclient.wg.spotify.com`、`*spclient.spotify.com`。
- 修改配置后重新启动 Spotify，必要时退出账号后重新登录。

## 包含内容

- **去广告脚本**
  - `Spotify-search.js`：处理 `browsita/v1/browse` 搜索广告。
  - `Spotify-scroll.js`：处理 `scrollsita/v1/scroll/spotify` 首页/滚动广告。
  - `Spotify-gabo.js`：直接返回 `gabo-receiver-service` 空响应。
  - `Spotify-proto.js`：处理 `bootstrap` 与 `user-customization-service` 的 protobuf 响应，解锁 Premium 属性。
- **Rewrite**
  - 拦截 `pendragon`、`pam-view-service`、广告歌单 `37i9dQZF1EYkqdzj48dyYq`。
  - 删除 `user-customization-service/v1/customize` 请求中的 `if-none-match`，避免命中缓存。
- **Rule**
  - 拒绝 Spotify 的 QUIC 请求，确保 HTTP 流量可被 MitM 与脚本处理。

## 与 Surge 版的转换差异

- 使用 Loon 3.5.1(983)+ 的 `script(...) with ...` 新语法，不再使用 `script-path=`、`type=`、`max-size=` 等 Surge 参数。
- 使用 Loon 新 Rewrite 语法（`request if ... then ...`），替代 Surge 的 `[Header Rewrite]` / `[URL Rewrite]`。
- JavaScript 按 Loon API 调整：
  - 响应体统一按 `Uint8Array`（`$response.body`）处理；
  - 移除 Quantumult X 的 `$task` / `$response.bodyBytes` 分支；
  - 使用 `$response.status`、`$done({ body })`；
  - `Spotify-proto.js` 在解析失败或响应结构变化时原样放行，避免影响 Spotify 正常使用。
- 插件规则只使用 Loon 插件允许的 `REJECT` 策略。

## 说明

- `Spotify-proto.js` 内置 protobufjs 运行时与 Spotify protobuf 定义，文件较大，首次加载可能稍慢；该脚本超时设置为 60 秒。
- 本插件仅用于学习与网络调试，请支持 Spotify 官方服务。
- 原始模块与脚本版权归 [Reukix](https://github.com/Reukix/ukix) 及原作者所有。
