# scrollsita 歌词卡与广告过滤

`scrollsita/v1/scroll/{uri}` 返回 Now Playing 的卡片列表。`js/spotify.feed.js` 在响应体里做两件事：移除赞助卡，并在缺少歌词卡时补一个歌词 section。

## 歌词 section

客户端渲染完列表后不会再插入新的歌词卡，所以第一次响应就要把 section 补上。
补卡前先等歌词结果：

```text
section {
  field 5  { field 1: "spotify:track:{id}" }        // 曲目
  field 23 { field 1: "spotify:section:{section_id}" } // section id
}
```

- 标志位是 `spotify.lyrics.cache`：`color-lyrics` 响应阶段拿到歌词就会写它；
  `spotify.lyrics.miss` 表示已经确认没有歌词。
- 光有缓存还不够：缓存写完到 `$done` 之间歌词响应还在返回路上，scroll 先到
  客户端时列表会按「没有歌词」渲染，卡片被丢掉。所以还看两个进度标记：
  - `spotify.lyrics.pending`：请求阶段开始查歌词时写，有请求在飞时旧的 miss
    标记不作数；
  - `spotify.lyrics.served`：歌词响应编码完成、`$done` 之前写。feed 等到它
    之后再留 200ms 宽限才放行 scroll。
- 前 400ms 每 100ms 读一次，之后每 200ms 读一次，最多 800ms（`feed/entry.js`
  的 `CARD_*` 常量）：
  - 缓存与 `served` 都就绪、且没有新的歌词请求在途 -> 等宽限后补卡，内容同时到位；
  - 只有缓存、还没 `served`，或还有歌词请求在飞 -> 继续等，但不超出预算；
  - 确认没歌词 -> 不补卡，避免空白卡；有请求在路上时旧的 miss 标记不作数；
  - 用完预算仍没结果 -> 乐观补卡，内容随后由 `color-lyrics` 请求填充。
- 预算是硬上限，不按歌词请求开始时间顺延。歌词一旦要走 `open.spotify.com`
  取元数据，整条链路实测 3 秒以上；Now Playing 的列表是客户端先本地渲染、
  再合并服务端结果，响应晚于合并就会被丢弃，补进去的卡片照样不显示。
  所以只在「歌词马上就到」的窗口里等，超时就带卡放行。
- 确认没歌词的曲目 5 分钟内不再补卡；查到歌词 / 官方有歌词 / 缓存命中会清掉标记。
- 官方已有歌词 section 时不重复补；`section_id` 复用真实歌词 section 的值。
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
