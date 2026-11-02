# Spotify 去广告 — Loon

基于 001ProMax/Surge 转换。

## 说明
- 脚本不使用 $argument/$persistentStore，参数仅作 UI。
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 修改配置后需重新登录 Spotify。

## 超时与 max-size
- Loon 文档未列出 max-size 选项；Surge 默认 1MB (iOS) / 10MB (Mac)。
- 为保险起见，脚本改用 legacy 语法显式 `max-size=-1`（无限制）+ `timeout=60`。
- 原版 Kelee 用 `timeout=5`，太短导致播放中断。

## 安装
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify.plugin`
