  function handleYouTubeiResponse() {
    try {
      const route = $request.url.split("?")[0].split("/youtubei/v1/")[1];
      const handler = Object.hasOwn(RESPONSE_ROUTES, route) && RESPONSE_ROUTES[route];
      const body = toBytes($response.body);
      if (!handler || Number($response.status) >= 300 || !body?.length || body.length > MAX_RESPONSE_BYTES) {
        $done({});
        return;
      }

      const [typeName, rewrite] = handler;
      const codec = messageCodec(typeName);
      const node = codec.fromBinary(body);
      const options = readOptions();
      if (isMusicRequest($request) && false === options.youtubeMusic) {
        $done({});
        return;
      }

      if (false !== options.autoHd) {
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

      const contentType = Object.entries($response.headers ?? {}).find(([key]) => "content-type" === key.toLowerCase())?.[1];
      if (contentType && !/^application\/vnd\.yt-ump(?:\s*;|\s*$)/i.test(contentType)) {
        $done({});
        return;
      }

      const options = readOptions();
      if (isMusicRequest($request) && false === options.youtubeMusic) {
        $done({});
        return;
      }
      const stored = readStore()[clientKeyFor($request)];
      // clientKey 本身就是 32 字节：前 16 字节做 AES-256 密钥，后 16 字节做 HMAC 密钥。
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
      if (false !== options.autoHd) updateQualityCache(result.players, options);
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
