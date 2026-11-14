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
  const finish = (out) => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    $done({ body: out });
  };

  // 补卡不等歌词：Now Playing 打开时客户端先渲染列表，之后才合并 scrollsita 的
  // 响应；响应晚到只更新模型、不重绘列表，卡片要收起再展开才出现（实测）。
  // 所以立刻补卡，内容由随后的 color-lyrics 响应填充——歌词已经在缓存里时，
  // 客户端拿到卡片就会直接取到内容。
  const feedStartedAt = Date.now();
  if (isScroll && wantCard) {
    const card = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsCard : null;
    const hasCard = typeof hasLyricsCard === "function" && hasLyricsCard(body);
    const allowed = !!trackId && !hasCard && (typeof card === "function" ? card(trackId) : true);
    if (debugOn) {
      spotifyLog("feed.scroll", "track=" + trackId + " title=" + trackLabel(trackId)
        + " bytes=" + body.length + " hasCard=" + hasCard + " allowed=" + allowed);
    }
    if (!allowed) {
      if (debugOn) {
        spotifyLog("feed.scroll", "track=" + trackId + " card=skip reason=" + (!trackId ? "no-track" : hasCard ? "official-card" : "miss-mark"));
      }
      finish(patchScroll(body, trackId, wantAds, false));
      return;
    }
    const out = patchScroll(body, trackId, wantAds, true);
    if (debugOn) {
      spotifyLog("feed.scroll", "track=" + trackId + " title=" + trackLabel(trackId)
        + " card=add patched=" + (out ? 1 : 0) + " total=" + (Date.now() - feedStartedAt) + "ms");
    }
    finish(out);
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
