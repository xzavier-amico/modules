  // 入口：首页 / 搜索 / 滚动页的赞助内容过滤，滚动页额外补歌词卡对应的 section。
  const req = (typeof $request !== "undefined" && $request) || null;
  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  const url = res.url || (req && req.url) || "";
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
  const wantCard = isScroll && lyricsOn;
  const wantNames = metaHans && typeof patchFeedNames === "function";
  if (!(isHome || isBrowse || isScroll) || !(wantAds || wantCard || wantNames)) {
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

  function headerValue(headers, name) {
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== name) continue;
      const value = headers[key];
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value === undefined || value === null ? "" : value);
    }
    return "";
  }

  // 换 body 时必须自己处理响应头，否则客户端拿到「新 body + 旧头」，整页直接空白：
  //   * Content-Length 要按新 body 重算。沿用旧长度客户端会按旧长度截断，
  //     protobuf 解析失败 —— Now Playing 走 connect-state 照旧显示，症状就是
  //     「只有卡片列表（scrollsita）没渲染」；
  //   * Content-Encoding 必须去掉。脚本拿到的是解压后的字节，再声明 gzip / br
  //     客户端解压失败，同样是空白列表；
  //   * CORS 头保留并在缺失时补上（桌面端 xpui 对这些接口是跨域 fetch）。
  function headersFor(length) {
    const source = res && res.headers;
    if (!source || "object" != typeof source) return null;
    const headers = {};
    let kept = 0;
    for (const key in source) {
      const lower = String(key).toLowerCase();
      if (lower === "content-length" || lower === "content-encoding" || lower === "transfer-encoding") continue;
      headers[key] = source[key];
      kept += 1;
    }
    // 拿不到原始响应头时返回 null，由 finish 退回「只换 body」的老路子。
    if (!kept) return null;
    headers["Content-Length"] = String(length);
    let hasOrigin = false;
    for (const key in headers) {
      if (String(key).toLowerCase() === "access-control-allow-origin") hasOrigin = true;
    }
    if (!hasOrigin) {
      const origin = headerValue(req && req.headers, "origin");
      if (origin) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
        headers["Vary"] = "Origin";
      }
    }
    return headers;
  }

  const finish = (out) => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    const headers = headersFor(out.length);
    if (!headers) {
      $done({ body: out });
      return;
    }
    $done({ status: status || 200, headers: headers, body: out });
  };

  // 任何异常都要落回原样放行：脚本不调用 $done，这条请求会挂到客户端超时，
  // 客户端拿不到 body，卡片列表整块空白。
  const safePatch = (fn) => {
    try {
      return fn();
    } catch (e) {
      return null;
    }
  };

  // 界面字形：在广告过滤 / 补卡之后再做一次纯字节的 metadata map 改写。
  const withNames = (out) => {
    if (!wantNames) return out;
    const named = safePatch(() => patchFeedNames(out || body));
    return named || out;
  };

  // 队列里的下一首：spotify.js 处理 connect-state 时写入 spotify.queue
  // （PlayerState: track = 7、next_tracks = 20）。只有队列里的当前曲目与本次
  // 滚动页一致时才认，避免用上一首歌的队列去预取。
  const nextQueueTrack = (current) => {
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store || !current) return "";
    try {
      const raw = store.read("spotify.queue");
      const queue = raw ? JSON.parse(raw) : null;
      if (!queue || !Array.isArray(queue.next)) return "";
      const at = Number(queue.at) || 0;
      if (at && Date.now() - at > 30 * 60 * 1000) return "";
      if (queue.current && queue.current !== current) return "";
      const next = String(queue.next[0] || "");
      return next && next !== current ? next : "";
    } catch (e) {
      return "";
    }
  };

  // 预取下一首：队列（spotify.queue）由 spotify.js 处理 connect-state 时写入，
  // 这里只读它、拿下一首的 id。查询是 fire-and-forget，绝不等待 —— 客户端要的是
  // 尽快拿到列表，多等一秒列表就可能不被采用。
  if (isScroll && trackId) {
    const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyPrefetch : null;
    if (typeof prefetch === "function") {
      safePatch(() => {
        const next = nextQueueTrack(trackId);
        return next ? prefetch(next) : false;
      });
    }
  }

  // 补卡不等歌词：Now Playing 打开时客户端先渲染列表，之后才合并 scrollsita 的
  // 响应；晚到的响应只更新模型、不重绘列表，卡片要收起再展开才出现。
  // 所以立刻补卡，内容由随后的 color-lyrics 响应填充。
  // 传入惰性判定函数，只在响应本身确实缺歌词 section 时才读本地存储。
  if (isScroll && wantCard) {
    const card = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsCard : null;
    const allowCard = () => !!trackId && (typeof card === "function" ? card(trackId) : true);
    finish(withNames(safePatch(() => patchScroll(body, trackId, wantAds, allowCard))));
    return;
  }

  let out = null;
  if (isHome) {
    out = wantAds ? safePatch(() => stripHomeAds(body)) : null;
  } else if (isBrowse) {
    out = wantAds ? safePatch(() => hideBrowseAds(body)) : null;
  } else {
    // 滚动页一次遍历完成：先删广告 section，再按过滤后的列表补歌词 section，
    // 避免补在会被丢弃的 section 之后。
    out = safePatch(() => patchScroll(body, trackId, wantAds, wantCard));
  }

  finish(withNames(out));
