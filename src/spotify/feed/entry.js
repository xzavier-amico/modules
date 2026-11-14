  // 入口：首页 / 搜索 / 滚动页的赞助内容过滤，滚动页额外补歌词卡对应的 section。
  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  const url = res.url || (typeof $request !== "undefined" && $request && $request.url) || "";
  const status = Number(res.status || res.statusCode);

  if (status >= 300) {
    $done({});
    return;
  }

  // 查询串很常见（?locale=zh / ?market=US）；只用 (?:\/|$) 会把这些请求整个放行。
  const HOME_URL = /\/casita\/v\d+\/home(?:\/|\?|$)/;
  const BROWSE_URL = /\/browsita\/v\d+\/browse(?:\/|\?|$)/;
  const SCROLL_URL = /\/scrollsita\/v\d+\/scroll\//;

  const isHome = HOME_URL.test(url);
  const isBrowse = BROWSE_URL.test(url);
  const isScroll = SCROLL_URL.test(url);
  const wantAds = adsOn;
  const wantCard = isScroll && lyricsCardOn;
  if (!(isHome || isBrowse || isScroll) || !(wantAds || wantCard)) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  if (body.length > MAX_FEED_BYTES) {
    $done({});
    return;
  }

  const trackId = isScroll ? scrollTrackId(url) : "";
  const PREFETCH_NEXT_MS = 1500;
  // 下一首：connect-state 存下的队列顺序。只用于预取歌词，取不到就跳过。
  const nextTrackId = (() => {
    if (!prefetchOn || !isScroll || !trackId) return "";
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store) return "";
    try {
      const raw = store.read("spotify.queue");
      const queue = raw ? JSON.parse(raw) : null;
      if (!queue) return "";
      const at = Number(queue.at) || 0;
      if (at && Date.now() - at > 30 * 60 * 1000) return "";
      // 新结构是 current + next[]；旧安装里可能还是 ids[]，按当前曲目位置兜底。
      let next = "";
      if (Array.isArray(queue.next)) {
        if (queue.current && queue.current !== trackId) return "";
        next = queue.next[0] || "";
      } else if (Array.isArray(queue.ids)) {
        const index = queue.ids.indexOf(trackId);
        next = index >= 0 ? queue.ids[index + 1] || "" : "";
      }
      if (!next || next === trackId) return "";
      // 没有曲名 / 歌手时预取要先请求 oEmbed，反而拖慢补卡；等元数据到了再说。
      const metaRaw = store.read("spotify.track.meta");
      const meta = metaRaw ? JSON.parse(metaRaw) : null;
      return meta && meta[next] ? next : "";
    } catch (e) {
      return "";
    }
  })();
  const finish = (out) => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    $done({ body: out });
  };

  // 滚动页的歌词卡：先让歌词脚本把结果写进缓存，再补 section。这样卡片出现时
  // 客户端随后请求 color-lyrics 会直接命中缓存，不会先显示空卡、重进才加载。
  // 列表里已经有歌词 section（官方歌词）时不做这次查询。
  const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsPrefetch : null;
  if (isScroll && wantCard && trackId && typeof prefetch === "function" &&
      !(typeof hasLyricsCard === "function" && hasLyricsCard(body))) {
    const finishCard = (payload) => finish(patchScroll(body, trackId, wantAds, !!payload));
    prefetch(trackId, (payload, meta) => {
      // 当前曲目超时、或还有来源没回来时，不再接着预取下一首：下一轮需要重置
      // 歌词脚本状态，上一轮晚到的结果会写进下一首的缓存。
      const canPrefetchNext = prefetchOn && !!nextTrackId && !(meta && meta.incomplete) &&
        typeof setTimeout === "function";
      if (!canPrefetchNext) {
        finishCard(payload);
        return;
      }
      let settledNext = false;
      let timer = null;
      const afterNext = () => {
        if (settledNext) return;
        settledNext = true;
        if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
        finishCard(payload);
      };
      // 下一首只为写缓存，最多等 1.5 秒，避免没有歌词的歌把滚动页拖住。
      timer = setTimeout(afterNext, PREFETCH_NEXT_MS);
      prefetch(nextTrackId, afterNext);
    });
    return;
  }

  let out = null;
  if (isHome) {
    out = wantAds ? stripHomeAds(body) : null;
  } else if (isBrowse) {
    out = wantAds ? hideBrowseAds(body) : null;
  } else {
    // 滚动页一次遍历完成：先删广告 section，再按过滤后的列表补歌词 section，
    // 避免补在会被丢弃的 section 之后。
    out = patchScroll(body, trackId, wantAds, wantCard);
  }

  finish(out);
