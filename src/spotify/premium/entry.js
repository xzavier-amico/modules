  // 入口：bootstrap / UCS / 元数据 / 远程配置 / 账号属性。
  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || null;
  const url = (res && res.url) || req.url || "";

  // connect-state 里刚存下的当前曲目；同一首 10 分钟内只预取一次。
  function queuedCurrentTrack() {
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store) return "";
    try {
      const queue = JSON.parse(store.read("spotify.queue") || "null");
      const current = queue && queue.current;
      if (!current) return "";
      const markerRaw = store.read("spotify.prefetch.current");
      const marker = markerRaw ? JSON.parse(markerRaw) : null;
      if (marker && marker.id === current && Number(marker.at) && Date.now() - Number(marker.at) < 10 * 60 * 1000) return "";
      store.write(JSON.stringify({ id: current, at: Date.now() }), "spotify.prefetch.current");
      return current;
    } catch (e) {
      return "";
    }
  }

  // 请求阶段只做一件事：抹掉 extended-metadata 请求体里的 etag。
  if (!res) {
    if (lyricsMetaOn) stripRequestEtags(req, url);
    else $done({});
    return;
  }

  if (Number(res.status) >= 300) {
    $done({});
    return;
  }

  const META_URL = /\/extended-metadata\/|\/context-resolve\/|\/connect-state\/|\/metadata\/4\/track\//;
  const CONFIG_URL = /\/remote-config-resolver\//;
  const ATTR_URL = /\/nebula\//;

  const isMeta = META_URL.test(url);
  const isConfig = CONFIG_URL.test(url);
  const isAttr = ATTR_URL.test(url);

  // 桌面版允许「只去广告、不伪装 Premium」：spoof 关掉时仍然处理广告属性。
  // iOS / Egern / Shadowrocket 保持原行为：spoof 关掉就整个放行。
  // 远程配置 / 账号属性在 spoof 或 block_ads 任一打开时都要改写，否则 App
  // 重新拉一次配置就会把 bootstrap 里关掉的开关重新打开。
  let enabled;
  if (isMeta) enabled = lyricsMetaOn;
  else if (isConfig || isAttr) enabled = spoof || adsOn;
  else enabled = desktop ? spoof || adsOn : spoof;
  if (!enabled) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  const maxBytes = isMeta ? MAX_META_BYTES : isConfig || isAttr ? MAX_FEED_BYTES : MAX_BOOTSTRAP_BYTES;
  if (body.length > maxBytes) {
    $done({});
    return;
  }

  let out = null;
  if (isMeta) {
    out = patchMeta(body, url);
  } else if (isConfig) {
    out = patchConfigurationResponse(body);
  } else if (isAttr) {
    out = patchAttributesResponse(body);
  } else if (desktop) {
    out =
      url.indexOf("bootstrap") >= 0
        ? patchBootstrapDesktop(body) || patchCustomizeDesktop(body)
        : patchCustomizeDesktop(body) || patchBootstrapDesktop(body);
  } else {
    out =
      url.indexOf("bootstrap") >= 0
        ? patchBootstrap(body) || patchCustomize(body)
        : patchCustomize(body) || patchBootstrap(body);
  }

  const finish = () => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    $done({ body: out });
  };

  // connect-state 换歌时先把当前曲目的歌词查好写进缓存。歌词页和滚动页补卡随后
  // 直接命中缓存，不会再等第三方源；同一首只预取一次，避免轮询把响应拖慢。
  const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsPrefetch : null;
  if (isMeta && /\/connect-state\//.test(url) && prefetchOn && typeof prefetch === "function") {
    const current = queuedCurrentTrack();
    if (current) {
      let settled = false;
      let timer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
        finish();
      };
      if (typeof setTimeout === "function") timer = setTimeout(done, 1500);
      prefetch(current, done);
      return;
    }
  }

  finish();
