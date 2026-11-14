  //=====================================================================================
  // §9 画质缓存
  //
  // 从 player 响应里挑出每个视频可用的 itag 存起来，videoplayback 请求时按 id 取用。
  //=====================================================================================

  function updateQualityCache(players, options) {
    if (!players.length) return;

    const maxHeight = Math.max(144, Math.min(4320, parseInt(options.maxHeight) || 4320));
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
      if (videoId.length > 256 || !isQualityEntry(entry) || entry.height > maxHeight) {
        dirty = true;
      } else {
        next[videoId] = { height: entry.height, itags: entry.itags };
        if (entry.premiumItags?.length) next[videoId].premiumItags = entry.premiumItags;
        if (Object.keys(entry).length !== Object.keys(next[videoId]).length) dirty = true;
      }
    }

    for (const bytes of metadata) {
      try {
        const fields = parseFields(bytes);
        const urlField = fields.find((field) => 15 === field.no && 2 === field.wire);
        const match = urlField && /[?&]id=([^&]+)/.exec(strictUtf8.decode(urlField.data));
        if (!match) continue;

        const videoId = decodeURIComponent(match[1]);
        const entry = { height: 0, itags: [] };
        if (videoId.length > 256) continue;

        const seen = new Set();
        let truncated = false;
        for (const field of fields) {
          if (3 !== field.no || 2 !== field.wire) continue;

          const format = parseFields(field.data);
          const mime = format.find((item) => 5 === item.no && 2 === item.wire);
          if (!mime || !strictUtf8.decode(mime.data).startsWith("video/")) continue;

          const numberField = (fieldNo) => {
            const item = format.find((entry) => entry.no === fieldNo && 0 === entry.wire);
            return item ? readVarintValue(item.data) : 0;
          };
          const height = Math.min(numberField(7), numberField(8));
          const itag = numberField(1);
          if (!itag || !height || height > 2147483647 || height > maxHeight || height < entry.height) continue;

          if (height > entry.height) {
            entry.height = height;
            entry.itags = [];
            delete entry.premiumItags;
            seen.clear();
            truncated = false;
          }
          if (truncated || seen.has(itag)) continue;
          if (256 === seen.size) {
            truncated = true;
            continue;
          }

          seen.add(itag);
          entry.itags.push(itag);
          const premium = format.find((item) => 26 === item.no && 2 === item.wire);
          if (premium && /\bPremium\b/i.test(strictUtf8.decode(premium.data))) (entry.premiumItags ??= []).push(itag);
        }

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
      writeStore(next, QUALITY_KEY);
    } catch (e) {
      // 存不进去就算了，不影响本次播放。
    }
  }
