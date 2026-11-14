# Spotify Mock — Egern

`https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/spotify/spotify-mock/spotify-mock.yaml`

自建 Mock 服务版 Spotify 模块：把 `bootstrap`、`user-customization-service`、
曲目元数据、`color-lyrics`、首页 / 搜索 / 滚动页和远程配置请求改写到自己的服务，
由服务端按 protobuf 字段改写响应：

- 伪装 Premium（`catalogue` / `type` / `player-license` / `streaming-rules` 等）；
- 去广告（`ads` 属性与广告/推广位远程配置；删除首页 / 搜索 / 滚动页的赞助内容）；
- 解锁播放限制（试听时长、队列上限、强制随机等）；
- 把 Track 的 `has_lyrics` 改成 true，客户端才会去请求 `color-lyrics`；
- 歌词：官方有歌词时清掉免费号的额度限制，官方没有歌词时用第三方歌词补全。

**客户端不加载任何脚本。** 所有改写都在服务端完成，模块本身只有 URL 改写和
MITM 配置。

> **先部署服务再用模块。** 部署方法见
> [`server/spotify-mock/README.md`](https://github.com/xzavier-amico/modules/blob/master/server/spotify-mock/README.md)。
> 仓库不提供公共 mock 地址；`mock_base` 默认留空，留空时模块不改写任何请求，
> Spotify 仍走官方接口。

同一份模块同时适用于 iPhone / iPad 和桌面端。服务端默认 `DESKTOP=auto`，会按
请求的 User-Agent 自动识别桌面客户端并使用只写展示 / 广告属性的桌面规则，同时
按桌面格式合成 JSON 歌词。自动识别不对时，在服务端改 `DESKTOP` 环境变量。

## 和 Spotify Premium 二选一

`egern/spotify/spotify-premium.yaml` 在客户端改写同一批响应。两个模块同时启用
会互相覆盖。用自建服务就只开这个；不想部署服务就用原来的 Spotify Premium。

## 安装

1. Egern → 模块 → 添加模块，粘贴上面的 raw URL；或点 README 顶部的安装链接。
2. 在模块设置里把 `Mock 服务地址` 改成自己的 `/music` 地址：
   - Cloudflare Worker：`https://spotify-mock.<子域>.workers.dev/music`
   - 本机 Node：`http://192.168.1.10:8787/music`（手机和电脑同一局域网）
3. 开启 MITM，并安装、信任 Egern 的 CA 证书。
4. 完全退出 Spotify 再打开，或切换一次网络让它重新拉 bootstrap。

`mock_base` 不要带结尾斜杠。服务端如果设置了 `MOCK_PREFIX`，这里也要带上，
例如 `https://host/change-me/music`。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `mock_base` | 空 | 自建服务的 `/music` 地址；留空时不改写请求 |

服务端的开关（`SPOOF_PREMIUM`、`BLOCK_ADS`、`UNLOCK_PLAYBACK`、`DESKTOP`、
`LYRICS_ENABLED`、`LYRICS_SOURCE`）在 Worker 环境变量或本机 `.dev.vars` 里改，
不在 Egern 模块参数里。`DESKTOP` 默认 `auto`，按 User-Agent 识别桌面端。

## 工作方式

```text
Spotify
  │  bootstrap / UCS / 元数据 / 歌词 / 首页 / 搜索 / 滚动页 / 远程配置 ...
  ▼
Egern url_rewrites（无 status_code = header 模式，透明改 URL 和 Host）
  │
  ▼
你的 mock 服务 ── 带上 Authorization / 应用头 ──► spclient.wg.spotify.com
  │                                                   │
  │◄──────────── 原始 protobuf 响应 ──────────────────┘
  │  按字段改写 Premium / 广告开关；删除 feed 里的赞助区块
  │  color-lyrics：清 restriction，或合成第三方歌词
  ▼
Spotify
```

服务端不会返回整包假数据：账号相关字段仍然来自 Spotify，只替换目标字段，未知
字段和字段顺序原样保留。歌词也由服务端处理，客户端不加载脚本。

## 验证

1. `curl https://你的地址/health`，确认 `ok: true`、开关和 `options.lyrics` 正确。
2. 看服务端日志 / Worker 日志，应该出现 `/music/bootstrap`、
   `/music/user-customization-service/...`、`/music/color-lyrics/...`，
   以及打开首页 / 搜索 / 滚动页时的 `/music/casita/...`、`/music/browsita/...`、
   `/music/scrollsita/...` 和远程配置接口。
3. 服务端响应头 `x-spotify-mock: patched` 表示这次确实改写了；`passthrough`
   表示原样返回（官方歌词正常、或没匹配到第三方歌词）。feed / 配置接口还会带
   `x-spotify-mock-ads: home|browse|scroll|configuration|attributes`；`none` 表示
   没匹配到赞助内容。

## 注意

- 免费号的音频广告是 Spotify 缝进音频流里的，服务端改 bootstrap 只能关掉广告
  开关和展示位；首页 / 搜索 / 滚动页的赞助卡片可以由本服务删除，但音频广告仍会
  出现。
- 模块会拒绝 Spotify 的 QUIC，强制回落到 TCP；否则走 QUIC 的接口会绕过 URL
  Rewrite / MITM，日志里看不到对应的 `ads=...`。个别版本拒绝 QUIC 后可能播放
  几秒跳歌，遇到就先停用这条规则。
- 播放授权、音质、下载、Spotify Connect 由 Spotify 服务端判定，改写 bootstrap
  不等于真的拿到 Premium 音频密钥。
- 补全的只是 Now Playing 界面（封面下方那行同步歌词）。完整歌词页的入口由
  Spotify 进程内部决定，代理层改不到。
- 首次生效需要让 App 重新拉 bootstrap；客户端有缓存，重启 App 或切换网络最稳。
- 需要 MITM：`*-spclient.spotify.com`、`spclient.wg.spotify.com`。
- 本机服务默认只监听 `127.0.0.1`；手机访问要把 `HOST` 改成 `0.0.0.0`，并注意
  局域网里其他人也能访问，建议设置 `MOCK_PREFIX` 或加反代认证。
- 本机 HTTP 地址能不能被代理 App 接受取决于客户端；不行就用 Cloudflare Tunnel
  或反代给它一个 HTTPS 地址。
