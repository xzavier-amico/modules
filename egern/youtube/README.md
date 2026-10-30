# YouTube Enhance — Egern 版

由 Surge 模块 [`gholts/surge → modules/youtube-enhance.sgmodule`](https://raw.githubusercontent.com/gholts/surge/refs/heads/main/modules/youtube-enhance.sgmodule)
转换的 **Egern** 模块。转换采用与 [IBL3ND 的 Egern-YouTube.yaml](https://github.com/Yuanxsxs/QtumultX)
一致、经过验证的范式：**Egern 的「Surge 兼容运行模式」直接执行 Surge 原版脚本**，
参数经 `env._compat.$argument` 注入，无需任何脚本包装。

## 目录结构

```
/opt/modules/egern/youtube/
├── youtube-enhance.yaml        # Egern 模块（script_url 用 js/ 下相对路径）
├── README.md                   # 本说明
├── icon/
│   └── YouTube.png             # 模块图标本地备份（yaml 中 icon 用其 GitHub raw URL）
└── js/
    ├── request.js              # Surge 原版脚本（ad-break / init / auto-hd / log-event 共用）
    ├── response.js             # 响应改写（browse/next/player 等）
    ├── key.js                  # config/log_event 响应 → 提取 client/encrypt 密钥
    └── ump.js                  # initplayback UMP 解密/改写（AES+SHA256+gzip，较重）
```

## 使用方法

1. 把整个 `youtube/` 目录放到能被 Egern 读取的位置（或托管到 https 服务器）。
2. 在 Egern 主配置 `modules:` 中引用：

```yaml
modules:
  - name: "YouTube Enhance"
    url: "<路径或URL>/youtube-enhance.yaml"   # 本地文件路径或远程 https URL
    enabled: true
```

3. 模块设置页用 **Toggle 开关**（`compat_arguments_schema`）调整功能；也可在主配置里覆写：

```yaml
modules:
  - url: "<路径或URL>/youtube-enhance.yaml"
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
  若日志出现「exceeded N bytes」类提示：N 若恰为 `1048576` 即说明写 0 回落了默认 1 MiB
  （IBL3ND 的 `max_size: 0` 也是这种写法）；本模块已显式给 32 MiB，若 N 变成了这个自定义值，
  说明引擎接受大值；若 N 是另一个固定数字，说明引擎层还有更硬的内部上限——届时只能降级：
  大体积请求会原样放行（不影响播放，只是该视频的 4x/自动 HD 那轮不生效）。
  可根据日志再评估是否调更高（如 67108864）。
- **远端托管**：`script_url` 目前为相对路径 `js/*.js`，适合按目录导入；若远程托管，
  请把 yaml 各处 `script_url` 换成绝对 URL（例如原始仓库
  `https://raw.githubusercontent.com/gholts/surge/main/scripts/youtube/request.js`）。
- **持久化共享**：`key.js` 写入 `YouTubeConfig`，`ump.js` 读取用于解密；二者都在
  `youtubei.googleapis.com`/`googlevideo.com` 请求链路上正常触发时互相配合，请勿单独禁用。
- **拒绝模式**：Egern `rewrites → respond 404` 等价 Surge 的空响应 reject；如需和应用层
  完全一致可改为 200（`respond: {status: 200}`）。
- **上游特性差异**：IBL3ND 版在 gholts 版基础上额外加了「原生下载」「字幕双显」等功能；
  本模块严格按 gholts 原版功能面转换，不含那些附加项（可通过其对应模块单独叠加）。

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
