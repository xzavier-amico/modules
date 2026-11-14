  // -------------------------------------------------------- content ad slots
  // 过滤首页 / 搜索 / 滚动页响应里的赞助内容。所有函数在结构异常时返回 null，
  // 调用方随即原样放行。

  const HOME_AD_NAME = /\|(?:brand-ad|hpto|[a-z0-9-]*-ad)$/;
  const HOME_AD_FIELDS = new Set([20, 21]);

  function describeHomeSection(section) {
    const fields = parse(section);
    if (!fields || !fields.length) return null;
    const header = fields[0];
    if (!header || header.no !== 1 || header.w !== 2) return null;
    const name = text(header);
    if (name === null) return null;
    let contentField = -1;
    if (fields.length > 1) contentField = fields[1].no;
    return { name: name, contentField: contentField };
  }

  function isHomeAd(info) {
    if (!info) return false;
    return HOME_AD_NAME.test(info.name) || HOME_AD_FIELDS.has(info.contentField);
  }

  // 首页（casita/v1/home）与搜索 / 浏览页（browsita/v1/browse）的 section 列表
  // 结构相同：顶层字段 1 = repeated { 1: section }，section 里 1 = 名称、2 = 内容。
  // 只丢掉名字以 -ad 结尾（或无名字但内容字段是 20/21）的 section，其余原样保留。
  function filterSectionList(list) {
    let sections;
    try {
      sections = wireParseFields(list);
    } catch (e) {
      return null;
    }
    const kept = [];
    let removed = 0;
    for (const section of sections) {
      if (section.wire === 2) {
        let info = null;
        try {
          info = describeHomeSection(section.data);
        } catch (e) {
          info = null;
        }
        if (isHomeAd(info)) {
          removed++;
          continue;
        }
      }
      kept.push(section.raw);
    }
    return removed ? wireConcat(kept) : null;
  }

  function stripSectionAds(buffer) {
    if (!buffer || !buffer.length) return null;
    let fields;
    try {
      fields = wireParseFields(buffer);
    } catch (e) {
      return null;
    }
    let changed = false;
    const parts = [];
    for (const field of fields) {
      if (field.no === 1 && field.wire === 2) {
        const list = filterSectionList(field.data);
        if (list) {
          parts.push(wireEncodeField(1, 2, list));
          changed = true;
          continue;
        }
      }
      parts.push(field.raw);
    }
    return changed ? wireConcat(parts) : null;
  }

  // 兼容旧入口：首页与浏览页共用同一套 section 过滤。
  function stripHomeAds(buffer) {
    return stripSectionAds(buffer);
  }

  const BROWSE_AD_FIELD = 6;
  const BROWSE_AD_MIN_SIZE = 12000;
  const BROWSE_AD_MAX_DEPTH = 4;

  // 搜索页的赞助内容是较大的字段 6；改号为未知字段 1000，让客户端跳过。
  // 直接在原始字节上重写，未命中的字段连同原始 tag / 长度原样保留：
  // 既不会因为非规范 varint 被整包放弃，也不会漏掉第二个及以后的广告字段。
  function renameDeepField(buffer, depth) {
    let fields;
    try {
      fields = wireParseFields(buffer);
    } catch (e) {
      return null;
    }
    let changed = false;
    const parts = [];
    for (const field of fields) {
      if (field.wire === 2) {
        if (field.no === BROWSE_AD_FIELD && field.data.length > BROWSE_AD_MIN_SIZE) {
          parts.push(wireEncodeField(1000, 2, field.data));
          changed = true;
          continue;
        }
        if (depth < BROWSE_AD_MAX_DEPTH) {
          const inner = renameDeepField(field.data, depth + 1);
          if (inner) {
            parts.push(wireEncodeField(field.no, 2, inner));
            changed = true;
            continue;
          }
        }
      }
      parts.push(field.raw);
    }
    return changed ? wireConcat(parts) : null;
  }

  function hideBrowseAds(buffer) {
    if (!buffer || !buffer.length) return null;
    // 先按 section 名字删（和首页同一套规则），再处理深层的超大赞助字段。
    let out = stripSectionAds(buffer);
    if (buffer.length <= BROWSE_AD_MIN_SIZE) return out;
    const renamed = renameDeepField(out || buffer, 0);
    if (renamed) out = renamed;
    return out;
  }

  // 滚动页的赞助卡是整整一个 section：section 里通常只有 section id（字段 23）和
  // 广告内容（字段 30）。这里直接丢掉整个 section，让列表和客户端的卡片数一起少
  // 一项，避免留下「有 id、没有内容」的空卡片。实际拼接在 feed/lyrics.js 的
  // patchScroll 里和补歌词 section 一起做，只遍历一次。
  // 服务端在歌词查询完成后传入 trackId / wantCard；客户端则由 feed/entry.js 在
  // 预热歌词缓存后传入。默认只删广告，保持旧调用方的行为。
  function hideScrollAds(buffer, trackId, wantCard) {
    return patchScroll(buffer, trackId || "", true, !!wantCard);
  }
