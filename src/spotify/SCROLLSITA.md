# scrollsita 歌词卡与广告过滤

`scrollsita/v1/scroll/{uri}` 返回 Now Playing 的卡片列表。`js/spotify.feed.js` 在响应体里做两件事：移除赞助卡，并在缺少歌词卡时补一个歌词 section。

## 歌词 section

客户端渲染完列表后不会再插入新的歌词卡，所以第一次响应就要把 section 补上。
**补卡不等歌词**：打开 Now Playing 时客户端先渲染列表，之后才合并 scrollsita 的响应；
响应晚到只更新模型、不重绘列表，卡片要收起再展开才出现（实测）。所以收到 scroll
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
- `spotify.lyrics.cache`：`color-lyrics` 响应阶段拿到歌词就会写它；卡片渲染时
  客户端自己来取，所以补卡时缓存是否就绪不影响是否补卡。
- 曾经的「等 `spotify.lyrics.served` 再放行」已经去掉：等 200ms 也是等，
  响应照样晚于客户端第一次渲染。
- 官方已有歌词 section 时不重复补；`section_id` 复用真实歌词 section 的值，合成字节与官方完全一致（85 字节，只有曲目 id 不同）。
- 补卡位置在头部 section 之后（第 1 位）：Now Playing 的第一个 section 是固定的曲目 / 封面头部，卡片排到它前面会落在头部上面，客户端不显示。
- 只处理当前曲目的列表；无法逐字节重建响应时原样放行。

## 曲目元数据回填

歌词脚本取曲名 / 歌手要先读 `spotify.track.meta`；没命中就只能回源 `open.spotify.com`
（oEmbed 与 embed 并行，实测各 2.6 秒）。滚动页的当前曲目 section 里本来就带着
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
