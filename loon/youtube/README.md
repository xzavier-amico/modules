# YouTube Enhance — Loon 插件

由 Surge 模块 `gholts/surge → modules/youtube-enhance.sgmodule` 转换的 **Loon** 插件。原始逻辑来自 Maasea 的代码（Apache-2.0）；本仓库把上游的 4 个脚本重写并合并成 `js/youtube.js` 一个文件，Loon 与 Egern 共用同一份代码。

脚本在参数入口做了兼容处理：Loon 传入的 snake_case 对象（或位置数组）会自动映射为 camelCase 键，Egern 传入的 JSON 字符串同样兼容。

## 安装

在 Loon 中导入：

`https://raw.githubusercontent.com/xzavier-amico/modules/master/loon/youtube/youtube-enhance.plugin`

需要开启 MitM（`*.googlevideo.com`、`youtubei.googleapis.com`、`www.youtube.com`、`s.youtube.com`）。

## 参数

共 27 个参数，均可在插件设置页调整；默认值与上游原版行为一致。

### 界面与内容

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_upload` | true | 移除侧栏中的「上传」入口 |
| `block_shorts` | false | 移除侧栏中的 Shorts 入口 |
| `block_shorts_feed` | false | 移除首页列表中的 Shorts 推荐货架 |
| `block_members_only` | false | 移除首页、频道页等列表中需要频道会员才能观看的视频 |
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
| `verbose_log` | false | 在 Loon 日志中打印改写前后的字节数与异常信息，排查时使用 |

### On-the-go

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `on_the_go` | true | 启用 On-the-go 控件总开关 |
| `on_the_go_audio` | true | 在 On-the-go 控件中加入音频模式切换按钮 |
| `on_the_go_chapters` | true | 在 On-the-go 控件中加入章节按钮 |

## 注意事项

- `max_height`、`prefer_premium` 只在 `auto_hd` 开启时生效。
- `on_the_go_audio`、`on_the_go_chapters` 只在 `on_the_go` 开启时生效。
- `block_upload` / `block_shorts` 与 `block_guide_items` 都作用于侧栏；`block_shorts_feed` 只清理首页等信息流中的 Shorts 推荐货架，二者互不影响。`block_members_only` 只从列表页（首页、频道页、Shorts 货架）中移除会员专属视频，不会解锁播放；它按徽章文字（`会员专享` / `Members only` 等）匹配，极少数标题恰好同名的视频可能被误删。`block_games` / `block_store` 只清理首页或播放器内的卡片与悬浮层，不会隐藏侧栏入口，如有需要可把对应 `browseId` 填入 `block_guide_items`。
- `[Rewrite]` 中的 `pagead/pcs` 与 `stats/ads` 两条 404 规则无法按参数条件启用；即使关闭相关广告开关，这两条静态规则仍会生效。
- 脚本已重写并合并为单文件，不再依赖上游脚本结构，也不再参与 `update.sh` 的自动同步；上游若有大改动，需要人工对比后再决定是否跟进。
- 排障时打开 `verbose_log`，日志统一带 `youtube:` 前缀（如 `youtube: response: ...`）。
