  // 判断请求是不是 YouTube Music（iOS App 的 UA / client-name 都带 music）。
  function isMusicRequest(request) {
    if (/^https?:\/\/music\.youtube\.com\//i.test(String(request?.url ?? ""))) return true;
    for (const [key, value] of Object.entries(request?.headers ?? {})) {
      const name = key.toLowerCase();
      const text = String(value ?? "");
      if ("user-agent" === name && /music/i.test(text)) return true;
      // WEB_REMIX（YouTube Music Web/iOS 的 InnerTube 客户端）的 client-name 是 67。
      if ("x-youtube-client-name" === name && ("67" === text.trim() || /music|remix/i.test(text))) return true;
      if ("x-youtube-client-version" === name && /music|remix/i.test(text)) return true;
    }
    return false;
  }

  // 网页版 YouTube / YouTube Music。移动网页最终也会落到 www.youtube.com。
  function isWebRequest(request) {
    return /^https?:\/\/(?:www|m|music)\.youtube\.com\//i.test(String(request?.url ?? ""));
  }

  function clientKeyFor(request) {
    return isMusicRequest(request) ? "youtubeMusic" : "youtube";
  }
