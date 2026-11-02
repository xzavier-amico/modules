# Spotify 去广告 — Egern + Loon

## 001ProMax/Surge 版（转换）

- Egern：`egern/spotify/spotify.yaml` + `js/spotify_crack.js`
- Loon：`loon/spotify/spotify.plugin`

## Kelee 版（timeout 修复）

- Loon：`loon/spotify/spotify-remove-ads.plugin`（timeout 5→30）

## 说明
- 脚本不使用 $argument/$persistentStore，参数仅作 UI。
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）。
- 修改配置后需重新登录 Spotify。
