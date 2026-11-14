# scrollsita 歌词卡与广告过滤

`scrollsita/v1/scroll/{uri}` 返回 Now Playing 的卡片列表。`js/spotify.feed.js` 在响应体里做两件事：移除赞助卡，并在缺少歌词卡时补一个歌词 section。

## 歌词 section

客户端只有在列表里看到歌词 section 时，才会把歌词卡排进 Now Playing 列表。结构：

```text
section {
  field 5  { field 1: "spotify:track:{id}" }        // 曲目
  field 23 { field 1: "spotify:section:{section_id}" } // section id
}
```

- 官方没有歌词的曲目，列表不会下发这一格；脚本按上面的结构补一格，`section_id` 复用真实歌词 section 的值。
- 只处理当前曲目的列表；列表里已经有歌词 section 时不重复补。
- 无法逐字节重建响应时原样放行。

## 赞助卡

滚动页的赞助卡独占一个 section：section 里通常是 section id（字段 23）和广告内容（字段 30）。

过滤时删除整个 section，而不是只改字段号，避免客户端拿到一张「有 id、没有内容」的空卡片。

## 歌词正文

`js/spotify_lyrics.js` 处理 `color-lyrics`：官方 200 原样放行；404 / 空歌词时用第三方来源合成，并补齐官方字段（含 `previewLines`），供歌词卡和完整歌词页共用。
