# Spotify AD (Reukix) — Egern + Loon

基于 Reukix/ukix 的 Spotify 模块（多脚本版：search/scroll/gabo/proto）。

## 导入 URL
- Egern：`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/spotify-reukix/spotify-reukix.yaml`
- Loon：`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify-reukix/spotify-reukix.plugin`

## 说明
- 4 个脚本：search（搜索去广告）、scroll（滚动去广告）、gabo（广告上报 mock）、proto（protobuf 去广告）
- 3 条 URL rewrite（reject pendragon/pam-view-service/37i9dQZF1EYkqdzj48dyYq）
- 1 条 header rewrite（删除 if-none-match）
- max_size=33554432（Egern）/ timeout=60（proto）
- 需开启 MitM（`spclient.wg.spotify.com`、`*spclient.spotify.com`）
- 修改配置后需重新登录 Spotify
- 图标：Spotify.png
