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

3. 模块设置页用 **Toggle 开关**（`compat_arguments_schema`）调整功能；也可在主配置里覆写：

```yaml
modules:
  - url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/youtube/youtube-enhance.yaml"
    compat_arguments:
      block_shorts: "true"      # 例：连 Shorts 标签一起去掉
```

4. HTTPS 改写需要 **安装并信任 Egern CA 证书并开启 MITM**
   （`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`s.youtube.com`）。

## 参数（与 Surge `#!arguments` 一一对应）

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_upload` | true | 移除「上传」标签 |
| `block_shorts` | false | 移除 Shorts 标签 |
| `auto_hd` | true | 优先最高分辨率（授权 Premium 时用高码率） |
| `block_games` | true | 移除首页 Playables |
| `block_vertical_live` | false | 移除首页竖屏直播 |
| `jump_ahead` | true | 启用 Jump Ahead 按钮 |
| `block_store` | true | 移除创作者商店/商品卡/悬浮层 |
| `block_ai` | true | 移除 Ask、AI 摘要等控件 |
| `on_the_go` | true | 启用 On-the-go 控件 |

## 转换对照（Surge → Egern）

| Surge 语法 | Egern 语法 |
| --- | --- |
| `*.sgmodule`（INI 风格） | `*.yaml` 模块文件 |
| `#!name/#!desc/#!category` | `name / description / author`（+ `icon`、`homepage` 等元数据） |
| `#!arguments` / `#!arguments-desc` | `compat_arguments` / `compat_arguments_desc` |
| 设置页 UI | `compat_arguments_schema`（Toggle 开关），主配置 `compat_arguments` 覆写 |
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

- **超时**：`youtube.enhance.ump` 需在纯 JS 里对最多 16 MiB 数据做 AES+SHA256+gzip，
  属天然重负载；yaml 已给 `timeout: 30`。若设备较慢仍超时，可继续调大（上限 600）。
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
- **功能范围**：本模块严格按 gholts 原版模块的功能面转换（去广告、后台播放、PiP、
  最高 4x 倍速、On-the-go 控件），未额外添加其他平台版本中的附加 feature。

## 「我的」页打不开 —— 路由级修复（进行中）

**症状**：使用 gholts 原版脚本时，YouTube 底栏「我的/You」页面打不开（其他页面正常）。

**定位假设**：「我的」页流量命中 `youtube.enhance.response` 的 `guide` 与
`account/get_setting` 两条路由；response.js 对这两类响应的改写不兼容（Surge 与 Egern
兼容层的运行时差异放大了这一点）。

**已做处理**（yaml 注释中保留了原版 match，随时可加回）：

1. 从 response 的 `match` 中暂时摘除 `guide|account/get_setting` 两条路由。
   该两路由只承担「引导栏 / 账户页的 AI、商店过滤」，摘除后仅这几个页面失去过滤效果，
   首页/搜索/播放页/列表秒杀均不受影响。
2. 重新导入模块确认「我的」页恢复；日志中不再出现与 guide/account 相关的
   `YouTube response:` 报错即可确认。

**如何加回**：把 yaml 中 response 的 `match` 换成注释里的原版表达式：

```regex
^https://youtubei\.googleapis\.com/youtubei/v1/(?:navigation/resolve_url|browse|next|player|search|reel/reel_watch_sequence|guide|account/get_setting|get_watch)(?:\?.*)?$
```

**逐条回加定位**（若加回后再次复发）：

1. 先只加 `|guide` → 打开「我的」页；有问题则元凶是 guide 路由。
2. 再加 `|account/get_setting` → 复发则元凶是该路由。
3. 复发时抓取 Egern 日志中相应请求前后的 `YouTube response:` / `YouTube On-the-go:` 行，
   可精确定位到 response.js 里处理该分支的具体函数。

**若确认是脚本级不兼容**：由本仓库自行修补 `js/response.js` 对应分支
（按第 3 步日志定位到的具体函数做兼容修正，如对 Surge/Egern 运行时差异做防御性
判断），并恢复两条被摘除的路由；修好后回加 `|guide` / `|account/get_setting` 即可。

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
