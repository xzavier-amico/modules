  // 入口：首页 / 搜索 / 滚动页的赞助内容过滤，滚动页额外补歌词卡对应的 section。
  const res = (typeof $response !== "undefined" && $response) || null;
  // 日志与曲名标签由 lyrics.js 的辅助模式通过 globalThis 暴露；没有时静默降级。
  const spotifyLog = (typeof globalThis !== "undefined" && globalThis.__spotifyLog) || (() => {});
  const trackLabel = (typeof globalThis !== "undefined" && globalThis.__spotifyTrackLabel) || ((id) => id || "?");
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

  // 补卡前卡住 scrollsita 等歌词结果：轮询歌词进度，命中即补（内容就绪）、
  // 读到 miss 不补空卡、超时乐观补卡（内容由 color-lyrics 请求填充）。
  // 关键是要等歌词响应已经交给客户端（served），只等缓存会让 scroll 先渲染。
  // 等待上限、步长和宽限在这里调整。
  const CARD_WAIT_MS = 8000;
  const CARD_FAST_MS = 2000;
  const CARD_FAST_POLL_MS = 200;
  const CARD_SLOW_POLL_MS = 500;
  // 歌词响应发出后再留给客户端处理的时间；歌词请求比 scroll 晚开始时，
  // 等待窗口最多再顺延 CARD_EXTEND_MS。
  const CARD_GRACE_MS = 250;
  const CARD_EXTEND_MS = 4000;
  const feedStartedAt = Date.now();
  if (isScroll && wantCard) {
    const card = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsCard : null;
    const hasCard = typeof hasLyricsCard === "function" && hasLyricsCard(body);
    const allowed = !!trackId && !hasCard && (typeof card === "function" ? card(trackId) : true);
    spotifyLog("feed.scroll", "track=" + trackId + " title=" + trackLabel(trackId)
      + " bytes=" + body.length + " hasCard=" + hasCard + " allowed=" + allowed);
    if (!allowed) {
      spotifyLog("feed.scroll", "track=" + trackId + " card=skip reason=" + (!trackId ? "no-track" : hasCard ? "official-card" : "miss-mark"));
      finish(patchScroll(body, trackId, wantAds, false));
      return;
    }
    const wait = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsWait : null;
    if (typeof wait === "function") {
      wait(trackId, (ready, timedOut) => {
        const addCard = !!ready || !!timedOut;
        const out = patchScroll(body, trackId, wantAds, addCard);
        spotifyLog("feed.scroll", "track=" + trackId + " title=" + trackLabel(trackId)
          + " card=" + (addCard ? "add" : "skip") + " optimistic=" + (!ready && timedOut)
          + " patched=" + (out ? 1 : 0) + " total=" + (Date.now() - feedStartedAt) + "ms");
        finish(out);
      }, {
        max: CARD_WAIT_MS,
        fastUntil: CARD_FAST_MS,
        fastStep: CARD_FAST_POLL_MS,
        slowStep: CARD_SLOW_POLL_MS,
        grace: CARD_GRACE_MS,
        extendMax: CARD_EXTEND_MS,
      });
      return;
    }
    spotifyLog("feed.scroll", "track=" + trackId + " card=add reason=no-wait-fn");
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
