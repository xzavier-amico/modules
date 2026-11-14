  // 入口：bootstrap / UCS / 元数据 / 远程配置 / 账号属性。
  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || null;
  const url = (res && res.url) || req.url || "";

  // 预取目标。优先级：color-lyrics 请求阶段登记的曲目（官方请求正在飞行，这次
  // 轮询与它并行查第三方歌词）> 换歌后的当前曲目 > 下一首。connect-state 每次
  // 轮询只挑一个目标，避免在响应里连续等两次。快速切歌时 id 变了就会重新选
  // 目标，旧结果只会写进旧曲目的缓存，不会污染当前曲目。
  function prefetchTarget() {
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store) return null;
    const marker = (key, ttl) => {
      const raw = store.read(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && Number(value.at) && Date.now() - Number(value.at) < ttl ? value : null;
    };
    try {
      const now = Date.now();
      const lyrics = JSON.parse(store.read("spotify.lyrics.cache") || "{}");
      const cached = (id) => {
        const suffix = "|" + id;
        for (const key of Object.keys(lyrics || {})) {
          if (key.slice(-suffix.length) !== suffix) continue;
          const entry = lyrics[key];
          // 与歌词脚本一致：命中缓存保留 24 小时；过期条目不能阻止重新预取。
          if (entry && !entry.m && now - Number(entry.t || 0) < 24 * 60 * 60 * 1000) return true;
        }
        return false;
      };

      // color-lyrics 请求阶段登记的「待预取」优先：官方歌词请求还在飞行时，这次
      // connect-state 轮询就并行查第三方歌词，404 响应回来时缓存可能已经写好。
      // 这里不等待查询结果，响应阶段读不到缓存时仍会照常自己查，不会拖慢歌词页。
      const pendingRaw = store.read("spotify.lyrics.pending");
      const pending = pendingRaw ? JSON.parse(pendingRaw) : null;
      const active = marker("spotify.lyrics.inflight", 8000);
      if (pending && pending.id && now - Number(pending.at) < 10000 &&
          !cached(pending.id) && (!active || active.id !== pending.id)) {
        store.write("", "spotify.lyrics.pending");
        store.write(JSON.stringify({ id: pending.id, at: Date.now() }), "spotify.prefetch.last");
        return { id: pending.id, wait: 1000 };
      }

      const queue = JSON.parse(store.read("spotify.queue") || "null");
      if (!queue || !queue.current) return null;
      const current = queue.current;
      const next = Array.isArray(queue.next) ? queue.next[0] || "" : "";
      const lastRaw = store.read("spotify.prefetch.last");
      const last = lastRaw ? JSON.parse(lastRaw) : null;
      const recent = last && Number(last.at) && now - Number(last.at) < 1500;
      if (!cached(current)) {
        const currentMark = marker("spotify.prefetch.current", 15 * 1000);
        if (!currentMark || currentMark.id !== current) {
          // 连续快速切歌时先让播放状态返回，别每一首都在 connect-state 里等 1.5 秒。
          if (currentMark && recent) return null;
          store.write(JSON.stringify({ id: current, at: Date.now() }), "spotify.prefetch.current");
          store.write(JSON.stringify({ id: current, at: Date.now() }), "spotify.prefetch.last");
          return { id: current, wait: 1500 };
        }
      }
      if (next && next !== current && !cached(next)) {
        const nextMark = marker("spotify.prefetch.next", 45 * 1000);
        if (!nextMark || nextMark.id !== next) {
          store.write(JSON.stringify({ id: next, at: Date.now() }), "spotify.prefetch.next");
          return { id: next, wait: 1000 };
        }
      }
      return null;
    } catch (e) {
      return null;
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

  // connect-state 换歌时预取当前曲目的歌词；当前曲目已经预取过时，在下一次轮询
  // 预取 next_tracks。歌词页和滚动页补卡随后直接命中缓存，不会等第三方源。
  const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsPrefetch : null;
  if (isMeta && /\/connect-state\//.test(url) && prefetchOn && typeof prefetch === "function") {
    const target = prefetchTarget();
    if (target) {
      let settled = false;
      let timer = null;
      const done = () => {
        if (settled) return;
        settled = true;
        if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
        finish();
      };
      if (typeof setTimeout === "function") timer = setTimeout(done, target.wait);
      prefetch(target.id, done);
      return;
    }
  }

  finish();
