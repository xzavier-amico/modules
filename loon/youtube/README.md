# YouTube Enhance — Loon 插件

**Loon** 插件：屏蔽广告、字幕翻译、YouTube Music 去广告与后台播放、默认分辨率、首页菜单、Shorts 与新闻/图文推荐过滤；支持 www / m / YouTube Music 网页版。脚本按请求阶段拆成 `js/youtube.request.js`（请求改写）、`js/youtube.key.js`（UMP 密钥提取）、`js/youtube.response.js`（youtubei 响应 + UMP），Loon 与 Egern 共用同一份代码。

脚本在参数入口做了兼容处理：Loon 传入的 snake_case 对象（或位置数组）会自动映射为 camelCase 键，Egern 传入的 JSON 字符串同样兼容。

## 安装

点下面的链接会直接唤起 Loon 导入：

`https://www.nsloon.com/openloon/import?plugin=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Floon%2Fyoutube%2Fyoutube-enhance.plugin`

也可以手动在 Loon → 插件 → `+` → 从 URL 导入，粘贴：

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/youtube/youtube-enhance.plugin`

需要开启 MitM（`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`m.youtube.com`、`music.youtube.com`、`s.youtube.com`）。

## 参数

共 21 个参数，均可在插件设置页调整。广告、画质、首页菜单、播放器 / 信息流 / 播放页清理都做了聚合；后台播放、PiP、热更新哈希不再单独给开关，脚本常开。

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
| `player_cleanup` | off | 播放器清理：`standard`=去掉播放结束推荐墙 + 信息卡（网页版）；`all`=再关闭自动播放下一首（三端） |
| `captions_mode` | keep | 字幕开关：`keep`=保持现状；`off`=去掉自动生成（ASR）字幕且不自动开启；`force`=强制开启字幕（`caption_lang` 选翻译时以翻译轨为准） |
| `video_codec` | any | 编码偏好：`any`=不改；`no_av1`=去掉 AV1；`avc`=只留 H.264。原生端通过画质缓存生效 |

### 首页与菜单

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `home_menu` | 空 | 首页/侧栏菜单保留项（多选，逗号分隔）。留空=旧默认（仅隐藏上传）；`all`=全部保留；`none`=全部隐藏；`-shorts`=保留全部但隐藏 Shorts；`upload,shorts`=只保留这两项 |
| `block_shorts_feed` | false | 移除首页、搜索和推荐信息流中的 Shorts 货架，以及混在推荐流里的单个 Shorts 卡片 |
| `block_feed_cards` | false | 移除推荐流里的新闻、社区图文帖子等非视频卡片（按版式名 / element 标识判断，不看标题文案） |
| `home_cleanup` | standard | 首页内容清理：`standard`=Playables；`all`=再加竖屏直播；`off`=不清理 |
| `block_members_only` | false | 从首页、频道页等列表中移除需要频道会员才能观看的视频 |
| `feed_cleanup` | off | 信息流清理（网页版）：`standard`=去掉「继续观看」卡片与顶部筛选条；`all`=再去掉直播 / 首映卡片 |
| `watch_cleanup` | off | 播放页清理：`comments`=去掉评论区；`all`=再去掉相关视频（原生端为播放器相关浮层） |
| `web_cleanup` | false | 网页版隐藏 Create / 通知 / 上传等顶部按钮 |

### YouTube Music

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `youtube_music` | true | YouTube Music 增强：去广告、后台播放、PiP；关闭后 YouTube Music 的请求完全放行 |
| `web` | true | 支持网页版：处理 `www.youtube.com` / `m.youtube.com` / `music.youtube.com` 的 youtubei JSON 响应；关闭后网页版请求完全放行 |
| `music_cleanup` | false | 网页版 YouTube Music 只保留最高码率音频格式 |
| `probe` | off | 排障日志：`off` 关闭；`on` 打印每张卡片的字段号、`.eml` 版式名、内部标识、有没有视频 id；`full` 再打卡片开头 120 字节 hex。排查「某类卡片没被删掉」时临时打开 |

## 注意事项

- `home_menu` 支持可读别名：`home`、`shorts`、`subscriptions`/`subs`、`explore`、`trending`、`upload`、`history`、`playlists`、`library`、`watch_later`/`later`、`liked`、`music`、`downloads`，也可以直接写 `browseId`（如 `FEuploads`）。以 `-` 或 `!` 开头的项表示隐藏，其余表示保留。
- `max_height` 选 `off` 时不再改写画质；`max` 与 `4320` 当前等价（YouTube 最高 4320P），保留 `max` 是为了以后 8K 时不用改配置。
- `block_ads` 同时控制侧栏 Premium 入口、倍速菜单里的 Premium 推广，以及创作者商店/商品卡；即使 `home_menu=all`，Premium 入口仍会随 `block_ads` 隐藏。
- `background_play`、`pip`、`strip_hot_hash` 已从参数表移除，脚本始终按开启处理。
- On-the-go 依赖 YouTube Premium 的服务端校验，注入的入口点开仍会提示开通 Premium，已整体移除；`jump_ahead` 与原生章节显示不受影响。
- `block_members_only` 只从列表页（首页、频道页、Shorts 货架）中移除会员专属视频，不会解锁播放；网页版按徽章的 `BADGE_STYLE_TYPE_MEMBERS_ONLY` 枚举判定，和界面语言无关；原生 App 的 protobuf 里只有本地化徽章文字，脚本按 `会员专享` / `Members only` / 日文 / 韩文等几种文案精确匹配，其他语言会漏判，标题恰好同名的视频也可能被误删。
- `block_feed_cards` 认的是版式名和 element 标识（如 `post_shelf` / `news_story` 这类内部资源名），不按「重大新闻」等标题文案判断：文案会随界面语言变化，也会误删恰好叫这个名字的普通视频或货架。货架里的卡片被删空后整块货架会一起消失。
- `[Rewrite]` 中的 `pagead/pcs` 与 `stats/ads` 两条 404 规则无法按参数条件启用；即使关闭 `block_ads`，这两条静态规则仍会生效（响应体内的广告位不会再改）。
- 网页版响应是 JSON，脚本走单独的保守过滤：只删已知广告 renderer、播放器广告字段、Shorts 货架、新闻/图文卡片、会员专属视频与 AI/商店控件；卡片被包在 `richItemRenderer` 里时连包装一起删，不会留下空白卡片位；画质只裁剪 `streamingData.adaptiveFormats`，不改渐进式 `formats` 和音频。
- 网页版不处理网页 HTML 本身，也不改直播聊天 / 弹幕；网页播放页如果某些广告只在 HTML 里，脚本看不到。
- 脚本按请求阶段拆分，独立维护，不自动同步外部改动；外部实现若有变化，需要人工对比后再决定是否跟进。
- 三端都生效的：`captions_mode`、`video_codec`、`watch_cleanup`（评论区按 `comment-item-section` 标识、相关视频按播放器浮层字段）。
- 只有网页版生效的：`player_cleanup` 的结束推荐墙与信息卡、`feed_cleanup` 的筛选条 / 直播卡片、`web_cleanup`、`music_cleanup`。原生 App 的 player 响应里这几处没有建模字段，脚本不去猜字段号，宁可不动数据；`player_cleanup=all` 在原生端仍会关掉自动播放下一首（`NextResult` 3 号字段）。
- 打开 `probe` 后日志形如 `[YT probe] richItemContents fields=[153515154] keys=[videoWithContextRenderer] eml=[…] ids=[…]`（原生 App）或 `[YT probe] contents -> richItemRenderer.content.postRenderer`（网页版）；脚本只读不改，看完记得关掉。
- `captions_mode=off` 认的是 `kind=asr` 与 `vssId=a.*`，`force` 会同时把音轨的 `captionsInitialState` 置为开启；两者都不看界面语言。
- 不做 SponsorBlock 自动跳过：原生 App 的跳段必须由客户端 seek，MITM 只能改响应数据，控制不了播放进度；uYou+ / iSponsorBlock 都是 hook `YTPlayerViewController` 实现的。网页版理论上可以在 watch 页 HTML 里注入脚本，但要额外处理 CSP nonce 与 SPA 导航，暂未实现。
- `[Rule]` 里对 `googlevideo.com`、`youtube.com`、`youtubei.googleapis.com` 的 QUIC 直接 REJECT，强制客户端回落 TCP；HTTP/3 走 UDP 不经过代理，不拒绝时 `ad_break` / `player` 请求脚本完全看不到。日志里没有脚本记录时先查这一项。
