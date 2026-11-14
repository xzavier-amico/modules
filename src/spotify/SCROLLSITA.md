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
- 前 2 秒每 200ms 读一次，之后每 500ms 读一次，最多 8 秒（`feed/entry.js` 的
  `CARD_*` 常量）：
  - 歌词已就绪 -> 立即补卡，内容同时到位；
  - 确认没歌词 -> 不补卡，避免空白卡；
  - 等满窗口仍没结果 -> 乐观补卡，内容随后由 `color-lyrics` 请求填充。
- 确认没歌词的曲目 5 分钟内不再补卡；查到歌词 / 官方有歌词 / 缓存命中会清掉标记。
- 官方已有歌词 section 时不重复补；`section_id` 复用真实歌词 section 的值。
- 只处理当前曲目的列表；无法逐字节重建响应时原样放行。

## 歌词请求

`js/spotify_lyrics.js` 处理 `color-lyrics`：

- 请求阶段：缓存命中直接返回合成歌词，跳过官方请求；未命中立即放行。
- 响应阶段：官方 200 原样放行（只清免费号额度限制）；404 / 空歌词时用第三方来源
  合成，并补齐官方字段（含 `previewLines`），供歌词卡和完整歌词页共用。
- 查不到 / 超时不写缓存，下次请求会重试。

自建的 `server/spotify-mock` 在服务端完成同样的事，且官方请求与第三方查询并行
（`LYRICS_PARALLEL=false` 可退回串行）；滚动页同样等歌词查询后再决定补不补卡。

## 赞助卡

滚动页的赞助卡独占一个 section：section 里通常是 section id（字段 23）和广告内容（字段 30）。

过滤时删除整个 section，而不是只改字段号，避免客户端拿到一张「有 id、没有内容」的空卡片。
