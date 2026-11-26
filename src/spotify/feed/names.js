  // ---------------------------------------------------------- 界面字形
  //
  // feed 卡片里的曲名 / 歌手 / 专辑名放在 metadata map（{1:key, 2:value}）里。
  // 这里直接在原始字节上找这些 key，校验前面的 field-1 tag / 长度和后面的
  // field-2 结构；命中的值等长替换（繁→简只换字，UTF-8 长度不变），不重编码
  // 整包，12MB 响应也只多几次 indexOf。长度万一变化就放行，避免改坏响应。

  // 与 lyrics.js 的 META_TITLE_KEYS / META_ARTIST_KEYS 保持一致：不同页面的
  // metadata map 可能用 track_title / title，也可能只写 artist_name / artist。
  const FEED_NAME_KEYS = [
    "track_title", "track_name", "title",
    "artist_name", "artist",
    "album_title", "album_name",
  ];
  const FEED_NAME_KEY_BYTES = FEED_NAME_KEYS.map((key) => TE.encode(key));
  const FEED_NAME_KANA = /[\u3040-\u30ff]/;

  function feedIndexOf(haystack, needle, from) {
    const last = haystack.length - needle.length;
    const first = needle[0];
    for (let at = haystack.indexOf(first, from); at >= 0 && at <= last; at = haystack.indexOf(first, at + 1)) {
      let i = 1;
      while (i < needle.length && haystack[at + i] === needle[i]) i += 1;
      if (i === needle.length) return at;
    }
    return -1;
  }

  function feedReadLength(bytes, at) {
    let value = 0;
    let shift = 0;
    for (let i = at; i < bytes.length && shift < 28; i += 1) {
      const byte = bytes[i];
      value |= (byte & 0x7f) << shift;
      if (!(byte & 0x80)) return { value: value >>> 0, next: i + 1 };
      shift += 7;
    }
    return null;
  }

  function patchFeedNames(buffer) {
    if (!metaHans || typeof SPOTIFY_HAN_VARIANTS === "undefined") return null;
    if (!buffer || !buffer.length) return null;

    let out = null;
    for (const keyBytes of FEED_NAME_KEY_BYTES) {
      const keyLength = keyBytes.length;
      for (let at = feedIndexOf(buffer, keyBytes, 0); at >= 0; at = feedIndexOf(buffer, keyBytes, at + 1)) {
        // metadata entry 以 field 1（tag 0x0a）+ 长度开头；key 都短于 128，
        // 长度 varint 只有一个字节。
        if (at < 2 || buffer[at - 2] !== 0x0a || buffer[at - 1] !== keyLength) continue;

        const tagAt = at + keyLength;
        if (tagAt >= buffer.length || buffer[tagAt] !== 0x12) continue;
        const length = feedReadLength(buffer, tagAt + 1);
        if (!length || !length.value || length.value > 512) continue;

        const start = length.next;
        const end = start + length.value;
        if (end > buffer.length) continue;

        let value;
        try {
          value = TD.decode(buffer.subarray(start, end));
        } catch (e) {
          continue;
        }
        if (!value || FEED_NAME_KANA.test(value)) continue;

        const folded = SPOTIFY_HAN_VARIANTS.fold(value);
        if (folded === value) continue;
        const encoded = TE.encode(folded);
        if (encoded.length !== length.value) continue;

        if (!out) out = buffer.slice();
        out.set(encoded, start);
      }
    }
    return out;
  }
