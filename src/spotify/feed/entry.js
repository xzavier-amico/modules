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

  // 补卡前卡住 scrollsita 等歌词结果：轮询歌词缓存，命中即补（内容就绪）、
  // 读到 miss 不补空卡、超时乐观补卡（内容由 color-lyrics 请求填充）。
  // 等待上限与步长在这里调整。
  const CARD_WAIT_MS = 8000;
  const CARD_FAST_MS = 2000;
  const CARD_FAST_POLL_MS = 200;
  const CARD_SLOW_POLL_MS = 500;
  if (isScroll && wantCard) {
    const card = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsCard : null;
    const hasCard = typeof hasLyricsCard === "function" && hasLyricsCard(body);
    const allowed = !!trackId && !hasCard && (typeof card === "function" ? card(trackId) : true);
    if (!allowed) {
      finish(patchScroll(body, trackId, wantAds, false));
      return;
    }
    const wait = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsWait : null;
    if (typeof wait === "function") {
      wait(trackId, (ready, timedOut) => {
        finish(patchScroll(body, trackId, wantAds, !!ready || !!timedOut));
      }, { max: CARD_WAIT_MS, fastUntil: CARD_FAST_MS, fastStep: CARD_FAST_POLL_MS, slowStep: CARD_SLOW_POLL_MS });
      return;
    }
    finish(patchScroll(body, trackId, wantAds, true));
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
