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
  - `Spotify-proto.js`：处理 `bootstrap` 与 `user-customization-service/v1/customize` 的 protobuf 响应，写入 Premium 账号属性；保留服务端下发的实验/功能开关，不再整体覆盖 `assignedValues`。
- **Rewrite**
  - `pendragon`、`gabo-receiver-service` 返回空 200 响应。
  - 拦截 `pam-view-service`、广告歌单 `37i9dQZF1EYkqdzj48dyYq`。
  - 删除 `user-customization-service/v1/customize` 请求中的 `if-none-match`，避免命中缓存。
- **Rule**
  - 拒绝 Spotify 的 QUIC 请求，确保 HTTP 流量可被 MitM 与脚本处理。

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
  - `Spotify-proto.js` 在解析失败或响应结构变化时原样放行，避免影响 Spotify 正常使用。
- 插件规则只使用 Loon 插件允许的 `REJECT` 策略。

## 说明

- `Spotify-proto.js` 内置 protobufjs 运行时与 Spotify protobuf 定义，文件较大，首次加载可能稍慢；该脚本超时设置为 30 秒。
- 本插件仅用于学习与网络调试，请支持 Spotify 官方服务。
- 原始模块与脚本版权归 [Reukix](https://github.com/Reukix/ukix) 及原作者所有。
