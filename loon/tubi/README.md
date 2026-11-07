# Tubi — Loon 插件

- Loon：`loon/tubi/tubi-adfree.plugin` + `js/tubi_adfree.js`
- Egern：`egern/tubi/tubi-adfree.yaml`

去广告。做法是让播放器根本拿不到广告位，顺带让广告接口回答「没有广告」，
视频流本身不动。

## 为什么可以这么做

Tubi 的广告是客户端插入（CSAI），不是把广告缝进视频里。实测一部片子的 HLS 媒体清单：
833 个分片、单一 `k4ctumsr.mp4` 源、没有任何 `#EXT-X-DISCONTINUITY` 或 `EXT-X-CUE-OUT`。
广告位写在内容元数据里（`monetization.cue_points`，例如 `[0,105,543,950,...]`），
播到对应秒数时播放器再单独发一个请求要广告，拿到 `{ ads: [...] }` 后插进去播。
广告列表为空时播放器直接继续正片，这是它自己的正常分支。

所以最省事的一刀是**把 cue_points 清空**：没有广告位，播放器不会在 50 分钟那种中途
位置发起广告请求，也就不会走到「广告服务没返回 → 补一段备用推广片」的兜底分支。
后者是纯改广告响应治不了的：两个 30 秒、无缝衔接、不能跳过，正是兜底推广片的形态。

## 改写了什么

| 请求 | 原响应 | 改成 |
| --- | --- | --- |
| `tubitv.com/oz/videos/<id>/content` 等内容 / 接口 JSON | `monetization.cue_points: [0,105,…]` | `cue_points` 清空，其余字段原样 |
| `rainmaker*.production-public.tubi.io/…/rev/vod/…` | `{"ads":[…],"metrics":{…}}` | `ads` 清空，`metrics.responseTime` 补上，其余字段原样 |
| `ads.adrise.tv`、`ads.tubi.io`、`ads.production-public.tubi.io`、`ads.tubitv.com` | VAST / VMAP / JSON | 空 VAST（沿用原版本号）、空 VMAP、或清空 `ads` |

`ads` / `cue_points` / `ad_breaks` / `ad_pods` 这几个字段只要确实是数组就清空（含嵌套），
JSON 里内嵌的 VAST 字符串只替换那一个字段；其余响应原样放行。所以接口换形状时
最差也只是脚本不生效，不会把播放改坏。

## 为什么不是直接 reject

Tubi 带反广告拦截：网页端会去拉 `https://mcdn.tubitv.com/js/ads.js` 这个诱饵，
播放器里还有 `MAX_AD_REQUEST_BLOCKED_CONTINUOUS_COUNT` 计数和
`AD_REQUEST_BLOCKED_ERROR`。把广告域名直接 reject 会被计入拦截次数，轻则弹提示，
重则不给播。返回合法的空广告响应走的是正常业务分支，不触发这些检测。

## 规则（美国线路）

Tubi 只在美国可用。插件的 `[Rule]` 段把它的域名固定指向 `PROXY`：

| 域名 | 用途 |
| --- | --- |
| `tubitv.com` | App 接口、网页、静态资源 |
| `tubi.com` | 301 跳到 tubitv.com |
| `tubi.tv` | 302 跳到 gdpr.tubi.tv |
| `tubi.video` | 视频 CDN |
| `tubi.io` | 接口与广告 |
| `adrise.tv` | 广告（`ads.adrise.tv`） |

这样不会被「国内直连」之类的规则带走，导致 MITM 看不到流量、插件静默失效。
如果你本身在美国，或想指定某个节点/策略组，把 `[Rule]` 里这六行的 `PROXY`
改成 `DIRECT` 或你的策略组名即可。

## 参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `block_ads` | true | 关闭后脚本不做任何修改 |
| `debug` | false | 打印 `[tubi]` 开头的日志：命中的 URL、响应长度、是否改写、未处理响应的前 120 字节 |

## 注意

- 需开启 MitM，插件用的是通配：`tubitv.com`、`*.tubitv.com`、`tubi.io`、`*.tubi.io`、
  `*.adrise.tv`。别收窄成具体主机名——广告请求换个子域（比如 `ads.tubitv.com`）
  就会从 MITM 漏掉，表现是「开头能去广告，播到一半的 mid-roll 又出来了」。
- 别再用别的规则 reject 上面这些域名，会和本插件冲突（见上一节）。
- 广告位被清掉后，暂停、拖动进度都不会再触发广告；观感上就是直接进正片。
- 图标：Tubi.png
