# YouTube Enhance — Loon 插件

**Loon** 插件：屏蔽广告、字幕翻译、YouTube Music 去广告与后台播放、默认分辨率、首页菜单与 Shorts 过滤。脚本按请求阶段拆成 `js/youtube.request.js`（请求改写）、`js/youtube.key.js`（UMP 密钥提取）、`js/youtube.response.js`（youtubei 响应 + UMP），Loon 与 Egern 共用同一份代码。

脚本在参数入口做了兼容处理：Loon 传入的 snake_case 对象（或位置数组）会自动映射为 camelCase 键，Egern 传入的 JSON 字符串同样兼容。

## 安装

点下面的链接会直接唤起 Loon 导入：

`https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fyoutube%2Fyoutube-enhance.plugin`

也可以手动在 Loon → 插件 → `+` → 从 URL 导入，粘贴：

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/youtube/youtube-enhance.plugin`

需要开启 MitM（`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`music.youtube.com`、`s.youtube.com`）。

## 参数

共 11 个参数，均可在插件设置页调整。广告、画质、首页菜单都做了聚合；后台播放、PiP、热更新哈希不再单独给开关，脚本常开。

### 广告与 AI

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 一次关掉播放器广告、信息流广告、Shorts 广告、付费推广、广告追踪转化、Premium 推广与创作者商店/商品卡 |
| `block_ai` | true | 移除 Ask、AI 摘要及相关控件 |

### 画质、字幕与播放器

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `max_height` | max | 默认分辨率：`max`（最高可用）/ `4320` / `2160` / `1440` / `1080` / `720` / `480` / `off`（不修改画质） |
| `caption_lang` | zh-Hans | 字幕默认翻译语言，使用 Google 语言代码；`off` 关闭字幕翻译 |
| `max_speed` | 4 | 最大播放倍速，可选 `4` / `3` / `2` / `off` |
| `jump_ahead` | true | 启用播放器中的 Jump Ahead 快进按钮 |

### 首页与菜单

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `home_menu` | 空 | 首页/侧栏菜单保留项（多选，逗号分隔）。留空=旧默认（仅隐藏上传）；`all`=全部保留；`none`=全部隐藏；`-shorts`=保留全部但隐藏 Shorts；`upload,shorts`=只保留这两项 |
| `block_shorts_feed` | false | 移除首页、搜索和推荐信息流中的 Shorts 推荐货架 |
| `home_cleanup` | standard | 首页内容清理：`standard`=Playables；`all`=再加竖屏直播；`off`=不清理 |
| `block_members_only` | false | 从首页、频道页等列表中移除需要频道会员才能观看的视频 |

### YouTube Music

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `youtube_music` | true | YouTube Music 增强：去广告、后台播放、PiP；关闭后 YouTube Music 的请求完全放行 |

## 注意事项

- `home_menu` 支持可读别名：`home`、`shorts`、`subscriptions`/`subs`、`explore`、`trending`、`upload`、`history`、`playlists`、`library`、`watch_later`/`later`、`liked`、`music`、`downloads`，也可以直接写 `browseId`（如 `FEuploads`）。以 `-` 或 `!` 开头的项表示隐藏，其余表示保留。
- `max_height` 选 `off` 时不再改写画质；`max` 与 `4320` 当前等价（YouTube 最高 4320P），保留 `max` 是为了以后 8K 时不用改配置。
- `block_ads` 同时控制侧栏 Premium 入口、倍速菜单里的 Premium 推广，以及创作者商店/商品卡；即使 `home_menu=all`，Premium 入口仍会随 `block_ads` 隐藏。
- `background_play`、`pip`、`strip_hot_hash` 已从参数表移除，脚本始终按开启处理。
- On-the-go 依赖 YouTube Premium 的服务端校验，注入的入口点开仍会提示开通 Premium，已整体移除；`jump_ahead` 与原生章节显示不受影响。
- `block_members_only` 只从列表页（首页、频道页、Shorts 货架）中移除会员专属视频，不会解锁播放；它按徽章文字（`会员专享` / `Members only` 等）匹配，极少数标题恰好同名的视频可能被误删。
- `[Rewrite]` 中的 `pagead/pcs` 与 `stats/ads` 两条 404 规则无法按参数条件启用；即使关闭 `block_ads`，这两条静态规则仍会生效（响应体内的广告位不会再改）。
- 脚本按请求阶段拆分，独立维护，不自动同步外部改动；外部实现若有变化，需要人工对比后再决定是否跟进。
- `[Rule]` 里对 `googlevideo.com`、`youtube.com`、`youtubei.googleapis.com` 的 QUIC 直接 REJECT，强制客户端回落 TCP；HTTP/3 走 UDP 不经过代理，不拒绝时 `ad_break` / `player` 请求脚本完全看不到。日志里没有脚本记录时先查这一项。
