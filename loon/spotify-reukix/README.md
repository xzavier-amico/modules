# Spotify AD (Reukix) — Loon

基于 Reukix/ukix 的 Spotify 模块（多脚本版）。

## 安装
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify-reukix/spotify-reukix.plugin`

需要开启 MitM（`spclient.wg.spotify.com`、`*spclient.spotify.com`）。

## 说明
- 4 个脚本：search / scroll / gabo / proto
- 3 条 rewrite（reject）+ 1 条 header rewrite（delete if-none-match）
- max-size 不限（proto timeout=60）
- 修改配置后需重新登录 Spotify
