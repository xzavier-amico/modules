# Spotify — Egern 模块

## 001ProMax/Surge 版（脚本版）
- Egern：`egern/spotify/spotify.yaml` + `js/spotify_crack.js`
- Loon：`loon/spotify/spotify.plugin`

## 001ProMax/Surge 纯 Rewrite 版（无脚本，通过 mock 服务器）
- Egern：`egern/spotify/spotify-rewrite.yaml`
- Loon：`loon/spotify/spotify-rewrite.plugin`

## 说明
- 脚本版：protobuf 解析去广告，timeout=60，max-size=-1（legacy）
- 纯 Rewrite 版：通过 mock 服务器返回修改后响应，无脚本超时问题，但依赖外部 mock 服务器（`https://mock.trigram-masques-8r.workers.dev/music`）
- 需开启 MitM（`*-spclient.spotify.com`、`spclient.wg.spotify.com`）
- 修改配置后需重新登录 Spotify
- 图标：Spotify.png
