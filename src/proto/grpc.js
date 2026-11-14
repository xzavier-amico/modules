  //=====================================================================================
  // gRPC 公共层 —— 帧拆分 / 重组 + protobuf 字段级改写
  //
  // 依赖 wire.js 的底层编解码。只提供「按字段号删」「按条件删重复项」两类操作，
  // 没有改动返回 null，调用方原样放行；改不动时最多不生效，不会把消息写坏。
  //=====================================================================================

  // ---- 字节工具 ---------------------------------------------------------

  function toBytes(b) {
    if (!b) return null;
    if (b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== "undefined" && b instanceof ArrayBuffer) return new Uint8Array(b);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(b)) {
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
    if (typeof b === "string") {
      // 二进制串：每个字符就是一个字节。含非 Latin-1 字符说明是被当文本解码过
      // 的二进制，直接放弃，避免改出乱码。
      const out = new Uint8Array(b.length);
      for (let i = 0; i < b.length; i++) {
        const c = b.charCodeAt(i);
        if (c > 0xff) return null;
        out[i] = c;
      }
      return out;
    }
    return null;
  }

  function concat(parts) {
    return wireConcat(parts);
  }

  function same(a, b) {
    return wireEqual(a, b);
  }

  function asciiBytes(s) {
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function containsAscii(b, s, e, needle) {
    const first = needle[0];
    const last = e - needle.length;
    for (let i = s; i <= last; i++) {
      if (b[i] !== first) continue;
      let hit = true;
      for (let j = 1; j < needle.length; j++) {
        if (b[i + j] !== needle[j]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  // 一次扫描多组 needle；任意命中即返回 true。大响应里比逐组扫快 len(needles) 倍。
  function containsAnyAscii(b, s, e, needles) {
    const last = e - 1;
    for (let i = s; i <= last; i++) {
      const c = b[i];
      for (let k = 0; k < needles.length; k++) {
        const needle = needles[k];
        if (c !== needle[0]) continue;
        if (i + needle.length > e) continue;
        let hit = true;
        for (let j = 1; j < needle.length; j++) {
          if (b[i + j] !== needle[j]) {
            hit = false;
            break;
          }
        }
        if (hit) return true;
      }
    }
    return false;
  }

  function ascii(b, s, e) {
    let out = "";
    for (let i = s; i < e; i++) {
      const c = b[i];
      if (c === 0) break;
      if (c > 0x7f) return null;
      out += String.fromCharCode(c);
    }
    return out;
  }

  // ---- protobuf ---------------------------------------------------------

  // 读 varint，返回 [值, 新位置]；越界或过长返回 null。
  function readVarint(b, p, end) {
    const state = { i: p };
    try {
      return [Number(wireReadVarint(b, state, end)), state.i];
    } catch (e) {
      return null;
    }
  }

  // 把一段消息拆成字段列表：{ no, wt, s, e, ds, de }
  // s..e 是整个字段（含 tag），ds..de 是字段值。
  function parseFields(b, start, end) {
    let fields;
    try {
      fields = wireParseFields(b.subarray(start, end));
    } catch (e) {
      return null;
    }
    const out = [];
    let at = start;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      const s = at;
      const e = at + f.raw.length;
      out.push({ no: f.no, wt: f.wire, s: s, e: e, ds: e - f.data.length, de: e });
      at = e;
    }
    return out;
  }

  function encodeVarint(value) {
    return wireEncodeVarint(value);
  }

  function encodeField(no, wt, payload) {
    return wireEncodeField(no, wt, payload);
  }

  // drop 里的字段号整条删；filters 里的字段号按条件删（只处理 length-delimited）。
  // 没有改动返回 null，调用方据此原样放行。
  function rewrite(msg, drop, filters) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;

    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (drop && drop.indexOf(f.no) >= 0) {
        changed = true;
        continue;
      }
      if (filters && f.wt === 2 && filters[f.no] && filters[f.no](msg, f.ds, f.de)) {
        changed = true;
        continue;
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    if (!changed) return null;
    return concat(parts);
  }

  // 读某个 varint 字段的值；没有就返回 null。
  function fieldVarint(b, s, e, no) {
    const fields = parseFields(b, s, e);
    if (!fields) return null;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 0) {
        const r = readVarint(b, f.ds, f.de);
        if (r) return r[0];
      }
    }
    return null;
  }

  // 用扫描找某个 varint 字段的值，不建完整字段列表。
  // 找到字段号匹配且 wire=0 的就取值，否则返回 null。
  function fieldVarintFast(b, s, e, no) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 0) {
          if (fn === no) {
            return Number(wireReadVarint(sub, state));
          }
          wireSkipVarint(sub, state);
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          state.i += length;
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // 扫描判断某个字段号是否存在（不区分 wire type），不建字段列表。
  function hasField(b, s, e, no) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 0) {
          wireSkipVarint(sub, state);
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          state.i += length;
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
        if (fn === no) return true;
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 对 no 字段的每个 length-delimited 载荷调用 fn，fn 返回新字节或 null（不改）。
  function mapSub(msg, no, fn) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 2) {
        const sub = msg.subarray(f.ds, f.de);
        const next = fn(sub);
        if (next && !same(next, sub)) {
          parts.push(encodeField(no, 2, next));
          changed = true;
          continue;
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    return changed ? concat(parts) : null;
  }

  // 过滤重复字段：keep 返回 false 的整条删掉。
  function filterRepeated(msg, no, keep) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 2 && !keep(msg.subarray(f.ds, f.de))) {
        changed = true;
        continue;
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    return changed ? concat(parts) : null;
  }

  // 一次解析同时做 filter + map：keep 返回 false 的删掉，
  // keep 返回 true 的再调 mapFn（可返回 null 表示不改）。
  // 比分别调 filterRepeated + mapSub 少一次完整 parseFields。
  function filterAndMap(msg, no, keep, mapFn) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    const parts = [];
    let changed = false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === no && f.wt === 2) {
        const sub = msg.subarray(f.ds, f.de);
        if (!keep(sub)) {
          changed = true;
          continue;
        }
        if (mapFn) {
          const next = mapFn(sub);
          if (next && !same(next, sub)) {
            parts.push(encodeField(no, 2, next));
            changed = true;
            continue;
          }
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    return changed ? concat(parts) : null;
  }

  // ---- gRPC 帧 ----------------------------------------------------------

  // 响应是「1 字节 flag + 4 字节大端长度 + 消息体」的帧序列。
  function parseFrames(b) {
    const out = [];
    let p = 0;
    while (p + 5 <= b.length) {
      const flagByte = b[p];
      const len = ((b[p + 1] << 24) | (b[p + 2] << 16) | (b[p + 3] << 8) | b[p + 4]) >>> 0;
      const start = p + 5;
      const end = start + len;
      if (end > b.length) return null;
      out.push({ flag: flagByte, hdr: p, start: start, end: end });
      p = end;
    }
    if (p !== b.length) return null;
    return out.length ? out : null;
  }

  function frame(flagByte, msg) {
    const out = new Uint8Array(5 + msg.length);
    out[0] = flagByte;
    out[1] = (msg.length >>> 24) & 0xff;
    out[2] = (msg.length >>> 16) & 0xff;
    out[3] = (msg.length >>> 8) & 0xff;
    out[4] = msg.length & 0xff;
    out.set(msg, 5);
    return out;
  }
