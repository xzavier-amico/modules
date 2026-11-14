  // 日志与曲名标签由 lyrics.js 的辅助模式通过 globalThis 暴露；没有时静默降级。
  // 定义在这里而不是 entry.js：补卡、元数据回填的排障日志都在本文件里。
  const spotifyLog = (typeof globalThis !== "undefined" && globalThis.__spotifyLog) || (() => {});
  const trackLabel = (typeof globalThis !== "undefined" && globalThis.__spotifyTrackLabel) || ((id) => id || "?");
  const debugOn = !!(typeof globalThis !== "undefined" && globalThis.__spotifyDebug);

  // ------------------------------------------------------------ lyrics card
  //
  // 歌词卡是 Now Playing 滚动列表里的一格：列表里必须存在一个「歌词 section」，
  // 客户端才会把这一格排进卡片列表。结构：
  //
  //   section { field 5 { field 1: "spotify:track:{id}" }
  //             field 23 { field 1: "spotify:section:{section_id}" } }
  //
  // 官方没有歌词的曲目，服务端不下发这一格。这里按真实形状补一格，section id
  // 复用真实歌词 section 的值；只补当前曲目的列表，已有歌词 section 时不重复补。
  const LYRICS_SECTION_ID = "spotify:section:0JQ5DB6s3cssW5Bo6cGq21";
  const LYRICS_SECTION_ID_BYTES = new TextEncoder().encode(LYRICS_SECTION_ID);

  function scrollTrackId(url) {
    const match = /\/scrollsita\/v\d+\/scroll\/(?:spotify%3Atrack%3A|spotify:track:)([A-Za-z0-9]{22})/i.exec(url);
    return match ? match[1] : "";
  }

  // 在 Uint8Array 里搜索 needle；命中返回 true。hasLyricsCard 和 patchScroll 共用。
  function containsBytes(buffer, needle) {
    if (!buffer || !buffer.length || buffer.length < needle.length) return false;
    const last = buffer.length - needle.length;
    for (let i = 0; i <= last; i += 1) {
      if (buffer[i] !== needle[0]) continue;
      let j = 1;
      while (j < needle.length && buffer[i + j] === needle[j]) j += 1;
      if (j === needle.length) return true;
    }
    return false;
  }

  // 补卡前先做一次廉价的字节扫描：列表里已经有歌词 section 时不用去查歌词，
  // 避免每首官方有歌词的歌都白等一次第三方查询。patchScroll 内部也用同样的
  // 检测判断是否已有歌词 section，保持入口与补卡逻辑一致。
  function hasLyricsCard(buffer) {
    return containsBytes(buffer, LYRICS_SECTION_ID_BYTES);
  }

  function lyricsSection(trackId) {
    return serialize([
      fieldBytes(5, serialize([fieldString(1, "spotify:track:" + trackId)])),
      fieldBytes(23, serialize([fieldString(1, LYRICS_SECTION_ID)])),
    ]);
  }

  // ---- 曲目元数据回填 ---------------------------------------------------
  //
  // 歌词脚本取曲名 / 歌手要先读 spotify.track.meta；没命中就只能回源
  // open.spotify.com（oEmbed / embed，实测 2.6s），整条歌词链路跟着变慢。
  // scrollsita 的当前曲目 section 里本来就带着 track_title / artist_name
  // 的 metadata map，顺手抄一份写进同一个缓存：下次同一首再进 Now Playing
  // 就是零请求。
  //
  // 只在「section 里确实有当前曲目的 track 引用」时递归，并且限制遍历节点数，
  // 避免把 12MB 的列表整个走一遍。
  const META_TITLE_KEYS = ["track_title", "title", "track_name"];
  const META_ARTIST_KEYS = ["artist_name", "artist"];
  const META_WALK_LIMIT = 4000;

  function collectMetaPairs(bytes, found, depth, budget) {
    if (depth > 6 || budget.left <= 0) return;
    let fields;
    try {
      fields = parse(bytes);
    } catch (e) {
      return;
    }
    if (!fields) return;
    budget.left -= fields.length;
    // metadata map 的一项：{ 1: key, 2: value }
    if (fields.length === 2 && fields[0].w === 2 && fields[1].w === 2) {
      const key = fields[0].no === 1 ? text(fields[0]) : null;
      const value = fields[1].no === 2 ? text(fields[1]) : null;
      if (key && value && value.length <= 200) {
        if (!found.title && META_TITLE_KEYS.indexOf(key) >= 0) found.title = value;
        else if (!found.artist && META_ARTIST_KEYS.indexOf(key) >= 0) found.artist = value;
      }
    }
    if (found.title && found.artist) return;
    for (const f of fields) {
      if (f.w !== 2 || !f.p || f.p.length < 2) continue;
      collectMetaPairs(f.p, found, depth + 1, budget);
      if (found.title && found.artist) return;
    }
  }

  function rememberScrollMeta(bytes, trackId) {
    const remember = typeof globalThis !== "undefined" ? globalThis.__spotifyRememberTrackMeta : null;
    if (typeof remember !== "function" || !trackId) return;
    const found = { title: "", artist: "" };
    collectMetaPairs(bytes, found, 0, { left: META_WALK_LIMIT });
    if (!found.title) {
      spotifyLog("feed.meta", "track=" + trackId + " title=-");
      return;
    }
    spotifyLog("feed.meta", "track=" + trackId + " title=" + found.title + " artist=" + (found.artist || "-"));
    remember(trackId, found.title, found.artist, 0, null);
  }

  // ---- 排障：列表结构 ---------------------------------------------------
  //
  // 卡片补进去了但客户端不显示时，要能回答两个问题：真实的 section 长什么样、
  // 我们插在第几位。debug_log 打开时把每个 section 的字段号压成一行，
  // 官方歌词 section 存在时再打一份 hex，用来和 lyricsSection() 逐字节对比。
  function hexOf(bytes, limit) {
    let out = "";
    const size = Math.min(bytes.length, limit || 240);
    for (let i = 0; i < size; i += 1) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out + (bytes.length > size ? "…(" + bytes.length + "B)" : "");
  }

  function describeSections(sections) {
    const parts = [];
    const limit = Math.min(sections.length, 8);
    for (let i = 0; i < limit; i += 1) {
      const section = sections[i];
      if (section.no !== 1 || section.wire !== 2) {
        parts.push("#" + section.no);
        continue;
      }
      const nos = [];
      try {
        wireScanFields(section.data, (no) => {
          nos.push(no);
          return nos.length >= 8;
        });
      } catch (e) {
        // 单个 section 解析失败不影响日志
      }
      parts.push(nos.join("+"));
    }
    return sections.length + " [" + parts.join(" | ") + "]";
  }


  // 滚动页一次遍历：删广告 section + 补歌词 section。
  //
  // 只重建顶层字段 1 的 payload，保留的 section 和其余字段直接复用原始字节，
  // 不做整包 parse → serialize 校验。10MB 级别的响应在手机上重编码一次就要
  // 好几秒，客户端等不到就先渲染空列表了。
  function patchScroll(buffer, trackId, wantAds, wantCard) {
    if (!buffer || !buffer.length) return null;
    let top;
    let structure = null;
    let sections;
    try {
      top = wireParseFields(buffer);
      for (const f of top) {
        if (f.no === 1 && f.wire === 2) {
          structure = f;
          break;
        }
      }
      if (!structure) return null;
      sections = wireParseFields(structure.data);
    } catch (e) {
      return null;
    }

    const kept = [];
    let removed = 0;
    let hasLyrics = false;
    const trackRef = trackId ? new TextEncoder().encode("spotify:track:" + trackId) : null;
    if (debugOn) {
      const topNos = [];
      for (const f of top) topNos.push(f.no);
      spotifyLog("feed.top", "fields=" + topNos.join("+") + " bytes=" + buffer.length);
      spotifyLog("feed.sections", "track=" + trackId + " " + describeSections(sections));
      // 顶层除字段 1（section 列表）之外的字段也打一份：客户端可能拿它校验
      // 列表（页信息 / section 顺序），补卡时没有同步改。
      for (const f of top) {
        if (f === structure) continue;
        spotifyLog("feed.topfield", "no=" + f.no + " w=" + f.wire + " len=" + f.raw.length + " hex=" + hexOf(f.raw, 64));
      }
      // 每个 section 的前 120 字节：字段号 + 关键字符串足够看清真实结构，
      // 比整包 hex 小得多，也不至于把日志刷爆。
      const dump = Math.min(sections.length, 6);
      for (let i = 0; i < dump; i += 1) {
        const section = sections[i];
        spotifyLog("feed.section", i + " no=" + section.no + " w=" + section.wire + " len=" + section.raw.length
          + " hex=" + hexOf(section.raw, 120));
      }
    }
    for (const section of sections) {
      if (section.no !== 1 || section.wire !== 2) {
        kept.push(section.raw);
        continue;
      }
      let ad = false;
      let hasTrack = false;
      let hasSectionId = false;
      try {
        // 歌词卡同时有字段 5（曲目引用）和字段 23（section id）。
        // 只看字段 5 会把相关推荐、下一首等卡片也误判为歌词卡，导致不补卡。
        wireScanFields(section.data, (no) => {
          if (no === 30) ad = true;
          else if (no === 5) hasTrack = true;
          else if (no === 23) hasSectionId = true;
          return ad && hasTrack && hasSectionId;
        });
      } catch (e) {
        return null;
      }
      // 官方歌词 section 的真实字节：和 lyricsSection() 的合成结果对比用。
      if (hasTrack && hasSectionId) {
        hasLyrics = true;
        if (debugOn) spotifyLog("LYRICS_SECTION_HEX", hexOf(section.raw));
      }
      // 当前曲目的 section 里通常带 track_title / artist_name，抄进元数据缓存。
      if (trackRef && hasTrack && containsBytes(section.data, trackRef)) {
        rememberScrollMeta(section.data, trackId);
      }
      if (wantAds && ad) {
        removed++;
        continue;
      }
      kept.push(section.raw);
    }

    const addCard = wantCard && !!trackId && !hasLyrics;
    if (!removed && !addCard) return null;
    if (addCard) {
      const card = wireEncodeField(1, 2, lyricsSection(trackId));
      // 插在头部 section 之后，而不是列表最前面：Now Playing 的第一个 section
      // 是固定的头部（曲目 + 封面），歌词卡排到它前面会落在头部上面看不见。
      // 没有头部（空列表 / 结构变了）时才退回到第 0 位。
      const at = kept.length ? 1 : 0;
      kept.splice(at, 0, card);
      if (debugOn) {
        spotifyLog("feed.card", "track=" + trackId + " insert=" + at + " removed=" + removed
          + " sections=" + sections.length + "->" + kept.length + " hex=" + hexOf(card));
      }
    }

    const rebuilt = wireEncodeField(1, 2, wireConcat(kept));
    const parts = [];
    for (const f of top) parts.push(f === structure ? rebuilt : f.raw);
    const out = wireConcat(parts);
    return wireEqual(out, buffer) ? null : out;
  }
