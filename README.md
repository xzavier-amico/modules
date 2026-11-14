# modules

个人自用的 **Egern / Loon / Shadowrocket** 模块仓库。模块直接托管在 GitHub raw，按平台分目录维护：

- `egern/` — Egern 模块（YAML）
- `loon/` — Loon 插件（plugin）
- `shadowrocket/` — Shadowrocket 模块（sgmodule）

## 模块索引

| 模块 | Egern | Loon | Shadowrocket | 说明 |
| --- | :---: | :---: | :---: | --- |
| YouTube Enhance | [安装](https://egernapp.com/modules/new?name=YouTube%20Enhance&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fyoutube%2Fyoutube-enhance.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fyoutube%2Fyoutube-enhance.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/youtube/youtube-enhance.sgmodule) | 去广告、字幕翻译、YouTube Music 去广告/后台播放、默认分辨率、首页菜单与 Shorts 过滤；后台播放/PiP 常开；支持 www / m / YouTube Music 网页版（JSON 响应） |
| Spotify Enhance | [安装](https://egernapp.com/modules/new?name=Spotify%20Enhance&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fspotify%2Fspotify-enhance.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fspotify%2Fspotify-enhance.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/spotify/spotify-enhance.sgmodule) | 改写 bootstrap / UCS / 远程配置 / 账号属性 / feed 的 protobuf：去广告（含首页、搜索、滚动页赞助内容）、伪装 Premium、解锁顺序/随机播放；官方没有歌词时注入第三方歌词：首次进入就补歌词卡（等歌词响应返回后再放行列表，最多等 800ms，明确查不到则不补空卡）。新版 App 走 QUIC 时由规则强制回落 TCP。Loon 插件按 User-Agent 自动适配 iPhone / iPad 与 Loon for Mac，桌面端默认不写播放授权 |
| Spotify Mock | [安装](https://egernapp.com/modules/new?name=Spotify%20Mock&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fspotify%2Fspotify-mock%2Fspotify-mock.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fspotify%2Fspotify-mock%2Fspotify-mock.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/spotify/spotify-mock/spotify-mock.sgmodule) | 自建 Mock 服务：把 bootstrap / UCS / 元数据 / 歌词 / 首页 / 搜索 / 滚动页 / 远程配置改写到自己的 Cloudflare Worker 或本机 Node 服务，服务端改写 protobuf 实现去广告（含 feed 赞助内容）、伪装 Premium、解锁播放限制、补 has_lyrics 与第三方歌词；客户端零脚本；含 Loon for Mac，服务端按 UA 自动识别桌面端；需先部署 `server/spotify-mock` |
| Tubi Clean | [安装](https://egernapp.com/modules/new?name=Tubi%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Ftubi%2Ftubi-clean.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Ftubi%2Ftubi-clean.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/tubi/tubi-clean.sgmodule) | 去广告：清空内容元数据里的 cue_points，广告接口返回空列表 / 空 VAST，视频流不动，不触发反广告拦截。字幕翻译：追加中文 SRT 轨，默认英文原句 + 中文双语显示，DeepL / Google 密钥优先，免费 Edge 回退；App 与网页版（tubitv.com/oz/）同时支持，可单独关闭网页版 |
| Pluto TV Clean | [安装](https://egernapp.com/modules/new?name=Pluto%20TV%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fpluto%2Fpluto-clean.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fpluto%2Fpluto-clean.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/pluto/pluto-clean.sgmodule) | 去广告：boot 的 serverSideAds 改成 false，再删掉 HLS 点播清单里的广告段。字幕翻译：翻译外挂 WebVTT，默认英文原句 + 中文双语（上下两条 cue）；App 与网页版（appName=web / deviceType=web）共用同一套清单 / 会话改写，可单独关闭网页版 |
| Emby Unlock | [安装](https://egernapp.com/modules/new?name=Emby%20Unlock&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Femby%2Femby-unlock.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Femby%2Femby-unlock.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/emby/emby-unlock.sgmodule) | 解锁 Emby iOS 客户端的完整播放：mock mb3admin.com 授权校验；不含服务器端 Premiere |
| BiliBili Enhance | [安装](https://egernapp.com/modules/new?name=BiliBili%20Enhance&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fbilibili%2Fbilibili-enhance.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fbilibili%2Fbilibili-enhance.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/bilibili/bilibili-enhance.sgmodule) | 去广告、去会员推广、去遥测、精简界面（底部「发布」/「会员购」、顶部「游戏中心」、「我的」页「我的服务」）；详情页与评论区走 gRPC 也一并改写；playurl 与 gRPC 播放请求都自动要最高画质；支持网页版推荐/搜索/相关推荐/详情/动态/番剧/直播 API |
| Delivery Clean | [安装](https://egernapp.com/modules/new?name=Delivery%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fdelivery%2Fdelivery-clean.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fdelivery%2Fdelivery-clean.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/delivery/delivery-clean.sgmodule) | 京东 / 美团 / 饿了么：拒绝广告域名，MITM 改写美团开屏、点餐广告板与京东促销楼层，保守过滤信息流广告 |
| CN Video Clean | [安装](https://egernapp.com/modules/new?name=CN%20Video%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fcnvideo%2Fcnvideo-clean.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fcnvideo%2Fcnvideo-clean.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/cnvideo/cnvideo-clean.sgmodule) | 优酷 / 爱奇艺 / 腾讯视频：拒绝广告、广告 SDK 与遥测域名；纯规则 |
| AMap Clean | [安装](https://egernapp.com/modules/new?name=AMap%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Famap%2Famap-clean.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Famap%2Famap-clean.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/amap/amap-clean.sgmodule) | 高德地图：去开屏、首页信息流、探索推荐、路线页、打车页运营位与「我的」页面广告，拒绝广告素材和日志 / 曝光上报；需 MITM |
| ADBlock | [安装](https://egernapp.com/modules/new?name=ADBlock&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fadblock%2Fadblock.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fadblock%2Fadblock.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/adblock/adblock.sgmodule) | 常见国内外广告 URL 重写拦截，并集中拦截广告平台、HTTPDNS 与通用遥测 / 归因 / 崩溃 SDK 域名 |
| Xiaohongshu Clean | [安装](https://egernapp.com/modules/new?name=Xiaohongshu%20Clean&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fxiaohongshu%2Fxiaohongshu-clean.yaml) | [安装](https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fxiaohongshu%2Fxiaohongshu-clean.plugin) | [安装](https://raw.githubusercontent.com/xzavier-amico/modules/master/shadowrocket/xiaohongshu/xiaohongshu-clean.sgmodule) | 小红书去广告：首页瀑布流、搜索结果、评论区、开屏与商品推广位；可选精简购物 / 市集 / 直播 tab |

命名约定：带播放、画质、歌词、字幕等功能增强的模块用 `Enhance`；只做去广告、界面精简的模块用 `Clean`；`Unlock` / `Mock` 保持原义。

> 2026-11-14 模块统一改名：`BiliBili Clean` → `BiliBili Enhance`、`Spotify Premium` → `Spotify Enhance`、`* Ad-Free` → `* Clean`。旧 raw 地址不再更新，已导入的模块请删除后按上表重新导入；脚本内部 URL 未改，重新导入前旧规则通常仍能继续工作，但不会收到模块级更新。

表格里的「安装」统一用 HTTPS 链接：GitHub 会过滤 `egern:`、`loon:`、`shadowrocket:` 这类自定义 scheme，写成 `[安装](loon://…)` 渲染出来只是纯文本。Egern、Loon 用官方的一键导入链接；Shadowrocket 没有 HTTPS 唤起入口，表格里放的是 sgmodule 的 raw 地址，点开后复制地址，在小火箭 → 配置 → 模块 → 右上角 `+` 粘贴导入（把 `shadowrocket://install?module=<raw URL>` 粘到 Safari 地址栏也能直接唤起小火箭）。

> Spotify Mock 是自建服务版，需要先部署 [`server/spotify-mock`](server/spotify-mock/README.md)（Cloudflare Worker 或本机 Node 均可），再把模块参数里的 `mock_base` / `Mock服务` 改成自己的 `/music` 地址。地址默认留空，留空时模块不改写任何请求；仓库不提供公共 mock 地址。它和 Spotify Enhance 会改写同一批响应，两者二选一。iPhone / iPad 与 Loon for Mac 共用同一份插件，服务端 `DESKTOP=auto` 按 UA 自动识别桌面端。三端模块只做 URL 改写，歌词补全和首页 / 搜索 / 滚动页 / 远程配置的广告过滤都在服务端完成，客户端不加载任何脚本；歌词开关和来源用服务端的 `LYRICS_ENABLED` / `LYRICS_SOURCE` 环境变量控制。模块默认拒绝 Spotify 的 QUIC 以强制走 TCP，否则部分接口会绕过 MITM。

> `loon/local-reflect/local-reflect.plugin` 是本机开发用的服务回环插件（把发往 `10.7.0.1` 的连接反射回本机），依赖 Loon 的 `[IP Rewrite]` 与 `include-tun`，Shadowrocket 没有对应能力，未列入上表。

## 安装

### Egern

直接点表格里的「安装」会通过 Egern 官方 Universal Link（`https://egernapp.com/modules/new?name=…&url=…`）唤起 Egern 并导入；也可以手动在 Egern → 模块 → 添加模块里粘贴 YAML 的 raw URL，或写进主配置：

```yaml
modules:
  - name: "YouTube Enhance"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml"
    enabled: true
```

### Loon

直接点表格里的「安装」会通过 Loon 官方一键导入链接（`https://www.nsloon.com/openloon/import?plugin=…`）唤起 Loon 并导入；也可以手动在 Loon → 插件 → 右上角 `+` → 从 URL 导入，粘贴 plugin 的 raw URL。

### Shadowrocket

表格里的「安装」打开的是 sgmodule 的 raw 地址；Shadowrocket 官方只有 `shadowrocket://install?module=…` 这种自定义 scheme，GitHub 会把它从 Markdown 里过滤掉。复制 raw 地址后在 Shadowrocket → 配置 → 模块 → 右上角 `+` 粘贴导入。模块顶部用 `#!arguments` 声明参数，导入后在「模块 → 编辑参数」里改，保存后重新进入模块即可生效。

Shadowrocket 的模块语法与 Loon 不同，转换时做了这些映射：

- `[Argument]` → `#!arguments` + `{{{参数}}}` 占位符；
- `script(...) with ...` → `type=http-request/http-response` 加 `requires-body` / `binary-body-mode` / `max-size` / `timeout`；
- `request if ${url} ~= /…/ then reject(404)` → `[URL Rewrite]` 的 `reject` / `reject-200` / `reject-dict` / `reject-img`；
- `request.header.del("if-none-match")` → `[Header Rewrite]` 的 `header-del`；
- `[MitM]` → `[MITM] hostname = %APPEND% …`；
- Loon 的 `enable=${param}` 条件加载在 Shadowrocket 里没有对应项，改由脚本内部提前返回（脚本本身已经支持）。

## 通用要求

- 需要改写 HTTPS 响应的模块（YouTube、Spotify、Tubi、Pluto、Emby、Bilibili、Delivery、AMap、Xiaohongshu、ADBlock 的 HTTPS 规则）必须在客户端安装并信任 CA 证书，并开启 MITM；具体域名见各模块的 `mitm` / `[MitM]` / `[MITM]` 段。
- CN Video Clean 是纯规则模块，不需要 MITM。ADBlock 的域名规则不需要 MITM，但其中的 URL 重写部分需要。
- YouTube 的 response / ump 脚本需要处理大响应，三端都已把 timeout 调到 60s；设备较慢时可继续调大。
- YouTube 的脚本按请求阶段拆成 `youtube.request.js` / `youtube.key.js` / `youtube.response.js`，插件只把对应阶段的请求交给对应脚本；`ad_break` / `log_event` 请求不再强制读取 body。网页版 `www.youtube.com` / `m.youtube.com` 的 youtubei 响应是 JSON，脚本走单独的保守 JSON 改写路径，不套用 protobuf 解码。
- YouTube 与 Bilibili 的「支持网页版」默认开启；关闭后网页版请求完全放行，App / gRPC 逻辑不受影响。Bilibili 网页版只改 API JSON，不改网页 HTML 里的 `__INITIAL_STATE__`。
- 带脚本的模块（YouTube、Bilibili、Spotify、小红书）都内置了 QUIC REJECT 规则（`PROTOCOL, QUIC`），强制客户端回落 TCP。HTTP/3 走 UDP 不经过 HTTP 代理，不拒绝时脚本看不到这些请求，表现就是「装了模块但完全没生效」。这条规则是必需的，不要为了省一次回落删掉。
- Shadowrocket 的脚本运行在内存受限的 Network Extension 里，sgmodule 里的 `max-size` 是保险丝：超过上限的响应直接放行，不会把脚本拖死。正常响应远低于上限。

## 目录结构

```text
src/<module>/                       # 脚本源文件（所有模块，含 bilibili / delivery / emby）
src/proto/wire.js                   # protobuf 底层编解码：varint / 字段切分 / 字段编码
src/proto/grpc.js                   # gRPC 公共层：帧拆分重组 + 字段级删改
src/bilibili/grpc/                  # B 站 gRPC 脚本的 head / rules / entry 片段
src/compat/shadowrocket.js          # Shadowrocket 兼容层（TextEncoder / base64 / Object.hasOwn）
scripts/build.js                    # 组合源片段，生成三端成品
scripts/build-server.js             # 组合 src/spotify 片段，生成服务端 patcher
scripts/sync-adblock.js             # 拉取 MetaCubeX / 秋风规则并 DNS 过滤后写回 AdBlock
scripts/smoke.js                    # 成品入口冒烟测试
scripts/regression.js               # 离线协议与广告过滤回归
icon/<app>.png                      # 模块图标（120px，各 App 官方图标，模块用 raw 绝对 URL 引用）
egern/<module>/<module>.yaml        # Egern 模块
egern/<module>/js/                  # Egern 脚本（生成物）
loon/<module>/<module>.plugin       # Loon 插件
loon/<module>/js/                   # Loon 脚本（生成物）
shadowrocket/<module>/<module>.sgmodule  # Shadowrocket 模块
shadowrocket/<module>/js/           # Shadowrocket 脚本（生成物）
<platform>/spotify/spotify-mock/    # Spotify Mock 归在 spotify 目录下，与 Premium 并列
server/<service>/                   # 自建服务（Cloudflare Worker + 本机 Node）
server/<service>/src/               # 服务端代码
```

## 维护

模块全部由本仓库自行维护，不跟随上游自动同步。

YouTube、Spotify、Pluto、Tubi、AMap、Xiaohongshu、Bilibili、Delivery 与 Emby 的脚本源文件全部在 `src/`，成品由构建脚本生成：

- YouTube：`youtube.request.js`（请求阶段）、`youtube.key.js`（UMP 密钥）、`youtube.response.js`（youtubei 响应 + UMP）。
- Spotify：`spotify.js`（bootstrap / UCS / 元数据 / 远程配置）、`spotify.feed.js`（首页 / 搜索 / 滚动页）、`spotify_lyrics.js`（歌词）。歌词卡补卡时机与并行链路见 [`src/spotify/SCROLLSITA.md`](src/spotify/SCROLLSITA.md)。
- Pluto / Tubi：独立脚本同样从 `src/pluto/`、`src/tubi/` 生成，Loon / Egern 不再内嵌小火箭兼容实现。
- AMap：`src/amap/amap_clean.js` 生成三端的 `amap_clean.js`，处理开屏、首页、「我的」、消息、热词与附近推荐里的广告位。
- Xiaohongshu：`src/xiaohongshu/clean.js` 生成三端的 `xiaohongshu_clean.js`，删首页 / 搜索 / 评论广告。
- Bilibili：`src/bilibili/bilibili_clean.js`（REST 接口，含网页版推荐/搜索/相关推荐/详情/动态/番剧/直播）、`bilibili_quality.js`（画质）、`grpc/` 下的四个片段合成 `bilibili_grpc.js`（gRPC 详情页 / 评论 / 动态）。
- Delivery / Emby：单文件脚本，各自 `src/<module>/*.js` 生成三端同名成品。
- Loon 与 Egern 的成品内容完全一致；Shadowrocket 成品额外前置 `src/compat/shadowrocket.js`，只在小火箭缺少 `TextEncoder` / `TextDecoder` / `Uint8Array.fromBase64` / `toBase64` / `Object.hasOwn` 时生效。
- protobuf 的 varint 读写、字段切分与字段编码集中在 `src/proto/wire.js`；Spotify 与 YouTube 只在各自的 `core/protobuf.js` 里保留消息级封装。
- gRPC 的帧拆分、帧重组、按字段号删除、按条件过滤重复项集中在 `src/proto/grpc.js`，B 站脚本按 `head.js` + `wire.js` + `grpc.js` + `rules.js` + `entry.js` 拼接，换模块只需换 rules。
- 模块图标统一放在 `icon/`（120px PNG，取自各 App 官方图标），模块里写 raw 绝对 URL。不用 App Store 的 artwork 链接：bilibili 等 App 会换季节性图标（比如英雄联盟赛季），链接和画面都会跟着变。AdBlock、local-reflect 这类不是 App 的模块仍用 Qure 的图标。

```bash
node scripts/build.js          # 生成全部成品（含 bilibili / delivery / emby / amap 的三端同步）
node scripts/build.js --check  # 确认成品与源片段一致
node scripts/build-server.js   # 由 src/spotify 生成服务端 patcher
node scripts/build-server.js --check  # 确认 patcher 与源片段一致
node scripts/sync-adblock.js   # 同步 MetaCubeX + 秋风规则（DNS 过滤失效域名）
node scripts/smoke.js          # 所有入口冒烟
node scripts/regression.js     # 歌词入口 / Pluto / Tubi / 加密 UMP / AMap / 小红书 / B 站 gRPC 回归
(cd server/spotify-mock && npm test)  # 服务端歌词并行 / 补卡 / protobuf 回归
```

不要直接编辑 `loon/`、`egern/`、`shadowrocket/` 下的 `js/` 成品；所有脚本的源码都在 `src/`，改完跑一次 `node scripts/build.js`。

自建服务单独测试（不会访问真实 Spotify）：

```bash
cd server/spotify-mock
npm test
npm run check
```

## 来源与许可

- YouTube Enhance：原始逻辑来自 [Maasea](https://github.com/Maasea)（Apache-2.0），经 [gholts/surge](https://github.com/gholts/surge) 分发；本仓库把 4 个脚本重写并按请求阶段拆成 `js/youtube.request.js` / `youtube.key.js` / `youtube.response.js`，按 Apache-2.0 保留原版权声明并注明修改。
- BiliBili Enhance：接口路径参考社区抓包（Biliverse / app2smile），脚本与规则为本仓库重写。
- CN Video Clean：域名表参考 [blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script) 与各 App 历史抓包，本仓库整理。
- Spotify Enhance：字段号与属性/规则表来自 [whoeevee/EeveeSpotifyReborn](https://github.com/whoeevee/EeveeSpotifyReborn) 与 [skopevoj/spoti.pw](https://github.com/skopevoj/spoti.pw)（v0.21.1，GPL-3.0），本仓库重写为 Loon / Egern / Shadowrocket 脚本，按 GPL-3.0 分发。
- Spotify Mock：服务端 `src/patcher.js` 从本仓库 Spotify Enhance 脚本移植，字段号与规则表同样来自上述两个项目；Mock 服务与三端模块均按 GPL-3.0 分发。
- Tubi Clean：广告链路参考 Tubi 自家开源的 [Tubitv/TubiPlayer](https://github.com/Tubitv/TubiPlayer)（MIT）与 Tubi Web 播放器脚本，本仓库自行实现为 Loon / Egern / Shadowrocket 脚本。
- Pluto TV Clean：做法来自对 `boot.pluto.tv` 查询参数与 stitcher 会话 JWT 的实测，本仓库自行实现。
- Emby Unlock：接口路径与响应字段参考 [eggleader-zhang/Unlock-Emby-Surge](https://github.com/eggleader-zhang/Unlock-Emby-Surge)，本仓库重写为 Loon / Egern / Shadowrocket 脚本。
- AMap Clean：接口路径与字段参考社区抓包（ddgksf2013 的 `AmapAds.conf`）与 [anti-ad](https://anti-ad.net/) 的域名表，脚本与规则为本仓库重写。
- ADBlock：[blackmatrix7/ios_rule_script](https://github.com/blackmatrix7/ios_rule_script)；遥测 / 归因 / 崩溃 SDK 域名参考各 SDK 官方文档与社区抓包，本仓库整理；自动规则块来自 [MetaCubeX/meta-rules-dat](https://github.com/MetaCubeX/meta-rules-dat) 的 `category-ads-all` 与 [TG-Twilight/AWAvenue-Ads-Rule](https://github.com/TG-Twilight/AWAvenue-Ads-Rule)（秋风），每天由 GitHub Actions 同步并用 DoH 过滤失效域名。

各模块的具体来源、许可与参数说明见 `loon/` 或 `egern/` 对应目录的 `README.md`；三端的参数名与默认值一致。
