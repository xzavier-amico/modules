# YouTube Enhance — Egern 版

由 Surge 模块 [`gholts/surge → modules/youtube-enhance.sgmodule`](https://raw.githubusercontent.com/gholts/surge/refs/heads/main/modules/youtube-enhance.sgmodule)
转换的 **Egern** 模块。原始逻辑来自 Maasea 的代码（Apache-2.0）；本仓库把上游的
4 个脚本重写并合并成 `js/youtube.js` 一个文件，在 Egern 的「Surge 兼容运行模式」下执行
（`$request` / `$response` / `$done` / `$persistentStore` 原生可用），参数经
`env._compat.$argument` 注入。

## 目录结构

```
/opt/modules/egern/youtube/
├── youtube-enhance.yaml        # Egern 模块（script_url 为本仓库 GitHub raw 绝对 URL）
├── README.md                   # 本说明
├── icon/
│   └── YouTube.png             # 旧图标备份（yaml 当前使用 Koolson/Qure 的外链图标）
└── js/
    └── youtube.js              # 单文件脚本：请求 / 响应 / 密钥 / UMP 四段逻辑按 URL 分发
```

对应仓库：`xzavier-amico/modules`（分支 `master`），raw 基准 URL：

```
https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/
```

## 使用方法

1. 点下面的链接会直接唤起 Egern 导入：

   `egern:/modules/new?name=YouTube%20Enhance&url=https%3A%2F%2Fraw.githubusercontent.com%2Fxzavier-amico%2Fmodules%2Fmaster%2Fegern%2Fyoutube%2Fyoutube-enhance.yaml`

   也可以在主配置 `modules:` 中直接引用该 URL：

```yaml
modules:
  - name: "YouTube Enhance"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml"
    enabled: true
```

   （本地文件路径也同样可用；脚本 URL 已是绝对路径，无需连带托管 `js/` 目录。）

2. 模块设置页用 **开关 / 选择器 / 输入框**（`compat_arguments_schema`）调整功能；也可在主配置里覆写：

```yaml
modules:
  - url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml"
    compat_arguments:
      home_menu: "-shorts"      # 例：保留全部侧栏入口，只去掉 Shorts
```

3. HTTPS 改写需要 **安装并信任 Egern CA 证书并开启 MITM**
   （`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`music.youtube.com`、`s.youtube.com`）。

## 参数

共 12 个参数。广告、画质、首页菜单、On-the-go 都做了聚合；后台播放、PiP、On-the-go 音频/章节、热更新哈希这些不再单独给开关，脚本常开。

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

### On-the-go 与 YouTube Music

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `on_the_go` | true | 启用 On-the-go 控件；音频模式与章节按钮一并启用 |
| `youtube_music` | true | YouTube Music 增强：去广告、后台播放、PiP；关闭后 YouTube Music 的请求完全放行 |

补充说明：

- `home_menu` 支持可读别名：`home`、`shorts`、`subscriptions`/`subs`、`explore`、`trending`、`upload`、`history`、`playlists`、`library`、`watch_later`/`later`、`liked`、`music`、`downloads`，也可以直接写 `browseId`（如 `FEuploads`）。以 `-` 或 `!` 开头的项表示隐藏，其余表示保留。
- `max_height` 选 `off` 时不再改写画质；`max` 与 `4320` 当前等价（YouTube 最高 4320P），保留 `max` 是为了以后 8K 时不用改配置。
- `block_ads` 同时控制侧栏 Premium 入口、倍速菜单里的 Premium 推广，以及创作者商店/商品卡；即使 `home_menu=all`，Premium 入口仍会随 `block_ads` 隐藏。
- `background_play`、`pip`、`on_the_go_audio`、`on_the_go_chapters`、`strip_hot_hash` 已从参数表移除，脚本始终按开启处理。
- `block_members_only` 只从列表页移除会员专属视频，不会解锁播放；它按徽章文字（`会员专享` / `Members only` 等）匹配，极少数标题恰好同名的视频可能被误删。
- 脚本已重写并合并为单文件，不依赖上游脚本结构，也不跟随上游自动同步；上游若有大改动，需要人工对比后再决定是否跟进。

## 转换对照（Surge → Egern）

| Surge 语法 | Egern 语法 |
| --- | --- |
| `*.sgmodule`（INI 风格） | `*.yaml` 模块文件 |
| `#!name/#!desc/#!category` | `name / description / author`（+ `icon`、`homepage` 等元数据） |
| `#!arguments` / `#!arguments-desc` | `compat_arguments` / `compat_arguments_desc` |
| 设置页 UI | `compat_arguments_schema`（开关 / 选择器 / 输入框），主配置 `compat_arguments` 覆写 |
| `#!requirement=SYSTEM = 'iOS'` | 无对应能力；Egern 本身仅 iOS，语义恒成立 |
| `[Script] type=http-request|http-response` | `scriptings[].http_request / http_response` |
| `pattern=` | `match` |
| `script-path=` | `script_url` |
| `requires-body=1` / `binary-body-mode=1` | `body_required: true` / `binary_body: true` |
| `max-size=-1`（不限制） | `max_size: 33554432`（32 MiB 显式值；官方未定义 0 的语义，默认 1 MiB 会截断大响应体） |
| `argument="{"flag":...}"` | `env._compat.$argument: '<原样 JSON + 三花括号占位符>'` |
| `$request/$response/$done/$persistentStore/$argument` | Egern 脚本兼容运行模式原生可用（无需包装/转换） |
| `engine=jsc` / `engine=webview` | 无对应（Egern 单一运行时，脚本只用纯 JS + 标准流/压缩 API） |
| `#!REQUIREMENT "'{...}' == 'true'"`（按参数条件启用） | 无等价能力；`request.js` 内部本就按 `autoHd` 自行判断，脚本常开无副作用 |
| `[URL Rewrite] - reject` | `rewrites[].actions[].respond: {status: 404}` |
| `[MITM] hostname = %APPEND% ...` | `mitm.hostnames.includes` |

## 已知差异与注意事项

- **超时**：`youtube.enhance.response` / `youtube.enhance.ump` 较重（响应体大、AES/SHA256+gzip），
  yaml 已分别给 `timeout: 60`；其余条目 `timeout: 30`。若设备仍超时，可继续调大（上限 600）。
  response.js 对超大响应体（>5 MiB，如「我的」页 History 列表）会直接放行以避免超时。
- **max_size 的语义与内部上限**：官方文档只说默认 `1048576`（1 MiB），**未定义 `0` 的含义**。
  经验上，body 超限不会报错，只会"不传给脚本"→ 脚本按放行处理（UMP/键协商静默跳过）。
  若日志出现「exceeded N bytes」类提示：N 若恰为 `1048576` 即说明写 0 回落了默认 1 MiB；
  本模块已显式给 32 MiB，若 N 变成了这个自定义值，
  说明引擎接受大值；若 N 是另一个固定数字，说明引擎层还有更硬的内部上限——届时只能降级：
  大体积请求会原样放行（不影响播放，只是该视频的 4x/自动 HD 那轮不生效）。
  可根据日志再评估是否调更高（如 67108864）。
- **脚本托管**：3 条 `script_url` 使用本仓库 GitHub raw 绝对 URL，在任何设备上导入 yaml
  都能直接拉到脚本；`icon` 使用 Koolson/Qure 的彩色图标外链。本地化使用时可按需换回相对路径 `js/youtube.js`。
- **持久化共享**：脚本在 `config`/`log_event` 响应里写入 `YouTubeConfig`（client/encrypt 密钥），
  在 `initplayback` 响应里读取它解密 UMP；两者在同一条链路上，正常触发时互相配合。
- **拒绝模式**：Egern `rewrites → respond 404` 等价 Surge 的空响应 reject；如需和应用层
  完全一致可改为 200（`respond: {status: 200}`）。
- **功能范围**：保留 gholts 原版模块的全部功能（去广告、后台播放、PiP、
  最高 4x 倍速、On-the-go 控件），并新增字幕翻译与 YouTube Music 增强；
  后台播放、PiP、On-the-go 音频/章节、热更新哈希改为常开，不再单独设开关。
- **静态改写**：`rewrites` 中的 `pagead/pcs` 与 `stats/ads` 两条 404 规则无法按参数
  条件启用；即使关闭 `block_ads`，这两条规则仍会生效（响应体内的广告位不会再改）。
- **参数兼容**：Loon 以对象（或位置数组）传入 snake_case 参数，Egern 以 JSON 字符串传入
  camelCase 参数；脚本入口会统一映射，两侧共用同一份 `js/youtube.js`。

## 「我的」页路由说明

早期转换版曾把 `guide` / `account/get_setting` 从 `match` 里摘掉来规避「我的」页打不开的问题。
现在响应阶段是一条 match 覆盖全部路由，脚本对这两条路由分别做侧栏入口隐藏和后台播放强制开启；
如果日后「我的」页再次异常，先确认这条路由的响应是否被脚本改写坏：
临时把 `response` 规则注释掉，看页面能否恢复，再决定要修哪个分支。

## 排障（exec timeout / 不生效）

1. 脚本不再打日志，排障时先缩小范围：把 `response` 规则临时注释掉，只留 `request`，
   看问题是否还在；再反过来单独启用 `response`。哪半边出问题就查对应分支。
2. 若超时条目是 `youtube.enhance.ump`：多为大视频 + 慢设备（AES/SHA256 纯 JS 计算慢），
   调大 `timeout`；若首次出现 `YouTubeConfig requires a valid stored clientKey`，
   属正常——先播放一次让 `key.js` 抓到密钥，之后 UMP 解密才会生效。
3. 若所有条目超时：确认模块是否启用了 MITM（证书已安装且信任、`mitm.hostnames` 生效）。

## 许可

- 原始模块与脚本：基于 Maasea 的代码（**Apache-2.0**），来自 [gholts/surge](https://github.com/gholts/surge)。
  本仓库对脚本做了重写与合并（逻辑等价、变量重命名、去掉上游的自动补丁链路），
  按 Apache-2.0 保留原版权声明并注明修改；许可证全文见上游仓库。
- 内联的 `@noble/ciphers`、`@noble/hashes` 为 MIT 许可，版权与许可声明保留在
  `js/youtube.js` 的 UMP 段开头。
- YAML/文档延续上游许可。
