# scrollsita 歌词卡与广告过滤

`scrollsita/v1/scroll/{uri}` 返回 Now Playing 的卡片列表。`js/spotify.feed.js` 在响应体里做两件事：移除赞助卡，并在缺少歌词卡时补一个歌词 section。

## 歌词 section

客户端渲染完列表后不会再插入新的歌词卡，所以第一次响应就要把 section 补上。
**补卡不等歌词**：打开 Now Playing 时客户端先渲染列表，之后才合并 scrollsita 的响应；
响应晚到只更新模型、不重绘列表，卡片要收起再展开才出现。所以收到 scroll
就立刻补卡，内容由随后的 `color-lyrics` 响应填充。

```text
section {
  field 5  { field 1: "spotify:track:{id}" }        // 曲目
  field 23 { field 1: "spotify:section:{section_id}" } // section id
}
```

- `spotify.lyrics.miss` 表示已经确认没有歌词：这类曲目 5 分钟内不补卡，避免空白卡。
  查到歌词 / 官方有歌词 / 缓存命中会清掉标记。
- `spotify.lyrics.pending`：请求阶段开始查歌词时写。有请求在路上时旧的 miss
  标记不作数，这次可能就查到了。feed 只读这个标记做判断，不再轮询等待。
- `spotify.lyrics.cache.v2`：`color-lyrics` 响应阶段拿到歌词就会写它；卡片渲染时
  客户端自己来取，所以补卡时缓存是否就绪不影响是否补卡。
- 补卡不等待歌词：等待只会让 scroll 响应晚于客户端首次渲染，等多久都没用。
- 官方已有歌词 section 时不重复补；`section_id` 复用真实歌词 section 的值，合成结构与官方一致。
- 补卡位置是列表最前面（第 0 位）；有 Event 卡时会被挤走，这是接受的代价。
- 只处理当前曲目的列表；无法逐字节重建响应时原样放行。

## 曲目元数据回填

歌词脚本取曲名 / 歌手要先读 `spotify.track.meta.v2`；没命中就只能回源 `open.spotify.com`
（oEmbed 与 embed 并行发出）。首次进 Now Playing 时 feed 可能刚写好这份缓存：
歌词脚本会每 100ms 看一次、最多 2 秒，命中就直接开始查歌词，不必等 oEmbed。滚动页的当前曲目 section 里本来就带着
`track_title` / `artist_name` 的 metadata map，feed 顺手抄一份写进同一个缓存，
下次同一首再进 Now Playing 就是零请求。

回填只在「section 里确实有当前曲目的 track 引用」时递归，并限制遍历节点数，
避免把 12MB 的列表整个走一遍。oEmbed / embed 两个请求并行发出、单次上限 2.5 秒：
其中一个卡住时不会再多等一轮。

## 歌词请求

`js/spotify_lyrics.js` 处理 `color-lyrics`：

- 请求阶段：缓存命中直接返回合成歌词，跳过官方请求；未命中立即放行。
- 响应阶段：官方 200 原样放行（只清免费号额度限制）；404 / 空歌词时用第三方来源
  合成，并补齐官方字段（含 `previewLines`），供歌词卡和完整歌词页共用。
- 查不到 / 超时不写缓存，下次请求会重试。

自建的 `server/spotify-mock` 在服务端完成同样的事，且官方请求与第三方查询并行
（`LYRICS_PARALLEL=false` 可退回串行）；滚动页同样等歌词查询后再决定补不补卡，
查到歌词后再等 200ms 才返回 scroll，让并行的 `color-lyrics` 响应先回到客户端。

## 赞助卡

滚动页的赞助卡独占一个 section：section 里通常是 section id（字段 23）和广告内容（字段 30）。

过滤时删除整个 section，而不是只改字段号，避免客户端拿到一张「有 id、没有内容」的空卡片。

## 桌面端（macOS / Windows 新版播放器）

新版桌面客户端是 CEF 里的 xpui，歌词请求和 iOS 不一样：

- 歌词正文走 `color-lyrics/v2/track/{id}/image/{封面}?format=json`（官方把歌词和
  封面色合在「image」这个路径上），返回的是同一份歌词 JSON。
- 这条请求是**跨域 fetch**：先发 `OPTIONS` 预检，再发 `GET`，请求带
  `Origin: https://xpui.app.spotify.com` 与 `Access-Control-Request-Headers`。

因此歌词脚本有两条桌面端专属约束：

1. `OPTIONS` 预检（以及任何带 `Access-Control-Allow-Methods` / `Max-Age` 的响应）
   一律原样放行。预检响应没有 body，一旦被当成「官方没歌词」回一份歌词 JSON，
   `Access-Control-Allow-Origin` 就没了，浏览器报
   `PreflightMissingAllowOriginHeader`，`GET` 根本发不出去，App 显示
   「无法加载这首歌曲的歌词，请稍后再试」。症状是 Loon 的脚本记录里只有
   `OPTIONS`、没有对应的 `GET`。
2. 合成响应以官方响应头为底，只替换 body：保留 CORS 头、重算 `Content-Length`、
   去掉 `Content-Encoding`；JSON 里必须带 `lyrics.previewLines`（客户端直接
   `.map()`，缺了抛 `TypeError`，同样显示「无法加载」）。

桌面端不在请求阶段回缓存歌词：跨域响应要自己补 CORS 头，风险比省下的那次请求大，
统一在响应阶段合成。
