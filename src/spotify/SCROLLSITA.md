# scrollsita 歌词卡与广告过滤

`scrollsita/v1/scroll/{uri}` 返回 Now Playing 的卡片列表。`js/spotify.feed.js` 在响应体里做两件事：移除赞助卡，并在缺少歌词卡时补一个歌词 section。

## 歌词 section：卡住 scrollsita 等歌词结果

客户端把列表渲染完之后，不会因为 `color-lyrics` 后来拿到了歌词就回头补一格。少了
这一格，往往要把歌曲最小化再最大化、重新渲染 scrollsita 才出现。所以补卡要
**先把 scrollsita 响应卡住，等歌词结果就绪再返回**：

```text
section {
  field 5  { field 1: "spotify:track:{id}" }        // 曲目
  field 23 { field 1: "spotify:section:{section_id}" } // section id
}
```

- 标志位就是 `spotify.lyrics.cache`：`color-lyrics` 响应阶段和 `connect-state`
  预取拿到歌词都会写它；`spotify.lyrics.miss` 表示已经确认没有歌词。
  feed 脚本**不再自己另起一次第三方查询**和 `color-lyrics` 抢时间，只轮询标志位。
- 每 200ms 读一次，最多 4.5 秒（`feed/entry.js` 的 `CARD_POLL_MS` / `CARD_WAIT_MS`）：
  - 歌词已就绪 -> 立即补卡，内容同时到位（最常见，实际零等待）；
  - 确认没歌词 -> 不补卡，从源头避免空白卡；
  - 等满窗口仍没结果 -> 乐观补卡，内容随后由 `color-lyrics` 请求填充。
  缓存里有几百 KB 歌词时第一次读就返回；空缓存时每轮解析的只是个小 JSON，
  不需要额外的轻量标志位。
- 4.5 秒只是上限：`color-lyrics` 请求阶段登记的 `spotify.lyrics.pending` 会让
  官方请求飞行期间的 `connect-state` 轮询立刻并行查第三方源，通常远不到上限
  就能把缓存写上、提前结束等待。超时兜底不能去掉——部分路径是「客户端看到
  歌词卡才请求 color-lyrics」，无限等会互相等死。
- 乐观补卡后如果确认官方和第三方都没有歌词，`spotify.lyrics.miss` 记 5 分钟，
  之后同一首歌再渲染不再补空卡；查到歌词 / 官方有歌词 / 缓存命中会清掉标记。
- 官方已有歌词 section 时不重复补；`section_id` 复用真实歌词 section 的值。
- `prefetch` 开启时（默认）：`connect-state` 换歌后先预取当前曲目，下一次轮询
  再按 `next_tracks` 预取下一首（不会拿 `prev_tracks` 当下一首）；连续快速切歌
  会跳过预取。当前曲目最多等 1.5 秒、下一首 1 秒。
- 只处理当前曲目的列表；无法逐字节重建响应时原样放行。

## 官方歌词请求与第三方查询并行

代理脚本调用 `$done` 后运行时会释放资源（Loon Script API 明确要求 `$done` 之前
结束所有异步任务），所以请求阶段脚本不能一边放行官方请求、一边后台查第三方。
链路改为跨脚本接力：

1. `color-lyrics` 请求阶段：缓存命中直接返回合成歌词，跳过可能很慢的官方请求；
   未命中则写 `spotify.lyrics.pending` 并立即放行。
2. 官方请求飞行期间，随后到达的 `connect-state` 轮询优先预取该曲目并写缓存
   （`spotify.lyrics.inflight` 防止重复起查询）。
3. 官方 404 / 空响应阶段：读缓存，没有就查第三方源并写缓存，再按客户端格式
   合成响应。

自建的 `server/spotify-mock` 没有这个运行时限制：官方请求和第三方查询在服务端
同时发出，官方 200 有歌词用官方结果，404 时直接复用并行结果（`LYRICS_PARALLEL=false`
可退回串行）。滚动页同样等待歌词查询（最多 4.5 秒）后再决定补不补卡。

## 赞助卡

滚动页的赞助卡独占一个 section：section 里通常是 section id（字段 23）和广告内容（字段 30）。

过滤时删除整个 section，而不是只改字段号，避免客户端拿到一张「有 id、没有内容」的空卡片。

## 歌词正文

`js/spotify_lyrics.js` 处理 `color-lyrics`：官方 200 原样放行（只清免费号额度限制）；
404 / 空歌词时用第三方来源合成，并补齐官方字段（含 `previewLines`），供歌词卡和
完整歌词页共用。
