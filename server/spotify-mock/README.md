# Spotify Mock — 自建服务

配套 `egern/spotify/spotify-mock/`、`loon/spotify/spotify-mock/`、`shadowrocket/spotify/spotify-mock/`
三个客户端模块使用。它把 Spotify 的 `bootstrap`、`user-customization-service`、
曲目元数据与 `color-lyrics` 请求改写到自己的服务，由服务端按 protobuf 字段改写
响应：

- 伪装 Premium：`catalogue` / `type` / `player-license` / `streaming-rules` 等；
- 去广告：`ads` 属性与广告/推广位远程配置；首页、搜索页、滚动页里的赞助内容
  直接在响应体里删除；桌面端 / 移动端的 `/ads/*`、`ad-*`、`ad-on-app-open`、
  `premium-marketing/upsellOffer` 由客户端模块直接拒绝；
- 解锁播放限制：试听时长、队列上限、强制随机等（`unlockPlayback`）；
- 播放衔接：保留「交叉淡入淡出」并让它遵循 App 里的播放设置，同时强制关闭 AutoMix，
  避免下一首在上一首结束前混进来；
- 播放衔接：不改写 `crossfade_enabled` / `automix_enabled` / `use_playback_settings_*`，
  也不写 `enable-crossfade-product-state` / `enable-gapless-product-state`，播放衔接
  交给客户端自己的设置，避免上一首最后 1–2 秒被下一首顶掉；
- 歌词前置条件：把 Track 的 `has_lyrics` 改成 true，客户端才会去请求
  `color-lyrics`；
- 歌词：官方有歌词时清掉免费号的额度限制；官方没有歌词时查第三方歌词源并合成
  JSON / protobuf 响应；曲名里的影视剧名、节目名等装饰括号会先去掉再查一次；
  **官方请求与第三方查询同时发出**（`LYRICS_PARALLEL=false` 可退回串行）：
  官方 200 有歌词时用官方结果，404 时第三方结果往往已经就绪，耗时接近两者中
  较慢的那个；官方曾命中过歌词的曲目会跳过并行查询，避免每次白跑一轮；
- 歌词卡：滚动页缺少歌词 section 时立刻补一格，**不等歌词查询**——客户端打开
  Now Playing 时先渲染列表，晚到的响应只更新模型、不重绘，等多久都没用；歌词
  查询照常发起，结果写进缓存供 `color-lyrics` 复用。确认没歌词的曲目 5 分钟内
  不再补空卡。

客户端模块只做 URL 改写，**不加载任何脚本**；第三方接口请求、歌词解析、缓存和
响应合成全部在服务端完成。

不改整包、不返回静态假数据：请求会带着客户端自己的 `Authorization` 和应用头
转发到真实的 `spclient.wg.spotify.com`，只替换目标字段，未知字段和字段顺序原样
保留。这样账号相关字段仍然来自 Spotify，降低「播放几秒被跳过」的风险。

> 这是自建服务，不是公共 worker。仓库不提供现成地址，也不依赖第三方 mock。
> 模块里的 `mock_base` / `Mock服务` 默认留空，留空时不会改写请求；部署后再填自己的
> `/music` 地址。

## 三种部署方式

同一份 `src/index.js` 同时是 Cloudflare Worker 入口和本机 Node 服务的处理函数，
只用 Web 标准的 `Request` / `Response` / `fetch`。

### 方式 A：Cloudflare Worker

要求：Node.js 18+、一个 Cloudflare 账号。

```bash
cd server/spotify-mock
npm install
npx wrangler login
npm run deploy
```

部署完成后 Wrangler 会输出一个 `https://spotify-mock.<你的子域>.workers.dev`
地址。模块里的 `mock_base` 填：

```text
https://spotify-mock.<你的子域>.workers.dev/music
```

生产环境的开关写在 `wrangler.toml` 的 `[vars]` 里（或 Cloudflare 控制台的
Variables），改完重新 `npm run deploy`：

```toml
[vars]
SPOOF_PREMIUM = "true"
BLOCK_ADS = "true"
# 不写时移动端默认 true、桌面端默认 false；要给桌面端也解锁播放再打开。
# UNLOCK_PLAYBACK = "true"
# auto / true / false；auto 按请求的 User-Agent 识别客户端
DESKTOP = "auto"
# MOCK_PREFIX = "/change-me"
```

`wrangler dev` 本地调试时读取 `.dev.vars`；复制 `.dev.vars.example` 即可。

### 方式 B：本机 Node 服务

要求：Node.js 18+。没有运行时依赖，`npm install` 只装 Wrangler 这个开发依赖，
本机运行可以不装。

```bash
cd server/spotify-mock
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，至少确认 HOST / PORT / 开关
npm start
```

默认监听 `http://127.0.0.1:8787`。手机要访问同一局域网里的电脑时，把 `HOST`
改成 `0.0.0.0`，模块里的 `mock_base` 填电脑的局域网地址：

```text
http://192.168.1.10:8787/music
```

同一个服务可以同时给 iPhone / iPad 和 Mac 用：`DESKTOP` 默认是 `auto`，会按
请求的 `User-Agent` 选择桌面端或移动端的改写规则；代理把 UA 改掉、自动识别不对时，
再把 `DESKTOP` 设成 `true` / `false` 强制。

Spotify 客户端本身不直接连这个地址，是代理 App 在 URL Rewrite 后发请求，所以
本地 HTTP 通常可以用；如果代理端或网络环境要求 HTTPS，用下面任一方式终结 TLS：

- 设置 `TLS_CERT` / `TLS_KEY` 让 Node 直接跑 HTTPS；
- 前面放 Caddy / nginx 反向代理；
- 用 `cloudflared tunnel --url http://127.0.0.1:8787` 临时暴露一个 HTTPS 地址。

让 Node 直接监听 HTTPS 的例子（自签证书只适合 Cloudflare 的 Full 模式；要用
Full (strict) 就换成 Cloudflare Origin Certificate 或 Let's Encrypt 证书）：

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 3650 \
  -keyout certs/mock.key -out certs/mock.pem \
  -subj "/CN=mock.example.com" \
  -addext "subjectAltName=DNS:mock.example.com"
HOST=0.0.0.0 PORT=18443 TLS_CERT=certs/mock.pem TLS_KEY=certs/mock.key npm start
```

用 Cloudflare 代理到本机非标准端口时，边缘只接受它支持的入站端口，回源端口可以
在 **Rules → Origin Rules → Destination Port** 里改成 `18443`。SSL/TLS 选
**Full (strict)** 时，`certs/` 里要放 Cloudflare Origin Certificate 或 Let's
Encrypt 证书；自签证书只能配合 **Full** 模式，换成有效源站证书后重启服务即可。

`npm start` 会依次读取 `.env` 和 `.dev.vars`，已存在的环境变量优先，不会被文件
覆盖，所以也可以直接：

```bash
HOST=0.0.0.0 PORT=8787 BLOCK_ADS=false npm start
```

### 方式 C：Docker

```bash
cd server/spotify-mock
docker build -t spotify-mock .
docker run --rm -p 8787:8787 \
  -e SPOOF_PREMIUM=true -e BLOCK_ADS=true -e DESKTOP=auto \
  spotify-mock
```

镜像里不会带 `.dev.vars`。需要配置文件时把目录挂进去：

```bash
docker run --rm -p 8787:8787 \
  -v "$PWD/.dev.vars:/app/.dev.vars:ro" spotify-mock
```


## 环境变量

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `SPOOF_PREMIUM` | true | 伪装 Premium 展示状态；关闭后仍可单独去广告 |
| `BLOCK_ADS` | true | 广告属性 + 广告/推广位远程配置 |
| `UNLOCK_PLAYBACK` | 移动端 true / 桌面端 false | 写入试听时长、队列、随机播放等授权字段；桌面端写播放授权容易几秒跳歌，需显式设 `true` |
| `DESKTOP` | auto | 客户端模式：auto 按 User-Agent 判断；true/false 强制桌面/移动端 |
| `LYRICS_ENABLED` | true | 官方没有歌词时是否用第三方歌词补全；关闭后只清额度限制 |
| `LYRICS_SOURCE` | lrclib | `lrclib` / `musixmatch` / `netease` / `qq`；`auto` 依次尝试，也可用逗号组合，如 `lrclib,netease` |
| `LYRICS_TIMEOUT_MS` | 5000 | 一次歌词解析（元数据 + 所有歌词源）的总超时 |
| `LYRICS_CACHE_TTL` | 21600 | 命中歌词的缓存秒数；查不到 / 超时不缓存，下次请求会重试 |
| `LYRICS_PARALLEL` | true | 官方 `color-lyrics` 请求与第三方查询并行发出；设 `false` 回到「先等官方、404 再查」 |
| `MOCK_PREFIX` | 空 | 可选路径前缀，如 `/change-me`；设置后模块地址要带上 |
| `HOST` | 127.0.0.1 | 仅本机 Node 服务 |
| `PORT` | 8787 | 仅本机 Node 服务 |
| `TLS_CERT` / `TLS_KEY` | 空 | 仅本机 Node 服务；同时设置时启用 HTTPS |
| `MAX_REQUEST_BYTES` | 33554432 | 仅本机 Node 服务；请求体上限 |
| `QUIET` | false | 仅本机 Node 服务；关闭访问日志 |

布尔值接受 `true/false`、`1/0`、`yes/no`、`on/off`；`DESKTOP` 额外接受 `auto`。

### 给服务加一段隐藏路径

`MOCK_PREFIX` 会在 `/music` 前加一段只有你知道的路径：

```text
MOCK_PREFIX=/change-me
mock_base = https://host/change-me/music
```

这不是强认证，但能避免服务地址被扫描到后随便打。更强的保护用 Cloudflare
Access、WAF Rate Limiting，或在反向代理上加 Basic Auth / IP 白名单。

## 接口

服务只代理 `/music/*`（固定转发到 `spclient.wg.spotify.com`），不会变成任意目标的
开放代理。下表中的路径会按需改写；其它 `/music/*` 路径原样透传，避免客户端拿
不到新数据时回退到旧缓存（例如残留的赞助卡片）。

| 路径 | 作用 |
| --- | --- |
| `/music/bootstrap[/v{N}/bootstrap]` | 改写账号状态、广告属性、远程配置 |
| `/music/user-customization-service/...` | 同上（UCS） |
| `/music/extended-metadata/...` | 去掉请求体里的 etag，补 `has_lyrics` |
| `/music/context-resolve/...` | 补 `has_lyrics` 兜底 |
| `/music/connect-state/...` | 补 `has_lyrics` 兜底 |
| `/music/metadata/4/track/...` | 补 Track 的 `has_lyrics` |
| `/music/color-lyrics/v{N}/track/...` | 官方请求与第三方查询并行；清歌词额度限制，官方没歌词时复用并行结果合成第三方歌词 |
| `/music/casita/v{N}/home...` | 删除首页里的广告 / 赞助区块 |
| `/music/browsita/v{N}/browse...` | 隐藏搜索页的赞助区块 |
| `/music/scrollsita/v{N}/scroll/{uri}` | 隐藏滚动页的广告区块；查到歌词时才补歌词 section，并预热歌词缓存 |
| `/music/remote-config-resolver/...` | 改写远程配置里的广告开关（含 `unauth` 启动配置） |
| `/music/nebula/...` | 改写远程配置里的广告属性 |
| 其它 `/music/*` | 原样透传 |

`/health`（或 `/healthz`、`/`）返回服务版本和当前开关，不需要上游请求：

```bash
curl -s https://your-host/health | jq
curl -s http://127.0.0.1:8787/health | jq
```

响应头里的 `x-spotify-mock: patched` 表示这次响应确实被改写，
`passthrough` 表示原样返回。首页 / 搜索 / 滚动 / 远程配置接口还会带上
`x-spotify-mock-ads: home|browse|scroll|configuration|attributes`，表示对应广告内容
已处理；`none` 表示这次响应没匹配到广告结构，已原样返回。Worker 日志 / 本机访问
日志会显示 `ads=...`，同样不会打印请求体或 `Authorization`。`/health` 里的
`unlockPlayback: "auto"` 表示移动端开启、桌面端关闭；显式设置 `UNLOCK_PLAYBACK`
后显示实际布尔值。`options.lyrics` 会显示歌词开关、来源、超时、缓存时间和
`parallel`（官方请求与第三方查询是否并行）。

访问日志里的 `499` 是客户端主动取消（切歌、关闭页面时 Spotify 会取消在途的
metadata / connect-state 请求），不是服务端错误；`500` 才需要看上一行的
`local request failed` 原因。

### 去广告覆盖到哪些位置

服务端：

- `bootstrap` / `user-customization-service` / `remote-config-resolver` /
  `nebula`：把账号状态和远程配置里的广告开关关掉，避免 App 重新拉配置后又打开；
- `casita/v*/home`：删除广告 / 赞助区块。按区块 header 名（`|brand-ad`、`|hpto`、
  `|*-ad`）或内容字段（20 / 21）识别，删除后重算外层长度；
- `browsita/v*/browse`：把嵌套结构里大于 12000 字节的 field 6（赞助块）改名为
  未知字段 1000，客户端会跳过它，其它内容不动；
- `scrollsita/v*/scroll/{uri}`：把 field 30（广告块）改名为 1000。

以上每个改写都是防御式的：解析失败、结构不像预期或没找到广告字段时返回原响应，
不会把正常内容写坏。

专辑页的发行日期、“即将发行”标签来自 Spotify 自己的 `album-entity-view` /
`artistview` 接口，本服务不改写这些路径，所以它们显示异常与去广告 / Premium
改写无关；可以先用官方客户端或网页版对照同一张专辑确认。

客户端模块还会：

- 直接拒绝 `/ads/*`、`/ad-logic/*`、`ad-on-app-open`、`premium-marketing/upsellOffer`
  等纯广告 / 推广路径；不拦 `/social`、`gabo`、`pendragon`，它们分别影响好友动态、
  事件上报与消息服务；
- 拒绝 Spotify 的 QUIC。QUIC 不经过 HTTP 代理，不拒绝时部分接口可能完全绕过
  URL Rewrite / MITM，日志里看不到 `ads=...` 就是这个原因。个别版本拒绝 QUIC 后
  会出现播放几秒跳歌，建议先确认再长期启用。

仍然去不掉：免费号的音频广告是 Spotify 服务端缝进音频流里的，还有一部分音频广告
元数据直接从服务端下发；这些无法通过改响应体删除。

## 本地验证

```bash
cd server/spotify-mock
npm test
npm run check
```

`test/patcher.test.js` 用合成 protobuf 验证 Premium/广告字段、`has_lyrics`、
etag 清除；`test/handler.test.js` 用假的 `fetch` 验证路由、请求头、响应头和
`MOCK_PREFIX`；`test/lyrics.test.js` 验证官方歌词清 restriction、404 时合成
JSON / protobuf 歌词、官方与第三方并行查询（`LYRICS_PARALLEL`）、滚动页补卡与
空卡兜底以及开关行为。全部测试都不会访问真实 Spotify 或第三方歌词源。

## 部署后怎么确认生效

1. 浏览器或 `curl` 打开 `/health`，确认服务和开关正确。
2. 客户端模块里填好 `mock_base`，开启 MITM 并信任证书。
3. 完全退出 Spotify 再打开；切换一次网络也会让它重新拉 bootstrap。
4. 看 Worker 日志 / 本机访问日志，应该出现 `/music/bootstrap`、
   `/music/user-customization-service/...`、`/music/color-lyrics/...`，
   以及打开首页 / 搜索 / 滚动页时的 `/music/casita/...`、`/music/browsita/...`、
   `/music/scrollsita/...` 和远程配置接口。对应响应头里的
   `x-spotify-mock-ads` 应该是 `home` / `browse` / `scroll` / `configuration` /
   `attributes`，而不是 `none`。
5. 如果广告还在，先在日志里确认有没有这些请求：完全没有说明请求走了 QUIC 或被
   客户端缓存绕过，先启用模块里的 QUIC REJECT 规则；有请求但 `ads=none`，说明
   Spotify 换了响应结构，需要对照上游规则更新 `src/patcher.js`。
6. 如果日志里一直是 `passthrough`，说明响应结构没匹配上：先确认 `DESKTOP` 是
   `auto`，再对照 `src/patcher.js` 的字段表；必要时临时把 `DESKTOP` 设成 `true`
   或 `false` 排除 UA 判断问题。歌词一直 `passthrough` 时，先确认
   `LYRICS_ENABLED` 没被关掉，再看 `LYRICS_SOURCE` 指向的歌词源能不能查到这首歌。

## 注意

- 免费号的音频广告是 Spotify 缝进音频流里的，服务端改 bootstrap 只能关掉广告
  开关和展示位；首页 / 搜索 / 滚动页的赞助卡片可以由本服务删除，但音频广告仍然
  要靠客户端规则，效果有限。
- 播放授权、音质、下载、Spotify Connect 最终由 Spotify 服务端判定，改写
  bootstrap 不等于真的拿到 Premium 音频密钥。
- 歌词补全会把曲目 ID 发给 `open.spotify.com/oembed`，再把曲名 / 歌手发给
  `LYRICS_SOURCE` 指向的第三方歌词源；介意的话设 `LYRICS_ENABLED=false`。
  并行开启时，官方**有**歌词的曲目也会先跑一轮第三方查询（结果丢弃），
  官方曾命中过后会自动跳过；不想多这些请求就设 `LYRICS_PARALLEL=false`
  退回「先等官方、404 再查」。
- 第三方歌词源可能被网络环境或 Cloudflare Worker 出口限制挡住，查不到时服务端
  原样返回官方的「暂无歌词」，不影响播放。
- 首次生效需要让 App 重新拉 bootstrap；客户端本地有缓存，重启 App 或切换网络
  最稳。
- Spotify 更新 protobuf 字段后可能需要同步 `src/patcher.js` 的字段号/规则表。
- 不要把带 `Authorization` 的请求日志、抓包或 `.dev.vars` 提交到仓库。
- 仅用于个人学习与自用，不保证账号安全或长期可用。

## 许可

`src/patcher.js` 由本仓库 `src/spotify` 的客户端片段生成（`node scripts/build-server.js`），
`src/lyrics.js` 移植自本仓库原 `spotify-mock` 客户端脚本 `js/spotify_lyrics.js`；字段号与规则表来自
[whoeevee/EeveeSpotifyReborn](https://github.com/whoeevee/EeveeSpotifyReborn) 与
[skopevoj/spoti.pw](https://github.com/skopevoj/spoti.pw)（GPL-3.0）。本目录按
GPL-3.0 分发。
