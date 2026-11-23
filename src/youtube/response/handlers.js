  function responseHeader(name) {
    const headers = $response.headers ?? {};
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === name) return String(value ?? "");
    }
    return "";
  }

  // 网页版 youtubei 返回 JSON；不能拿 protobuf 解码器硬解。
  function responseLooksJson(raw) {
    if ("string" == typeof raw) return /^\s*[\[{]/.test(raw);
    const bytes = toBytes(raw);
    if (!bytes?.length) return false;
    let i = 0;
    while (i < bytes.length && (32 === bytes[i] || 9 === bytes[i] || 10 === bytes[i] || 13 === bytes[i])) i++;
    return 123 === bytes[i] || 91 === bytes[i];
  }

  function handleYouTubeiJsonResponse(route, raw, options, isMusic) {
    try {
      const text = "string" == typeof raw ? raw : looseUtf8.decode(toBytes(raw));
      if (!text || text.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }
      const data = JSON.parse(text);
      if (!rewriteJsonRoute(route, data, options, isMusic)) {
        $done({});
        return;
      }
      $done({ body: JSON.stringify(data) });
    } catch (e) {
      $done({});
    }
  }

  function handleYouTubeiResponse() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const handler = Object.hasOwn(RESPONSE_ROUTES, route) && RESPONSE_ROUTES[route];
      if (!handler || Number($response.status) >= 300) {
        $done({});
        return;
      }

      // 先做开关检查再解码响应体，避免禁用网页版 / YouTube Music 时白白做整包 JSON.parse 或 protobuf 解码。
      const options = readOptions();
      if (isWebRequest($request) && false === options.web) {
        $done({});
        return;
      }
      const isMusic = isMusicRequest($request);
      if (isMusic && false === options.youtubeMusic) {
        $done({});
        return;
      }

      if (/json/i.test(responseHeader("content-type")) || responseLooksJson($response.body)) {
        handleYouTubeiJsonResponse(route, $response.body, options, isMusic);
        return;
      }

      const body = toBytes($response.body);
      if (!body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const [typeName, rewrite] = handler;
      const codec = messageCodec(typeName);
      const node = codec.fromBinary(body);

      // 画质上限或编码偏好任一开启都要刷新缓存：request 阶段按缓存 itag 改写。
      if (false !== options.autoHd || "any" !== options.videoCodec) {
        const players = (function () {
          if ("Player" === typeName) return [node];
          if ("Watch" === typeName) return node.contents.map((item) => item.player).filter(Boolean);
          if ("ResolveUrl" === typeName) {
            const player = node.endpoint?.watch?.embedded?.response?.player;
            return player ? [player] : [];
          }
          return [];
        })();
        updateQualityCache(players, options);
      }

      $done(rewrite(node, options) ? { body: codec.toBinary(node) } : {});
    } catch (e) {
      $done({});
    }
  }

  async function handleUmpResponse() {
    try {
      const body = toBytes($response.body);
      if (Number($response.status) >= 300 || !body?.length || body.length > MAX_UMP_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const contentType = responseHeader("content-type");
      if (contentType && !/^application\/vnd\.yt-ump(?:\s*;|\s*$)/i.test(contentType)) {
        $done({});
        return;
      }

      const options = readOptions();
      if (isWebRequest($request) && false === options.web) {
        $done({});
        return;
      }
      if (isMusicRequest($request) && false === options.youtubeMusic) {
        $done({});
        return;
      }
      const stored = readStore()[clientKeyFor($request)];
      // clientKey 本身就是 32 字节：前 16 字节做 AES-128-CTR 密钥，后 16 字节做 HMAC-SHA256 密钥。
      // encryptKey 只用来校验 initplayback 请求体，不参与解密。
      const keys = (stored ? [stored, ...(Array.isArray(stored.previous) ? stored.previous.slice(0, 3) : [])] : [])
        .filter(
          (entry) =>
            entry &&
            "string" == typeof entry.clientKey &&
            "string" == typeof entry.encryptKey &&
            entry.clientKey.length > 0 &&
            entry.clientKey.length <= 5500 &&
            entry.encryptKey.length > 0 &&
            entry.encryptKey.length <= 5500,
        )
        .map((entry) => base64ToBytes(entry.clientKey))
        .filter((key) => key.length >= 16);
      if (!keys.length) throw new Error("YouTubeConfig requires a valid stored clientKey");

      const result = await decryptUmp(body, options, keys);
      if (false !== options.autoHd || "any" !== options.videoCodec) updateQualityCache(result.players, options);
      $done(result.body === body ? {} : { body: result.body });
    } catch (e) {
      // 运行时缺少 CompressionStream / DecompressionStream（部分 Shadowrocket 版本）时，
      // 回空响应会让视频直接播不了；原样放行，最多是 UMP 段广告没去掉。
      if ("undefined" == typeof CompressionStream || "undefined" == typeof DecompressionStream) {
        $done({});
        return;
      }
      $done({ status: 200, headers: { "Content-Type": "text/plain" }, body: new Uint8Array() });
    }
  }
