# Spotify 去广告 — Loon 插件（修复版）

基于 Kelee Spotify_remove_ads，修复 timeout 过短导致播放中断的问题。

## 说明
- 原版 `timeout=5`（5秒）对大型 bootstrap 响应的 protobuf 解析不够，脚本超时 → 请求中断 → 歌曲播放几秒就停。
- 修复：`timeout=30`。
- Loon 不暴露 max-size 选项（script_v2 文档未列出），默认无严格限制；问题主因是 timeout。

## 安装
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-remove-ads.plugin`

需要开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。

## 注意
- 脚本仍引用 Kelee 的原始 URL（自动更新）；本地备份在 `loon/spotify/spotify_remove_ads.js`。
- 修改配置后需重新登录 Spotify 生效。
