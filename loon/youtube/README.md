# YouTube Enhance — Loon 插件

由 Surge 模块 `gholts/surge → modules/youtube-enhance.sgmodule` 转换的 **Loon** 插件。Loon 与 Surge 共用同一套 JavaScript 运行时 API（`$request` / `$response` / `$done` / `$persistentStore` / `$argument`），因此脚本无需改写，仅将 `#!arguments` 转为 Loon 的 `[Argument]` 段并补充 `type=`。

## 安装

在 Loon 中导入：

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/youtube/youtube-enhance.plugin`

需要开启 MitM（`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`s.youtube.com`）。

## 参数

9 个开关（block_upload / block_shorts / auto_hd / block_games / block_vertical_live / jump_ahead / block_store / block_ai / on_the_go），在插件设置页调整。
