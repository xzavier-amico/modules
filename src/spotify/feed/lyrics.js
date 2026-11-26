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
  const LYRICS_SECTION_ID_BYTES = TE.encode(LYRICS_SECTION_ID);

  function scrollTrackId(url) {
    // 路径式 /scroll/spotify:track:{id} 与查询式 /scroll?uri=spotify%3Atrack%3A{id}
    // 都要支持；桌面端两种都出现过。
    const match = /(?:\/scrollsita\/v\d+\/scroll\/|[?&]uri=)(?:spotify%3Atrack%3A|spotify:track:)([A-Za-z0-9]{22})/i.exec(url);
    return match ? match[1] : "";
  }

  // 在 Uint8Array 里用原生 indexOf 搜索 needle；比逐字节 JS 循环在 12MB 响应上快一个数量级。
  function containsBytes(buffer, needle) {
    if (!buffer || !buffer.length || buffer.length < needle.length) return false;
    const firstByte = needle[0];
    const last = buffer.length - needle.length;
    for (let i = buffer.indexOf(firstByte); i >= 0 && i <= last; i = buffer.indexOf(firstByte, i + 1)) {
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
  // open.spotify.com（oEmbed / embed），整条歌词链路跟着变慢。
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
    const hasMeta = typeof globalThis !== "undefined" ? globalThis.__spotifyHasTrackMeta : null;
    if (typeof hasMeta === "function" && hasMeta(trackId)) return;
    const found = { title: "", artist: "" };
    collectMetaPairs(bytes, found, 0, { left: META_WALK_LIMIT });
    if (!found.title) return;
    remember(trackId, found.title, found.artist, 0, null);
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
    let sawTrackRef = false;
    // 认出来的卡片数量：section 里带 section id（23）/ 曲目引用（5）/ 广告内容（30）
    // 才算一列卡片。形状对不上说明这不是滚动页的卡片列表（或者客户端换了结构），
    // 这时插一个 section 进去会把整包结构写坏 —— 客户端解析失败后整页空白，
    // 比「没有歌词卡」严重得多，所以只删广告、不插卡。
    let recognized = 0;
    const trackRef = trackId ? TE.encode("spotify:track:" + trackId) : null;
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
      if (ad || hasTrack || hasSectionId) recognized += 1;
      // 只有非广告的歌词 section 才算已有歌词卡，避免赞助卡误抑制补卡。
      if (!ad && hasTrack && hasSectionId) hasLyrics = true;
      // 当前曲目的 section 里通常带 track_title / artist_name，抄进元数据缓存。
      if (trackRef && hasTrack && containsBytes(section.data, trackRef)) {
        sawTrackRef = true;
        rememberScrollMeta(section.data, trackId);
      }
      if (wantAds && ad) {
        removed++;
        continue;
      }
      kept.push(section.raw);
    }

    // 只往「确实是一列卡片」的响应里插卡：列表形状对不上时插进去会把整包
    // 结构写坏，客户端解析失败后整页空白，比不补卡严重得多。
    // 判定条件放宽到「认出了任意一列卡片」或者「body 里确实有当前曲目的引用」，
    // 后者能兜住客户端换 section 结构、但列表确实属于这首歌的情况。
    const canAdd = !!trackId && !hasLyrics
      && (recognized > 0 || sawTrackRef || (trackRef && containsBytes(buffer, trackRef)));
    const addCard = canAdd && (typeof wantCard === "function" ? !!wantCard() : !!wantCard);
    if (!removed && !addCard) return null;
    if (addCard) kept.unshift(wireEncodeField(1, 2, lyricsSection(trackId)));

    const rebuilt = wireEncodeField(1, 2, wireConcat(kept));
    const parts = [];
    for (const f of top) parts.push(f === structure ? rebuilt : f.raw);
    const out = wireConcat(parts);
    return wireEqual(out, buffer) ? null : out;
  }
