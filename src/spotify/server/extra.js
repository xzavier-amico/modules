  // ---------------------------------------------------- server-only helpers
  //
  // 服务端独有：客户端不做这个兜底（regression 明确要求 uri + uid 不能单独
  // 认定为 metadata 字段），服务端只处理 context-resolve / metadata 接口，
  // 这里按字段 3 补 has_lyrics 是安全的。

  function isContextTrack(fields) {
    const uri = text(first(fields, 1));
    if (!uri || !/^spotify:(track|episode|local):/.test(uri)) return false;
    let known = 0;
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const entry = asEntry(parse(f.p));
      if (entry && KNOWN.indexOf(entry.key) >= 0) known++;
    }
    if (known > 0) return true;
    // 播放器状态里的当前曲目经常只带 uri + uid，metadata 是空的；只按已知 key
    // 判断会漏掉它，结果改的全是队列里的下一首。
    const uid = first(fields, 2);
    return !!uid && uid.w === 2;
  }
