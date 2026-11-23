  //=====================================================================================
  // §9 画质缓存
  //
  // 从 player 响应里挑出每个视频可用的 itag 存起来，videoplayback 请求时按 id 取用。
  //=====================================================================================

  function updateQualityCache(players, options) {
    if (!players.length) return;

    const maxHeight = Math.max(144, Math.min(4320, parseInt(options.maxHeight, 10) || 4320));
    const codec = options.videoCodec ?? "any";
    const metadata = players.map((player) => unknownFields(player).find((field) => 4 === field.no && 2 === field.wire)?.data).filter(Boolean);
    if (!metadata.length) return;

    let cache;
    try {
      cache = readStore(QUALITY_KEY, MAX_QUALITY_JSON);
    } catch (e) {
      return;
    }

    const next = Object.create(null);
    let dirty = false;
    const keys = Object.keys(cache);
    if (keys.length > MAX_QUALITY_ENTRIES) dirty = true;

    for (const videoId of keys.slice(-MAX_QUALITY_ENTRIES)) {
      const entry = cache[videoId];
      if (videoId.length > 256 || !isQualityEntry(entry) || entry.height > maxHeight || (entry.codec ?? "any") !== codec) {
        dirty = true;
      } else {
        next[videoId] = { height: entry.height, itags: entry.itags };
        if ("any" !== codec) next[videoId].codec = codec;
        if (entry.premiumItags?.length) next[videoId].premiumItags = entry.premiumItags;
        if (Object.keys(entry).length !== Object.keys(next[videoId]).length) dirty = true;
      }
    }

    for (const bytes of metadata) {
      try {
        const urlBytes = fieldData(bytes, 15);
        const match = urlBytes && /[?&]id=([^&]+)/.exec(looseUtf8.decode(urlBytes));
        if (!match) continue;

        const videoId = decodeURIComponent(match[1]);
        const entry = { height: 0, itags: [] };
        if ("any" !== codec) entry.codec = codec;
        if (videoId.length > 256) continue;

        const seen = new Set();
        let truncated = false;
        wireForEachField(bytes, (no, wire, dataStart, dataEnd) => {
          if (3 !== no || 2 !== wire) return false;
          const formatBytes = bytes.subarray(dataStart, dataEnd);
          let itag = 0;
          let width = 0;
          let rawHeight = 0;
          let mimeBytes;
          let premiumBytes;

          wireForEachField(formatBytes, (fno, fwire, fStart, fEnd) => {
            if (0 === fwire) {
              if (1 === fno && !itag) itag = readVarintValue(formatBytes.subarray(fStart, fEnd));
              else if (7 === fno && !width) width = readVarintValue(formatBytes.subarray(fStart, fEnd));
              else if (8 === fno && !rawHeight) rawHeight = readVarintValue(formatBytes.subarray(fStart, fEnd));
            } else if (2 === fwire) {
              if (5 === fno && !mimeBytes) mimeBytes = formatBytes.subarray(fStart, fEnd);
              else if (26 === fno && !premiumBytes) premiumBytes = formatBytes.subarray(fStart, fEnd);
            }
            return false;
          });

          if (!mimeBytes) return false;
          const mimeText = looseUtf8.decode(mimeBytes);
          if (!mimeText.startsWith("video/") || !codecAllowed(mimeText, codec)) return false;

          const height = Math.min(width, rawHeight);
          if (!itag || !height || height > 2147483647 || height > maxHeight || height < entry.height) return false;

          if (height > entry.height) {
            entry.height = height;
            entry.itags = [];
            delete entry.premiumItags;
            seen.clear();
            truncated = false;
          }
          if (truncated || seen.has(itag)) return false;
          if (256 === seen.size) {
            truncated = true;
            return false;
          }

          seen.add(itag);
          entry.itags.push(itag);
          if (premiumBytes && /\bPremium\b/i.test(looseUtf8.decode(premiumBytes))) (entry.premiumItags ??= []).push(itag);
          return false;
        });

        if (truncated || !isQualityEntry(entry) || sameQuality(next[videoId], entry)) continue;
        delete next[videoId];
        next[videoId] = entry;
        dirty = true;
      } catch (e) {
        // 单条画质记录异常不影响其它记录。
      }
    }

    if (!dirty) return;

    const trimmed = Object.keys(next);
    for (const videoId of trimmed.slice(0, Math.max(0, trimmed.length - MAX_QUALITY_ENTRIES))) delete next[videoId];

    try {
      let json = JSON.stringify(next);
      while (textEncoder.encode(json).length > MAX_QUALITY_JSON) {
        delete next[Object.keys(next)[0]];
        json = JSON.stringify(next);
      }
      $persistentStore.write(json, QUALITY_KEY);
    } catch (e) {
      // 存不进去就算了，不影响本次播放。
    }
  }
