  // ---------------------------------------------------------------- protobuf
  //
  // 底层 varint / 字段切分 / 字段编码在 src/proto/wire.js，三端共用。
  // 这里只保留 Spotify 需要的消息级封装：parse 失败返回 null，
  // edit 在重编码前后做一次字节比对，防止把不认识的响应写坏。

  const TE = WIRE_TEXT;
  const TD = WIRE_UTF8;
  const readVarint = wireReadVarint;

  // 小整数 varint（字段号 / 长度）：失败（截断 / 超长）返回 -1，不抛异常。
  // 元数据响应里大量字符串会被拿来试探「是不是子消息」，绝大多数会在这里失败；
  // 用异常处理失败既慢又会反复捕获调用栈。
  function readCount(bytes, state) {
    const start = state.i;
    const limit = bytes.length;
    let at = start;
    let value = 0;
    let shift = 0;
    while (at < limit) {
      const byte = bytes[at++];
      if (shift < 28) {
        value |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) {
          state.i = at;
          return value >>> 0;
        }
        shift += 7;
        continue;
      }
      // 超过 4 字节：退回 BigInt 路径，与 wireReadCount 的行为一致。
      try {
        return Number(wireReadVarint(bytes, state, limit));
      } catch (e) {
        return -1;
      }
    }
    return -1;
  }

  // 字节不是合法消息时返回 null。一趟扫描直接产出字段对象，不经过中间数组。
  function parse(b) {
    const fields = [];
    const state = { i: 0 };
    const total = b.length;
    while (state.i < total) {
      const rawStart = state.i;
      const tag = readCount(b, state);
      if (tag < 0) return null;
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) return null;

      let dataStart = state.i;
      let end;
      if (wire === 2) {
        const length = readCount(b, state);
        if (length < 0 || length > total - state.i) return null;
        dataStart = state.i;
        end = dataStart + length;
      } else if (wire === 0) {
        end = dataStart;
        while (end < total && b[end++] & 0x80) { /* 只跳过 varint */ }
        if (end === dataStart || b[end - 1] & 0x80) return null;
      } else if (wire === 1) {
        end = dataStart + 8;
      } else if (wire === 5) {
        end = dataStart + 4;
      } else if (wire === 3) {
        // group：整段（含起止 tag）当 opaque 值保留，重新编码时原样写回。
        try {
          end = wireSkipGroup(b, dataStart, no);
        } catch (e) {
          return null;
        }
      } else {
        return null;
      }
      if (end > total) return null;
      state.i = end;

      const raw = b.subarray(rawStart, end);
      if (wire === 0) {
        let value;
        try {
          value = wireReadVarint(b.subarray(dataStart, end), { i: 0 });
        } catch (e) {
          return null;
        }
        fields.push({ no: no, w: 0, v: value, raw: raw });
      } else if (wire === 3) {
        // group 原样保留：p 存的是含起止 tag 的整段，serialize 直接写回。
        fields.push({ no: no, w: 3, p: raw, raw: raw });
      } else {
        fields.push({ no: no, w: wire, p: b.subarray(dataStart, end), raw: raw });
      }
    }
    return fields;
  }

  // varint 的 Number 版：字段号 / 长度 / 常见数值都远小于 2^53，不必为每个字段
  // 分配 BigInt 和临时 Uint8Array。超过 2^53 的 64 位值仍走 BigInt 保证不丢位。
  const MAX_SAFE_BIG = 9007199254740991n;
  function varintSize(n) {
    let size = 1;
    while (n >= 128) {
      n = Math.floor(n / 128);
      size += 1;
    }
    return size;
  }

  function writeVarint(out, at, n) {
    while (n >= 128) {
      out[at++] = (n % 128) | 128;
      n = Math.floor(n / 128);
    }
    out[at++] = n;
    return at;
  }

  function writeVarintBig(out, at, value) {
    let rest = value;
    while (rest >= 0x80n) {
      out[at++] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    out[at++] = Number(rest);
    return at;
  }

  const isBigValue = (v) => typeof v === "bigint" && v > MAX_SAFE_BIG;

  // 一次算好总长度、一次分配、直接写入；输出字节与逐字段 wireEncodeField + wireConcat 完全一致。
  function serialize(fields) {
    let size = 0;
    for (const f of fields) {
      if (f.w === 3) {
        size += f.p.length;
        continue;
      }
      size += varintSize(f.no * 8 + f.w);
      if (f.w === 0) size += isBigValue(f.v) ? wireVarintLength(f.v) : varintSize(Number(f.v));
      else if (f.w === 2) size += varintSize(f.p.length) + f.p.length;
      else size += f.p.length;
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const f of fields) {
      if (f.w === 3) {
        out.set(f.p, at);
        at += f.p.length;
        continue;
      }
      at = writeVarint(out, at, f.no * 8 + f.w);
      if (f.w === 0) {
        at = isBigValue(f.v) ? writeVarintBig(out, at, f.v) : writeVarint(out, at, Number(f.v));
      } else {
        if (f.w === 2) at = writeVarint(out, at, f.p.length);
        out.set(f.p, at);
        at += f.p.length;
      }
    }
    return out;
  }

  // 判断整条消息是否本来就是规范编码。等价于 same(serialize(parse(buffer)), buffer)，
  // 但只比较每个字段的 tag / 长度，不复制大 payload，避免 12MB 响应白拷贝一遍。
  function samePrefix(bytes, prefix) {
    if (bytes.length !== prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  // raw[at..at+len) 是否恰好是 n 的最短 varint 编码（不分配）。
  function matchesVarint(raw, at, n, len) {
    for (let i = 0; i < len; i += 1) {
      const byte = i < len - 1 ? (n % 128) | 128 : n;
      if (raw[at + i] !== byte) return false;
      n = Math.floor(n / 128);
    }
    return true;
  }

  function allCanonical(fields) {
    for (const f of fields) {
      const raw = f.raw;
      if (!raw) return false;
      const tag = f.no * 8 + f.w;
      const tagLen = varintSize(tag);
      if (raw.length < tagLen || !matchesVarint(raw, 0, tag, tagLen)) return false;
      if (f.w === 0) {
        if (isBigValue(f.v)) {
          if (!samePrefix(raw.subarray(tagLen), wireEncodeVarint(f.v))) return false;
        } else {
          const value = Number(f.v);
          const valueLen = varintSize(value);
          if (raw.length !== tagLen + valueLen || !matchesVarint(raw, tagLen, value, valueLen)) return false;
        }
      } else if (f.w === 2) {
        const lengthLen = varintSize(f.p.length);
        if (raw.length !== tagLen + lengthLen + f.p.length) return false;
        if (!matchesVarint(raw, tagLen, f.p.length, lengthLen)) return false;
      } else if (f.w === 3) {
        // group 按 raw 原样写回，只要保留着就认为是规范编码。
        if (!f.raw || f.raw.length !== f.p.length) return false;
      } else if (raw.length !== tagLen + (f.w === 1 ? 8 : 4)) {
        return false;
      }
    }
    return true;
  }

  const first = (fields, no) => {
    for (const f of fields) if (f.no === no) return f;
    return null;
  };
  const fieldString = (no, text) => ({ no: no, w: 2, p: TE.encode(text) });
  const fieldBytes = (no, payload) => ({ no: no, w: 2, p: payload });
  const fieldVarint = (no, value) => ({ no: no, w: 0, v: BigInt(value) });

  function text(f) {
    if (!f || f.w !== 2) return null;
    return wireDecodeText(f.p);
  }

  // 用 fn 的返回值替换 path 指向的消息；路径缺失或解析失败时返回 null。
  function edit(message, path, fn) {
    if (!path.length) return fn(message);
    const fields = parse(message);
    if (!fields || !allCanonical(fields)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;
