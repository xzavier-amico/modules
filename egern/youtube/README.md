# YouTube Enhance — Egern 版

由 Surge 模块 [`gholts/surge → modules/youtube-enhance.sgmodule`](https://raw.githubusercontent.com/gholts/surge/refs/heads/main/modules/youtube-enhance.sgmodule)
转换的 **Egern** 模块。转换思路：**直接在 Egern 的「Surge 兼容运行模式」下执行
Surge 原版脚本**（`$request` / `$response` / `$done` / `$persistentStore` 原生可用），
参数经 `env._compat.$argument` 注入，无需任何脚本包装。

## 目录结构

```
/opt/modules/egern/youtube/
├── youtube-enhance.yaml        # Egern 模块（script_url 为本仓库 GitHub raw 绝对 URL）
├── README.md                   # 本说明
├── icon/
│   └── YouTube.png             # 模块图标（yaml 中 icon 用其本仓库 raw URL）
└── js/
    ├── request.js              # Surge 原版脚本（ad-break / init / auto-hd / log-event 共用）
    ├── response.js             # 响应改写（browse/next/player 等）
    ├── key.js                  # config/log_event 响应 → 提取 client/encrypt 密钥
    └── ump.js                  # initplayback UMP 解密/改写（AES+SHA256+gzip，较重）
```

对应仓库：`xzavier-amico/modules`（分支 `master`），raw 基准 URL：

```
https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/
```

## 使用方法

1. 模块已托管在 GitHub raw，在 Egern 主配置 `modules:` 中直接引用该 URL：

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
      block_shorts: "true"      # 例：连 Shorts 标签一起去掉
```

3. HTTPS 改写需要 **安装并信任 Egern CA 证书并开启 MITM**
   （`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`s.youtube.com`）。

## 参数

原有 9 个参数与上游 `#!arguments` 一一对应；其余 17 个参数是把上游脚本中原本硬编码的行为提取出来的开关。所有默认值都保持原版行为，升级无感。

### 界面与内容

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_upload` | true | 移除侧栏中的「上传」入口 |
| `block_shorts` | false | 移除侧栏中的 Shorts 入口 |
| `block_shorts_feed` | false | 移除首页列表中的 Shorts 推荐货架 |
| `block_members_only` | false | 移除信息流中需要频道会员才能观看的视频 |
| `block_games` | true | 移除首页 Playables（小游戏） |
| `block_vertical_live` | false | 移除首页竖屏直播 |
| `block_store` | true | 移除创作者商店、商品卡片与相关悬浮层 |
| `block_ai` | true | 移除 Ask、AI 摘要及相关控件 |
| `jump_ahead` | true | 启用播放器中的 Jump Ahead 快进按钮 |
| `hide_premium` | true | 隐藏侧栏 Premium 入口和倍速菜单中的 Premium 推广 |
| `block_guide_items` | 空 | 额外隐藏的侧栏入口 `browseId`，多个用英文逗号分隔（如 `FEuploads,FEshorts`） |

### 播放与画质

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `auto_hd` | true | 优先选择可用的最高分辨率；已授权 Premium 时使用高码率 |
| `prefer_premium` | true | 自动高清时若有 Premium 高码率版本则优先使用 |
| `max_height` | 4320 | 自动高清允许的最高分辨率高度，可选 4320 / 2160 / 1440 / 1080 / 720 / 480 |
| `max_speed` | 4 | 最大播放倍速，可选 4 / 3 / 2 / off；`off` 表示不修改倍速数值与上限 |
| `background_play` | true | 启用后台播放，并在设置页强制打开后台播放 |
| `pip` | true | 启用画中画（PiP） |

### 广告与追踪

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_player_ads` | true | 移除播放器广告位，并让 `ad_break` 返回空响应 |
| `block_feed_ads` | true | 移除首页、搜索和推荐信息流中的广告卡片 |
| `block_shorts_ads` | true | 移除 Shorts 列表中的广告条目 |
| `remove_paid_promotion` | true | 移除播放器响应中的付费推广与推广内容字段 |
| `block_ad_tracking` | true | 移除播放跟踪中的广告转化字段 |
| `strip_hot_hash` | true | 移除 `log_event` 中的 `x-youtube-hot-hash-data` 响应头，避免热更新配置覆盖 |

### On-the-go

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `on_the_go` | true | 启用 On-the-go 控件总开关 |
| `on_the_go_audio` | true | 在 On-the-go 控件中加入音频模式切换按钮 |
| `on_the_go_chapters` | true | 在 On-the-go 控件中加入章节按钮 |

补充说明：

- `max_height`、`prefer_premium` 只在 `auto_hd` 开启时生效。
- `on_the_go_audio`、`on_the_go_chapters` 只在 `on_the_go` 开启时生效。
- `block_guide_items` 接收 YouTube 侧栏项对应的 `browseId`（例如 `FEuploads`、`FEshorts`）。它用于补充隐藏 `block_games` / `block_store` 等开关没有覆盖的侧栏入口。
- `block_shorts` 只移除侧栏的 Shorts 入口，不会清理首页列表；要移除首页等信息流中的 Shorts 推荐货架，请打开 `block_shorts_feed`。
- `block_members_only` 只从信息流中移除会员专属视频，不会解锁播放；它按徽章文字（`会员专享` / `Members only` 等）匹配，极少数标题恰好同名的视频可能被误删。
- 这些参数由 `scripts/patch_youtube.py` 在上游脚本基础上打补丁实现；补丁采用精确匹配并带断言，上游脚本结构变化时会失败并保留旧脚本。

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
- **脚本托管**：全部 `script_url`（及 `icon`）均使用本仓库 GitHub raw 绝对 URL，
  在任何设备上导入 yaml 都能直接拉到脚本；本地化使用时可按需换回相对路径 `js/*.js`。
- **持久化共享**：`key.js` 写入 `YouTubeConfig`，`ump.js` 读取用于解密；二者都在
  `youtubei.googleapis.com`/`googlevideo.com` 请求链路上正常触发时互相配合，请勿单独禁用。
- **拒绝模式**：Egern `rewrites → respond 404` 等价 Surge 的空响应 reject；如需和应用层
  完全一致可改为 200（`respond: {status: 200}`）。
- **功能范围**：保留 gholts 原版模块的全部功能（去广告、后台播放、PiP、
  最高 4x 倍速、On-the-go 控件）；同时把原脚本中硬编码的行为提取为参数，
  所有新增参数默认开启或保持原值，升级后行为与原版一致。
- **静态改写**：`rewrites` 中的 `pagead/pcs` 与 `stats/ads` 两条 404 规则无法按参数
  条件启用；即使关闭 `block_player_ads` / `block_ad_tracking`，这两条规则仍会生效。
- **参数兼容**：Loon 以对象形式传入 snake_case 参数，Egern 以 JSON 字符串传入
  camelCase 参数；脚本入口会统一映射，两侧共用同一份 `js/` 代码。

## 「我的」页 —— 路由 A/B 测试（当前：全量版测试中）

**历史症状**：早期版本（response 全量 match）下，YouTube 底栏「我的/You」页面打不开
（其他页面正常）。

**[B] 缩窄版 —— 已验证可用**：从 response 的 `match` 摘除
`guide|account/get_setting` 两条路由后，「我的」页、主页、后台播放均正常，
但依赖这两条路由的过滤效果（隐藏上传 tab 等）失效。缩窄版 match 完整保留在
yaml 注释中，如需回退，替换一行即可。

**[A] 全量版 —— 当前发布，测试中**：恢复原版全量 match（保留原版全部功能），
验证「我的」页与全量路由是否共存。早期打不开也可能由当时其他因素引起
（脚本取回失败 / max_size 截断 / 首次运行缺密钥），当时均已一并修复，故值得重测。

**若 [A] 复发的逐条定位路径**：

1. 先只加 `|guide`（其余不变）→ 打开「我的」页；有问题则元凶是 guide 路由。
2. 再加 `|account/get_setting` → 复发则元凶是该路由。
3. 复发时抓取 Egern 日志中相应请求前后的 `YouTube response:` / `YouTube On-the-go:` 行，
   定位 response.js 处理该分支的具体函数。

**若确认是脚本级不兼容**：由本仓库自行修补 `js/response.js` 对应分支
（对 Surge/Egern 运行时差异做防御性修正），修好后恢复全量 match 或按需逐条回加。

## 排障（exec timeout / 不生效）

1. Egern 日志里原版脚本的输出会原样透出，按前缀定位：
   - `YouTube request: ...`（request.js 异常）
   - `YouTube response: ...` / `YouTube On-the-go: ...`（response.js）
   - `YouTube keys: ...` / `YouTube key write failed`（key.js）
   - `YouTube quality ...` / `UMP ...`（ump.js）
2. 若超时条目是 `youtube.enhance.ump`：多为大视频 + 慢设备（AES/SHA256 纯 JS 计算慢），
   调大 `timeout`；若首次出现 `YouTubeConfig requires a valid stored clientKey`，
   属正常——先播放一次让 `key.js` 抓到密钥，之后 UMP 解密才会生效。
3. 若所有条目超时：确认模块是否启用了 MITM（证书已安装且信任、`mitm.hostnames` 生效）。

## 许可

- 原始模块与脚本：基于 Maasea 的代码（**Apache-2.0**），来自 [gholts/surge](https://github.com/gholts/surge)。
- YAML/文档仅做格式转换，延续上游许可。
