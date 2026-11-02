# Spotify 去广告 — Loon

基于 001ProMax/Surge 转换。

## 安装
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify.plugin`

## 说明
- 脚本不使用 $argument/$persistentStore，参数仅作 UI。
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 修改配置后需重新登录 Spotify。
- Loon 不暴露 max-size，问题主因是 timeout=5（已修为 30）。
