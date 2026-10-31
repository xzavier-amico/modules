# BiliBili Biliverse — Egern 合并模块

由 Biliverse 的 4 个 Surge 模块合并转换为单个 **Egern** 模块：

- ⚙️ Enhanced (v0.6.2)：首页/分区/底部导航/我的页面自定义
- 🌐 Global (v0.9.3)：番剧影视限制区域自动线路 + 全区搜索
- 🔀 Redirect (v0.2.25)：CDN 主机名重定向加速
- 🛡️ ADBlock (v0.7.5)：去广告与不适元素

脚本直接引用上游 GitHub Releases 的 `bundle.js`（绝对 URL），无需本地托管。

## 使用

```yaml
modules:
  - name: "BiliBili Biliverse"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/bilibili/bilibili-enhance.yaml"
    enabled: true
```

需要安装并信任 Egern CA 证书并开启 MITM（hostnames 已在模块中列出）。

## 参数

所有 Surge `#!arguments` 均映射为 `compat_arguments`（snake_case 键），共 52 项，可在模块设置页通过 Toggle/选择器调整，也可在主配置 `compat_arguments` 中覆写。`Storage` 与 `LogLevel` 在 4 个子模块间共用。

## 转换说明

- Surge `[Script]` → Egern `scriptings`（http_request/http_response），`requires-body`/`binary-body-mode`/`max-size` 直译。
- Surge `[Rewrite]` 中的 `reject`/`reject-dict` → Egern `rewrites` 的 `respond`；`response-body-json-jq` → `body_rewrites` 的 `response_jq`。
- Surge 的 `response.body.mock_file` / `mock-response-body` / `response.header.add` 等复杂改写 Egern 无法直接表达，已跳过（主要影响应用内偏好面板的远程加载与部分 mock）；核心功能通过脚本 + 参数生效。
- `[MitM] hostname` 合并去重。

## 许可

基于 VirgilClyne 等的 Biliverse 项目，仅做格式转换。
