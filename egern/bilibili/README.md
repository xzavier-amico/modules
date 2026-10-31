# BiliBili Biliverse — Egern 合并模块

基于 Biliverse 官方发布的 **Egern 原生模块**合并而来（Enhanced / Global / Redirect / ADBlock 各自的 `.yaml`），仅做合并与参数 UI 适配：

- ⚙️ Enhanced (v0.6.2)：首页/分区/底部导航/我的页面自定义
- 🌐 Global (v0.9.3)：番剧影视限制区域自动线路 + 全区搜索
- 🔀 Redirect (v0.2.25)：CDN 主机名重定向加速
- 🛡️ ADBlock (v0.7.5)：去广告与不适元素

## 使用

```yaml
modules:
  - name: "BiliBili Biliverse"
    url: "https://raw.githubusercontent.com/xzavier-amico/modules/master/egern/bilibili/bilibili-enhance.yaml"
    enabled: true
```

需要安装并信任 Egern CA 证书并开启 MITM（hostnames 已在模块中列出）。

## 参数

所有 `compat_arguments`（52 项）均提供 `compat_arguments_schema`（Toggle/选择器 UI），可在模块设置页调整，也可在主配置 `compat_arguments` 中覆写。`Storage` 与 `LogLevel` 在 4 个子模块间共用。

## 转换说明

- 直接采用 Biliverse 官方 Egern 模块结构（`map_locals` / `url_rewrites` / `body_rewrites` / `scriptings` / `mitm`），不做 Surge 转换。
- 仅新增 `compat_arguments_schema` 以启用 Egern 模块设置页的 Toggle UI（官方原版未提供）。
- 脚本 URL 指向上游 GitHub Releases 的 `bundle.js`（绝对 URL）。

## 许可

基于 VirgilClyne 等的 Biliverse 项目，仅做合并与 UI 适配。
