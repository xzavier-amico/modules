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

  // 滚动页的歌词卡：客户端渲染完 Now Playing 列表后，不会因为 color-lyrics
  // 拿到了歌词就回头补一格；第一次响应里少了这一格，往往要最小化 / 最大化
  // 重新渲染才出现。所以这里「卡住」scrollsita 等歌词结果，但轮询的是
  // color-lyrics / connect-state 已经写好的标志位（spotify.lyrics.cache），
  // 不再自己另起一次第三方查询和 color-lyrics 抢时间：
  //   * 标志位已有歌词   -> 立即补卡，内容就绪（最常见，实际零等待）；
  //   * 确认没歌词       -> 不补卡，不会出现空卡；
  //   * 等满窗口还没结果 -> 乐观补卡，内容随后由 color-lyrics 请求填充。
  // 4.5 秒只是上限：歌词已就绪时第一次读就返回，pending 标记还会让官方请求
  // 飞行期间的 connect-state 轮询并行去查，通常远不到上限就结束等待。
  // 仍要留超时兜底，避免「客户端看到歌词卡才请求 color-lyrics」时互相等死。
  // Eevee 里没有可抄的官方超时，按真机补卡成功率调整这两个常量即可。
  const CARD_WAIT_MS = 4500;
  const CARD_POLL_MS = 200;
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
      }, CARD_WAIT_MS, CARD_POLL_MS);
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
