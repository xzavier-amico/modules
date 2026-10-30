# YouTube Enhance — Egern 版

由 Surge 模块 [`gholts/surge → modules/youtube-enhance.sgmodule`](https://raw.githubusercontent.com/gholts/surge/refs/heads/main/modules/youtube-enhance.sgmodule)
转换而成的 **Egern** 模块；原始 JS 与适配后的 Egern 脚本统一存放在 `js/` 子目录。

## 目录结构

```
/opt/modules/egern/youtube/
├── youtube-enhance.yaml        # Egern 模块（引用主对应文件，script_url 指向 js/ 下的相对路径）
├── README.md                   # 本说明
├── build_adapters.py           # 适配器生成器（升级原版脚本后重跑 python3 build_adapters.py）
└── js/
    ├── request.js              # Surge 原版脚本（保留备查，勿改）
    ├── response.js
    ├── key.js
    ├── ump.js
    ├── request.egern.js        # Egern 适配脚本（模块实际引用；由 build_adapters.py 生成）
    ├── response.egern.js
    ├── key.egern.js
    └── ump.egern.js
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

3. 在模块设置页用 **Toggle 开关**（来自 `compat_arguments_schema`）调整各功能；
   也可在主配置里覆盖默认参数：

```yaml
modules:
  - url: "<路径或URL>/youtube-enhance.yaml"
    compat_arguments:
      block_shorts: "true"      # 例：连 Shorts 标签一起去掉
```

4. HTTPS 改写需要 **安装并信任 Egern CA 证书且开启 MITM**（覆盖以下主机：
   `*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`s.youtube.com`）。

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
| `#!name/#!desc/#!category` | `name / description / author`（+ `icon`、`homepage` 等） |
| `#!arguments` / `#!arguments-desc` | `compat_arguments` / `compat_arguments_desc`（默认值经 `{{{参数}}}` 注入各脚本 env） |
| （无 UI） | `compat_arguments_schema`（设置页 Toggle 开关） |
| `#!requirement=SYSTEM = 'iOS'` | 无对应能力；Egern 本身仅 iOS，语义恒成立 |
| `[Script] type=http-request|http-response` | `scriptings[].http_request / http_response` |
| `pattern=` | `match` |
| `script-path=` | `script_url` |
| `requires-body=1` / `binary-body-mode=1` | `body_required: true` / `binary_body: true` |
| `max-size=-1`（无限制） | `max_size: 33554432`（32 MiB，大于 Egern 默认 1 MiB） |
| `engine=jsc` / `engine=webview` | 无对应（同一 JS 运行时）；需 polyfill 的 API 已在适配层补齐 |
| `argument="{"flag":...}"` | `script env` 注入；适配脚本重建为 `$argument` JSON |
| `$request / $response / $done / $persistentStore / $argument` | `ctx.request / ctx.response / 返回值 / ctx.storage / ctx.env`（适配层 1:1 模拟） |
| `#!REQUIREMENT "'{{{auto_hd}}}' == 'true'"` | 模块级无按参数启用的能力；`request.js` 内部本就按 `autoHd` 自行判断，脚本常开不影响行为 |
| `[URL Rewrite] - reject` | `url_rewrites[].location: "http://reject/"`（空 404；可改 `http://reject-200/` 等） |
| `[MITM] hostname=%APPEND% ...` | `mitm.hostnames` 列表 |

## 已知差异与注意事项

- **脚本运行时不同**：Surge 的 `engine=webview`（有 DOM）→ Egern 单一运行时。原脚本只用纯 JS + 流/压缩/加密 API，不依赖 DOM；
  Egern 运行时若缺少 `Uint8Array#toBase64`、`TextEncoder/Decoder`、`CompressionStream/DecompressionStream`，适配层会按需 polyfill
  （压缩方向走 Egern 官方 `ctx.compress`）。
- **持久化存储**：所有脚本经 `ctx.storage` 共享 `YouTubeConfig`（客户端/加密密钥）与 `YouTubeQuality`（分辨率缓存）两个键，
  各脚本之间有数据依赖；若你的 Egern 版本按脚本隔离存储，将导致 ump 解密失败（旧版会自动 LE 级重建键，表现为偶发 4x 不可用）。
- **拒绝策略**：Surge `reject` 为断链/空响应；Egern `http://reject/` 返回 404 空响应，语义近似。若想让页面拿到 200 空响应可改 `http://reject-200/`。
- **远端托管**：`script_url` 目前为相对路径 `js/*.egern.js`，适合「按目录导入/本地路径」用法；若改为远程 https 托管，请把
  `youtube-enhance.yaml` 中 7 处 `script_url` 改成对应的绝对 URL（例如 `https://你的服务/youtube/js/request.egern.js`）。
- **升级**：更新 `js/*.js`（Surge 原版）后重跑 `python3 build_adapters.py` 重新生成 `*.egern.js`。

## 许可

- 原始脚本与模块：基于 Maasea 的代码（**Apache-2.0**），整理自 [gholts/surge](https://github.com/gholts/surge)。
- 本目录的适配层与 YAML 仅作格式转换，延续上游许可。
