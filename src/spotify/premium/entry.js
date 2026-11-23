  // 入口：bootstrap / UCS / 元数据 / 远程配置 / 账号属性。
  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || null;
  const url = (res && res.url) || req.url || "";

  // 请求阶段只做一件事：抹掉 extended-metadata 请求体里的 etag。
  if (!res) {
    if (lyricsOn) stripRequestEtags(req, url);
    else $done({});
    return;
  }

  const status = Number(res.status || res.statusCode);
  if (status >= 300) {
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
  if (isMeta) enabled = lyricsOn;
  else if (isConfig || isAttr) enabled = spoof || adsOn;
  else enabled = desktop ? spoof || adsOn : spoof;
  if (!enabled) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  // JSON 响应（桌面端 nebula 属性 / 远程配置）有些客户端直接把字符串交过来，
  // 这里统一转成字节，后面的 JSON / protobuf 分流都按字节处理。
  else if (typeof body === "string") body = WIRE_TEXT.encode(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  const maxBytes = isMeta
    ? /\/(?:context-resolve|connect-state)\//.test(url) ? MAX_CONTEXT_BYTES : MAX_META_BYTES
    : isConfig || isAttr ? MAX_FEED_BYTES : MAX_BOOTSTRAP_BYTES;
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

  const finish = () => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    // 只换 body 时必须把原响应头带上：桌面端（CEF）对这些接口是跨域 fetch，
    // 丢掉 Access-Control-Allow-Origin 整条请求会被浏览器拦掉。has_lyrics 查询
    // 就是这么废的——元数据改写成功、客户端却以为这首歌没有歌词。
    const headers = {};
    const source = res && res.headers;
    if (source && "object" == typeof source) {
      for (const key in source) {
        const lower = String(key).toLowerCase();
        if (lower === "content-length" || lower === "content-encoding"
          || lower === "transfer-encoding") continue;
        headers[key] = source[key];
      }
    }
    let hasOrigin = false;
    for (const key in headers) {
      if (String(key).toLowerCase() === "access-control-allow-origin") hasOrigin = true;
    }
    if (!hasOrigin) {
      const origin = headerValue(req && req.headers, "origin");
      headers["Access-Control-Allow-Origin"] = origin || "*";
      if (origin) {
        headers["Access-Control-Allow-Credentials"] = "true";
        headers["Vary"] = "Origin";
      }
    }
    headers["Content-Length"] = String(out.length);
    $done({ status: status || 200, headers: headers, body: out });
  };

  finish();
