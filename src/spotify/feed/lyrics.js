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

  function scrollTrackId(url) {
    const match = /\/scrollsita\/v\d+\/scroll\/(?:spotify%3Atrack%3A|spotify:track:)([A-Za-z0-9]{22})/i.exec(url);
    return match ? match[1] : "";
  }

  function lyricsSection(trackId) {
    return serialize([
      fieldBytes(5, serialize([fieldString(1, "spotify:track:" + trackId)])),
      fieldBytes(23, serialize([fieldString(1, LYRICS_SECTION_ID)])),
    ]);
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
    for (const section of sections) {
      if (section.no !== 1 || section.wire !== 2) {
        kept.push(section.raw);
        continue;
      }
      let ad = false;
      let card = false;
      try {
        // 只扫字段号：看到 30（广告内容）或 5（曲目）就够判断了。
        wireScanFields(section.data, (no) => {
          if (no === 30) ad = true;
          else if (no === 5) card = true;
          return ad && card;
        });
      } catch (e) {
        return null;
      }
      if (wantAds && ad) {
        removed++;
        continue;
      }
      if (card) hasLyrics = true;
      kept.push(section.raw);
    }

    const addCard = wantCard && !!trackId && !hasLyrics;
    if (!removed && !addCard) return null;
    if (addCard) kept.unshift(wireEncodeField(1, 2, lyricsSection(trackId)));

    const rebuilt = wireEncodeField(1, 2, wireConcat(kept));
    const parts = [];
    for (const f of top) parts.push(f === structure ? rebuilt : f.raw);
    const out = wireConcat(parts);
    return wireEqual(out, buffer) ? null : out;
  }
