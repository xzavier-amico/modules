# Spotify 去广告 — Loon

## 001ProMax/Surge 版（脚本版）
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify.plugin`

## 001ProMax/Surge 纯 Rewrite 版（无脚本，通过 mock 服务器）
`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/spotify/spotify-rewrite.plugin`

## 说明
- 脚本版：timeout=60，max-size=-1，本地托管 js
- 纯 Rewrite 版：无脚本超时问题，但依赖外部 mock 服务器
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）
- 修改配置后需重新登录 Spotify
