  //=====================================================================================
  // §11 请求改写
  //=====================================================================================

  function emptyProtobufResponse() {
    return { response: { status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: new Uint8Array() } };
  }

  function readRequestBody(request) {
    const body = request.body;
    if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    if (body?.length) throw new Error("YouTube requires binary-body-mode for request bodies");
    const contentLength = Object.entries(request.headers ?? {}).find(([key]) => "content-length" === key.toLowerCase())?.[1];
    if (Number(contentLength) > 0) throw new Error("YouTube request body unavailable; requires-body must be enabled");
  }

  // 把请求里的 itag 相关字段改成缓存里的目标值；quality 为空表示只要最高分辨率。
  function applyQuality(bytes, quality) {
    const targets = new Map(
      quality
        ? [
            [13, 0],
            [14, 2],
            [16, quality.height],
            [21, quality.height],
            [26, 3],
            [30, 0],
          ]
        : [
            [16, Math.max(144, Math.min(4320, parseInt(readOptions().maxHeight) || 4320))],
            [26, 1],
            [30, 0],
          ],
    );

    const touched = new Set();
    const parts = [];
    let changed = false;

    for (const field of parseFields(bytes)) {
      const target = 0 === field.wire ? targets.get(field.no) : void 0;
      if (void 0 !== target) {
        if (readVarintValue(field.data) === target) {
          parts.push(field.raw);
        } else {
          parts.push(encodeVarint(8 * field.no), encodeVarint(target));
          changed = true;
        }
        touched.add(field.no);
      } else {
        parts.push(field.raw);
      }
    }

    for (const [fieldNo, value] of targets) {
      if (!touched.has(fieldNo)) {
        parts.push(encodeVarint(8 * fieldNo), encodeVarint(value));
        changed = true;
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }

  function removeStoredKey(key, stored) {
    if (void 0 === key || void 0 === stored) return;
    const config = readStore();
    if (!Object.hasOwn(config, key)) return;
    if (JSON.stringify(config[key]) === JSON.stringify(stored)) {
      delete config[key];
      writeStore(config);
    }
  }

  // initplayback 请求：校验请求里带的密钥是不是我们存的；不匹配就回空，让客户端重协商。
  function handleInitPlaybackRequest(request, options) {
    const body = readRequestBody(request);
    if (void 0 === body || 0 === body.length) return undefined;

    const key = clientKeyFor(request);
    const stored = readStore()[key];
    const outer = fieldData(body, 3);
    const inner = outer && fieldData(outer, 5);
    if (!inner?.length) return emptyProtobufResponse();

    const candidates = stored
      ? [stored, ...(Array.isArray(stored.previous) ? stored.previous.slice(0, 3) : [])].filter(
          (entry) =>
            entry &&
            "string" == typeof entry.clientKey &&
            "string" == typeof entry.encryptKey &&
            entry.clientKey.length > 0 &&
            entry.clientKey.length <= 5500 &&
            entry.encryptKey.length > 0 &&
            entry.encryptKey.length <= 5500,
        )
      : [];
    for (const entry of candidates) {
      try {
        if (bytesEqual(inner, base64ToBytes(entry.encryptKey))) return undefined;
      } catch {}
    }

    removeStoredKey(key, stored);
    return emptyProtobufResponse();
  }

  // 只有一条 chunk 的 initplayback 请求：把画质字段改成最高档。
  function rewriteInitPlaybackBody(body) {
    const fields = parseFields(body);
    const chunks = fields.filter((field) => 2 === field.no && 2 === field.wire);
    if (1 !== chunks.length) return body;

    const chunk = chunks[0];
    const next = applyQuality(chunk.data, void 0);
    if (next === chunk.data) return body;
    return concatBytes(fields.map((field) => (field === chunk ? concatBytes([encodeVarint(18), encodeVarint(next.length), next]) : field.raw)));
  }

  // videoplayback 请求：按缓存挑一组 itag，替换请求里的 17 号字段。
  function rewriteVideoPlaybackBody(body, url) {
    const fields = parseFields(body);

    const quality = (function () {
      try {
        const match = /[?&]id=([^&]+)/.exec(url);
        if (!match) return;

        const chunk = fields.find((field) => 5 === field.no && 2 === field.wire);
        const inner = chunk && fieldData(chunk.data, 1);
        if (!inner?.length) return;

        const cached = readStore(QUALITY_KEY, MAX_QUALITY_JSON)?.[decodeURIComponent(match[1])];
        if (!isQualityEntry(cached)) return;

        const formats = [];
        const premiumFormats = [];
        for (const format of parseFields(inner)) {
          if (6 !== format.no || 2 !== format.wire) continue;
          const itagField = parseFields(format.data).find((field) => 1 === field.no && 0 === field.wire);
          if (!itagField) continue;
          const itag = readVarintValue(itagField.data);
          if (!cached.itags.includes(itag)) continue;
          formats.push(format.data);
          if (cached.premiumItags?.includes(itag)) premiumFormats.push(format.data);
        }
        return formats.length ? { height: cached.height, formats: premiumFormats.length && false !== readOptions().preferPremium ? premiumFormats : formats } : void 0;
      } catch {
        return;
      }
    })();

    const existing = fields.filter((field) => 17 === field.no && 2 === field.wire);
    const replaceFormats = quality && (existing.length !== quality.formats.length || existing.some((field, i) => !bytesEqual(field.data, quality.formats[i])));

    const parts = [];
    let sawChunk = false;
    let changed = !!replaceFormats;

    for (const field of fields) {
      if (1 === field.no && 2 === field.wire) {
        const next = applyQuality(field.data, quality);
        if (next === field.data) {
          parts.push(field.raw);
        } else {
          parts.push(encodeVarint(10), encodeVarint(next.length), next);
          changed = true;
        }
        sawChunk = true;
      } else {
        if (replaceFormats && 17 === field.no && 2 === field.wire) continue;
        parts.push(field.raw);
      }
    }

    if (!sawChunk) {
      const empty = applyQuality(new Uint8Array(), quality);
      parts.push(encodeVarint(10), encodeVarint(empty.length), empty);
      changed = true;
    }
    if (replaceFormats) {
      for (const format of quality.formats) parts.push(encodeVarint(138), encodeVarint(format.length), format);
    }
    return changed ? concatBytes(parts) : body;
  }

  // log_event 请求：删掉热更新哈希头，避免服务端用新配置覆盖模块。
  function stripHotHashHeader(request, options) {
    if (false === options.stripHotHash) return undefined;

    const headers = Object.keys(request.headers ?? {}).filter((key) => "x-youtube-hot-hash-data" === key.toLowerCase());
    if (!headers.length || readStore()[clientKeyFor(request)]?.clientKey) return undefined;

    const next = { ...request.headers };
    for (const key of headers) delete next[key];
    return { headers: next };
  }

  function handleRequest(request) {
    const path = request.url.split("?")[0];

    try {
      // 参数解析也放进 try：任何异常都不能让 ad_break 漏过去。
      const options = readOptions();
      const musicDisabled = isMusicRequest(request) && false === options.youtubeMusic;

      if (path.endsWith("/ad_break")) {
        $done(!musicDisabled && false !== options.blockPlayerAds ? emptyProtobufResponse() : undefined);
        return;
      }
      if (path.endsWith("/log_event")) {
        $done(stripHotHashHeader(request, options));
        return;
      }
      if (path.endsWith("/initplayback")) {
        if (musicDisabled) {
          $done(undefined);
          return;
        }
        let result = handleInitPlaybackRequest(request, options);
        const body = readRequestBody(request);
        if (!result && body?.length && false !== options.autoHd) {
          const rewritten = rewriteInitPlaybackBody(body);
          if (rewritten !== body) result = { body: rewritten };
        }
        $done(result);
        return;
      }
      if (path.endsWith("/videoplayback")) {
        if (musicDisabled) {
          $done(undefined);
          return;
        }
        const body = false === options.autoHd ? undefined : readRequestBody(request);
        if (body?.length) {
          const rewritten = rewriteVideoPlaybackBody(body, request.url);
          $done(rewritten !== body ? { body: rewritten } : undefined);
          return;
        }
      }
      $done(undefined);
    } catch (e) {
      // ad_break / initplayback 失败时也要给出空响应，避免退回服务端广告或原始数据。
      $done(path.endsWith("/ad_break") || path.endsWith("/initplayback") ? emptyProtobufResponse() : {});
    }
  }
