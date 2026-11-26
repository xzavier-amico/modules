  // ------ 界面字形
  //
  // feed / browse / scroll 里的名称有两种存法：
  //   1. metadata map（{1:key, 2:value}，key 如 track_title / artist_name）
  //   2. 普通 protobuf 文本字段（section 标题、卡片标题、副标题等）
  // 只认第 1 种会漏掉大量列表标题，所以这里直接扫描整包字节里的
  // 「连续非 ASCII UTF-8 文本段」，对每段做繁→简折叠。
  //
  // - 不解析整棵树：12MB 的 scroll 响应也只多一次线性扫描
  // - UTF-8 序列严格校验，二进制长度前缀 / 哈希 / 图片 ID 不会被当成文本
  // - 文本段里出现日文假名时整段跳过
  // - fold() 保持 UTF-8 字节长度，命中后就地替换，不需要重编码长度字段

  const FEED_KANA = /[\u3040-\u30ff]/;

  function feedUtf8Size(byte) {
    if (byte < 0x80) return 1;
    if (byte >= 0xc2 && byte <= 0xdf) return 2;
    if (byte >= 0xe0 && byte <= 0xef) return 3;
    if (byte >= 0xf0 && byte <= 0xf4) return 4;
    return 0;
  }

  // 校验一个完整的 UTF-8 序列，顺便拒绝过长编码 / 代理区。
  function feedValidUtf8(bytes, at, size) {
    if (at + size > bytes.length) return false;
    for (let i = 1; i < size; i += 1) {
      if ((bytes[at + i] & 0xc0) !== 0x80) return false;
    }
    if (size === 3) {
      const b0 = bytes[at];
      const b1 = bytes[at + 1];
      if (b0 === 0xe0 && b1 < 0xa0) return false;
      if (b0 === 0xed && b1 >= 0xa0) return false;
    } else if (size === 4) {
      const b0 = bytes[at];
      const b1 = bytes[at + 1];
      if (b0 === 0xf0 && b1 < 0x90) return false;
      if (b0 === 0xf4 && b1 >= 0x90) return false;
    }
    return true;
  }

  function patchFeedNames(buffer) {
    if (!metaHans || typeof SPOTIFY_HAN_VARIANTS === "undefined") return null;
    if (!buffer || !buffer.length) return null;

    let out = null;
    const total = buffer.length;
    let i = 0;
    while (i < total) {
      const b0 = buffer[i];
      // ASCII（tag、长度、URI、ID、图片地址等）直接跳过。
      if (b0 < 0x80) {
        i += 1;
        continue;
      }
      const size = feedUtf8Size(b0);
      if (!size || !feedValidUtf8(buffer, i, size)) {
        i += 1;
        continue;
      }

      // 收集连续的非 ASCII UTF-8 文本段。
      const start = i;
      let end = i;
      while (end < total) {
        const byte = buffer[end];
        if (byte < 0x80) break;
        const step = feedUtf8Size(byte);
        if (!step || !feedValidUtf8(buffer, end, step)) break;
        end += step;
      }
      if (end <= start) {
        i = start + 1;
        continue;
      }

      let text = null;
      try {
        text = TD.decode(buffer.subarray(start, end));
      } catch (e) {
        text = null;
      }
      if (text && !FEED_KANA.test(text)) {
        const folded = SPOTIFY_HAN_VARIANTS.fold(text);
        if (folded !== text) {
          const encoded = TE.encode(folded);
          // 繁→简保持字节长度；万一不等就跳过，避免写坏长度字段。
          if (encoded.length === end - start) {
            if (!out) out = buffer.slice();
            out.set(encoded, start);
          }
        }
      }
      i = end;
    }
    return out;
  }
