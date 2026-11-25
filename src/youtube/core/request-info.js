  const WEB_HOST_RE = /^https?:\/\/(?:www|m|music)\.youtube\.com(?:\/|$)/i;
  const MUSIC_HOST_RE = /^https?:\/\/music\.youtube\.com(?:\/|$)/i;

  let cachedReqInfoRef = null;
  let cachedReqInfo = null;

  function inspectRequest(request) {
    if (request && request === cachedReqInfoRef) return cachedReqInfo;
    const url = String(request?.url ?? "");
    let isMusic = MUSIC_HOST_RE.test(url);
    let isWeb = WEB_HOST_RE.test(url);
    const headers = request?.headers;
    if (headers && (!isMusic || !isWeb)) {
      for (const key in headers) {
        if (!Object.hasOwn(headers, key)) continue;
        const name = key.toLowerCase();
        const text = String(headers[key] ?? "");
        if (!isMusic) {
          if ("user-agent" === name && /music/i.test(text)) isMusic = true;
          // WEB_REMIX（YouTube Music Web/iOS 的 InnerTube 客户端）的 client-name 是 67。
          else if ("x-youtube-client-name" === name && ("67" === text.trim() || /music|remix/i.test(text))) isMusic = true;
          else if ("x-youtube-client-version" === name && /music|remix/i.test(text)) isMusic = true;
          else if (("origin" === name || "referer" === name) && MUSIC_HOST_RE.test(text)) isMusic = true;
        }
        if (!isWeb && ("origin" === name || "referer" === name) && WEB_HOST_RE.test(text)) isWeb = true;
        if (isMusic && isWeb) break;
      }
    }
    const info = { isMusic, isWeb };
    if (request && "object" == typeof request) {
      cachedReqInfoRef = request;
      cachedReqInfo = info;
    }
    return info;
  }

  // 判断请求是不是 YouTube Music（iOS App 的 UA / client-name，以及网页版 URL / Origin / Referer）。
  function isMusicRequest(request) {
    return inspectRequest(request).isMusic;
  }

  // 网页版 YouTube / YouTube Music；含从网页发往 googlevideo.com 的播放请求（看 Origin / Referer）。
  function isWebRequest(request) {
    return inspectRequest(request).isWeb;
  }

  function clientKeyFor(request) {
    const info = inspectRequest(request);
    if (info.isWeb) return info.isMusic ? "youtubeMusicWeb" : "youtubeWeb";
    return info.isMusic ? "youtubeMusic" : "youtube";
  }
