//=======================================================================================
// Spotify Enhance — 信息流广告过滤
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// Shadowrocket 运行时兼容层。
//
// 只拼接到 shadowrocket/ 下的成品；Loon / Egern 自带这些 API，不会加载本文件。
// 全部按需安装：已有原生实现时整段跳过，不覆盖更快的原生版本。

if ("undefined" == typeof TextEncoder) {
  globalThis.TextEncoder = function () {};
  TextEncoder.prototype.encode = function (s) {
    s = String(s);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  };
}

if ("undefined" == typeof TextDecoder) {
  globalThis.TextDecoder = function (label, options) {
    this.fatal = !!(options && options.fatal);
  };
  TextDecoder.prototype.decode = function (input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    let out = "";
    for (let i = 0; i < b.length; ) {
      const start = i;
      const first = b[i++];
      let cp = 0;
      let need = 0;
      if (first < 0x80) cp = first;
      else if (first >= 0xc2 && first <= 0xdf) {
        cp = first & 0x1f;
        need = 1;
      } else if (first >= 0xe0 && first <= 0xef) {
        cp = first & 0x0f;
        need = 2;
      } else if (first >= 0xf0 && first <= 0xf4) {
        cp = first & 7;
        need = 3;
      } else need = -1;
      let ok = need >= 0 && i + need <= b.length;
      for (let k = 0; ok && k < need; k++) {
        if ((b[i + k] & 0xc0) !== 0x80) ok = false;
        else cp = (cp << 6) | (b[i + k] & 63);
      }
      if (ok && need === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
      if (ok && need === 3 && (cp < 0x10000 || cp > 0x10ffff)) ok = false;
      if (!ok) {
        if (this.fatal) throw new TypeError("invalid utf-8");
        out += "\ufffd";
        i = start + 1;
        continue;
      }
      i += need;
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  };
}

if ("undefined" == typeof Object.hasOwn) {
  Object.hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
}

// Uint8Array.fromBase64 / toBase64 是较新的 API，部分 Shadowrocket 的 JSC 没有。
// 这里补标准 base64（带填充），并保留命名函数供冒烟测试直接调用。
function shadowrocketBase64From(text) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(text)
    .replace(/[-_]/g, (ch) => (ch === "-" ? "+" : "/"))
    .replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean.charAt(i));
    const b = chars.indexOf(clean.charAt(i + 1));
    const c = chars.indexOf(clean.charAt(i + 2));
    const d = chars.indexOf(clean.charAt(i + 3));
    const n = (a << 18) | ((b & 63) << 12) | ((c & 63) << 6) | (d & 63);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return new Uint8Array(out);
}

function shadowrocketBase64To(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars.charAt(b0 >> 2);
    out += chars.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? chars.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < bytes.length ? chars.charAt(b2 & 63) : "=";
  }
  return out;
}

if ("undefined" == typeof Uint8Array.fromBase64) {
  Uint8Array.fromBase64 = shadowrocketBase64From;
}
if ("undefined" == typeof Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function () {
    return shadowrocketBase64To(this);
  };
}

(() => {
  "use strict";

  //=====================================================================================
  // protobuf wire —— 三端脚本共用的底层编解码
  //
  // 只做「把一段字节拆成字段列表」「按字段号编码」「varint 读写」，
  // 不建模具体消息。未建模的字段按 raw 原样保留，改不动时最多不生效，
  // 不会把响应写坏。
  //=====================================================================================

  const WIRE_TEXT = new TextEncoder();
  const WIRE_UTF8 = new TextDecoder("utf-8", { fatal: true });

  // varint 用 BigInt 读，避免 64 位字段（时间戳、ID）超过 2^53 后丢低位。
  function wireReadVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    let value = 0n;
    let shift = 0n;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7n;
      if (shift > 63n) throw new Error("Invalid protobuf varint");
    }
    throw new Error("Truncated protobuf varint");
  }

  // 字段号 / 长度这类小整数走 Number，避免每个字段都分配 BigInt；
  // 真的超过 4 字节时退回 BigInt 保证正确（实际只有超长字段才可能）。
  function wireReadCount(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    const start = state.i;
    let value = 0;
    let shift = 0;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      if (shift < 28) {
        value |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) return value >>> 0;
        shift += 7;
        continue;
      }
      // 超过 4 字节：退回去用 BigInt 重读整个 varint。
      state.i = start;
      return Number(wireReadVarint(bytes, state, limit));
    }
    throw new Error("Truncated protobuf varint");
  }

  // 只跳过 wire 0 的 varint，不构造 BigInt。字段切分 / 扫描时不需要这个值，
  // 大响应里能省掉每个数值字段一次 BigInt 分配。
  function wireSkipVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    while (state.i < limit) {
      if (!(bytes[state.i++] & 0x80)) return;
    }
    throw new Error("Truncated protobuf varint");
  }

  function wireVarintLength(value) {
    let length = 1;
    while (value >= 0x80n) {
      length++;
      value >>= 7n;
    }
    return length;
  }

  function wireEncodeVarint(value) {
    let rest = BigInt(value);
    const out = new Uint8Array(wireVarintLength(rest));
    let at = 0;
    while (rest >= 0x80n) {
      out[at++] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    out[at] = Number(rest);
    return out;
  }

  function wireConcat(parts) {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function wireEqual(left, right) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  // 旧式 group（wire type 3）：从 start 之后开始找匹配的 end group，返回结束位置。
  // Spotify 的元数据响应里偶尔会带 group，不认它的话整条响应只能原样放行。
  function wireSkipGroup(bytes, from, no) {
    const state = { i: from };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const inner = tag >>> 3;
      const wire = tag & 7;
      if (!inner) throw new Error("Invalid protobuf field");
      if (wire === 4) {
        if (inner !== no) throw new Error("Mismatched protobuf end group");
        return state.i;
      }
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, inner);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
    }
    throw new Error("Truncated protobuf group");
  }

  // 返回 [{ no, wire, data, raw }]；data 是字段值，raw 是含 tag 的整段字节。
  function wireParseFields(bytes) {
    const fields = [];
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const rawStart = state.i;
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");

      let dataStart = state.i;
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        dataStart = state.i;
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        // group：整段（含起止 tag）当 opaque 值保留，重新编码时原样写回。
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");

      fields.push({
        no: no,
        wire: wire,
        data: bytes.subarray(dataStart, state.i),
        raw: bytes.subarray(rawStart, state.i),
      });
    }
    return fields;
  }

  // 只扫字段号、不建对象、不切子数组；onField(no) 返回 true 时提前结束。
  // 用于大响应里判断「有没有某个字段」，比完整 parse 快很多。
  function wireScanFields(bytes, onField) {
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no)) return true;
    }
    return false;
  }

  // 按 no / wire 编码一个字段；payload 对 wire 0 是 varint 字节，其余是字段值。
  function wireEncodeField(no, wire, payload) {
    const tag = wireEncodeVarint(BigInt(no) * 8n + BigInt(wire));
    return wire === 2 ? wireConcat([tag, wireEncodeVarint(payload.length), payload]) : wireConcat([tag, payload]);
  }

  function wireDecodeText(bytes) {
    try {
      return WIRE_UTF8.decode(bytes);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- options

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source,
      // prefetch_lyrics, sync_plain_lyrics, lyrics_isrc, word_lyrics。
      opt = {
        spoof_premium: raw[0], block_ads: raw[1], unlock_playback: raw[2],
        enable_lyrics: raw[3], desktop: raw[4], lyrics_source: raw[5],
        prefetch_lyrics: raw[6], sync_plain_lyrics: raw[7], lyrics_isrc: raw[8], word_lyrics: raw[9],
      };
    } else if (typeof raw === "string") {
      opt = JSON.parse(raw || "{}") || {};
    } else if (raw && "object" == typeof raw) {
      opt = raw;
    }
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  // 客户端模式：auto 按 User-Agent 识别；拿不到 UA 时再看 Loon 运行环境。
  // 识别结果只影响桌面端专属的改写路径，失败时按移动端处理。
  const requestUserAgent = () => {
    const req = typeof $request !== "undefined" && $request ? $request : null;
    const headers = req && req.headers;
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = headers[key];
      return String(Array.isArray(value) ? value[0] || "" : value == null ? "" : value);
    }
    return "";
  };
  const detectDesktop = () => {
    const ua = requestUserAgent();
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    if (/Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua)) return true;
    const loon = typeof $loon !== "undefined" ? String($loon) : "";
    return /^Mac\b/i.test(loon);
  };
  const desktopMode = (v) => {
    if (v === undefined || v === null || v === "") return detectDesktop();
    const mode = String(v).trim().toLowerCase();
    if (mode === "auto") return detectDesktop();
    if (mode === "macos" || mode === "mac" || mode === "desktop") return true;
    if (mode === "ios" || mode === "iphone" || mode === "ipad" || mode === "mobile") return false;
    return flag(v, false);
  };
  const autoPlay = (v) => v === undefined || v === null || /^auto$/i.test(String(v));

  const spoof = flag(opt.spoof_premium, true);
  const adsOn = flag(opt.block_ads, true);
  // macOS 桌面版：bootstrap 外层结构可能和 iOS 不同，且播放授权由服务端判定。
  const desktop = desktopMode(opt.desktop);
  // unlock_playback=auto 时移动端开启、桌面端关闭；桌面端强行写播放授权容易跳歌。
  const playOn = autoPlay(opt.unlock_playback) ? !desktop : flag(opt.unlock_playback, !desktop);
  const lyricsOn = flag(opt.enable_lyrics, true);
  // 响应体上限：超过上限直接放行，避免异常响应占满内存。
  const MAX_META_BYTES = 12 * 1024 * 1024; // extended-metadata / context-resolve / connect-state / metadata
  const MAX_FEED_BYTES = 12 * 1024 * 1024; // home / browse / scroll / remote-config / nebula
  const MAX_BOOTSTRAP_BYTES = 40 * 1024 * 1024; // bootstrap / user-customization

  // ---------------------------------------------------------------- protobuf
  //
  // 底层 varint / 字段切分 / 字段编码在 src/proto/wire.js，三端共用。
  // 这里只保留 Spotify 需要的消息级封装：parse 失败返回 null，
  // edit 在重编码前后做一次字节比对，防止把不认识的响应写坏。

  const TE = WIRE_TEXT;
  const TD = WIRE_UTF8;
  const readVarint = wireReadVarint;

  // 字节不是合法消息时返回 null。
  function parse(b) {
    let fields;
    try {
      fields = wireParseFields(b);
    } catch (e) {
      return null;
    }
    return fields.map((f) => {
      if (f.wire === 0) return { no: f.no, w: 0, v: wireReadVarint(f.data, { i: 0 }), raw: f.raw };
      // group 原样保留：p 存的是含起止 tag 的整段，serialize 直接写回。
      if (f.wire === 3) return { no: f.no, w: 3, p: f.raw, raw: f.raw };
      return { no: f.no, w: f.wire, p: f.data, raw: f.raw };
    });
  }

  function serialize(fields) {
    return wireConcat(fields.map((f) => (f.w === 3
      ? f.p
      : wireEncodeField(f.no, f.w, f.w === 0 ? wireEncodeVarint(f.v) : f.p))));
  }

  // 判断整条消息是否本来就是规范编码。等价于 same(serialize(parse(buffer)), buffer)，
  // 但只比较每个字段的 tag / 长度，不复制大 payload，避免 12MB 响应白拷贝一遍。
  function samePrefix(bytes, prefix) {
    if (bytes.length !== prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  function allCanonical(fields) {
    for (const f of fields) {
      if (!f.raw) return false;
      const tag = wireEncodeVarint(BigInt(f.no) * 8n + BigInt(f.w));
      if (f.raw.length < tag.length || !samePrefix(f.raw.subarray(0, tag.length), tag)) return false;
      if (f.w === 0) {
        const value = wireEncodeVarint(f.v);
        if (!samePrefix(f.raw.subarray(tag.length), value)) return false;
      } else if (f.w === 2) {
        const length = wireEncodeVarint(f.p.length);
        if (f.raw.length !== tag.length + length.length + f.p.length) return false;
        if (!samePrefix(f.raw.subarray(tag.length, tag.length + length.length), length)) return false;
      } else if (f.w === 3) {
        // group 按 raw 原样写回，只要保留着就认为是规范编码。
        if (!f.raw || f.raw.length !== f.p.length) return false;
      } else if (f.raw.length !== tag.length + (f.w === 1 ? 8 : 4)) {
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
    if (!fields || !same(serialize(fields), message)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;

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

  // 首页与浏览页共用同一套 section 过滤。
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
  // 预热歌词缓存后传入。默认只删广告。
  function hideScrollAds(buffer, trackId, wantCard) {
    return patchScroll(buffer, trackId || "", true, !!wantCard);
  }

  // feed 脚本在 lyrics.js 之前执行：开启辅助模式（只暴露缓存查询、补卡判断与
  // 下一首预取），并把 feed 的参数位置翻译成歌词脚本认识的选项。
  const SPOTIFY_LYRICS_HELPER = true;
  const SPOTIFY_HELPER_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    const pick = (value) => ({
      enable_lyrics: value.enable_lyrics,
      lyrics_source: value.lyrics_source,
      prefetch_lyrics: value.prefetch_lyrics,
      sync_plain_lyrics: value.sync_plain_lyrics,
      lyrics_isrc: value.lyrics_isrc,
      word_lyrics: value.word_lyrics,
    });
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source,
      // prefetch_lyrics, sync_plain_lyrics, lyrics_isrc, word_lyrics。
      return {
        enable_lyrics: raw[3],
        lyrics_source: raw[5],
        prefetch_lyrics: raw[6],
        sync_plain_lyrics: raw[7],
        lyrics_isrc: raw[8],
        word_lyrics: raw[9],
      };
    }
    if (typeof raw === "string") {
      try {
        return pick(JSON.parse(raw || "{}") || {});
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) return pick(raw);
    return {};
  })();

// Spotify Lyrics — 官方歌词转简体；官方没有歌词时，用第三方歌词补上。
//
// 只处理 color-lyrics/v{N}/track/{id} 的响应：
//   200 且歌词非空  -> 按 lyrics_script 转简体（默认），清掉额度限制后放行
//   404 / 空歌词    -> 取曲目元数据，按配置的歌词源查找，合成同结构响应
//
// spotify.js 补曲目 has_lyrics；feed 脚本在 scrollsita 缺少歌词 section 时补一格。
//
// 元数据：优先读 spotify.js 存下的客户端元数据（connect-state / context-resolve /
// metadata/4/track），命中时零外部请求；没命中才退回 open.spotify.com 的 oEmbed
// 与 embed 页面（公开接口，不需要 token）。
// 歌词源：LRCLIB / Musixmatch / 网易云 / QQ 音乐
//
// 客户端模式：Loon 传第 3 个参数 desktop=auto / ios / macos；auto 按 User-Agent
// 识别。没有 body 的 404 会优先按客户端请求的格式（JSON / protobuf）合成，
// 桌面端默认 JSON，iOS 无格式提示时默认 protobuf。
//
// 任何一步失败都原样放行，App 仍然显示它自己的「暂无歌词」，不会卡住播放。

(() => {
  "use strict";

  // feed 脚本以辅助模式加载：只暴露缓存查询与补卡判断，不处理响应。
  const HELPER = typeof SPOTIFY_LYRICS_HELPER !== "undefined" && SPOTIFY_LYRICS_HELPER;

  const req = typeof $request !== "undefined" && $request ? $request : null;
  const res = typeof $response !== "undefined" && $response ? $response : null;
  const url = (res && res.url) || (req && req.url) || "";

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  if (HELPER) {
    // feed 的位置参数和歌词脚本不同，由 feed/lyrics-card.js 解析后传入。
    opt = typeof SPOTIFY_HELPER_OPTIONS !== "undefined" && SPOTIFY_HELPER_OPTIONS ? SPOTIFY_HELPER_OPTIONS : {};
  } else {
    try {
      const raw = typeof $argument !== "undefined" ? $argument : undefined;
      if (Array.isArray(raw)) {
        // Loon 位置参数：歌词源, 补全歌词, 设备类型, 歌词字形, 忽略简繁,
        // 纯文本伪同步, ISRC 反查。
        opt = {
          lyrics_source: raw[0],
          enable_lyrics: raw[1],
          desktop: raw[2],
          lyrics_script: raw[3],
          ignore_han_variants: raw[4],
          sync_plain_lyrics: raw[5],
          lyrics_isrc: raw[6],
          word_lyrics: raw[7],
        };
      }
      else if (typeof raw === "string") {
        try {
          opt = JSON.parse(raw || "{}") || {};
        } catch (e) {
          // Loon 单参数时可能直接传字符串
          opt = { lyrics_source: raw };
        }
      } else if (raw && "object" == typeof raw) opt = raw;
    } catch (e) {
      opt = {};
    }
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));
  // 客户端模式：auto 按 User-Agent 识别，拿不到 UA 时再看 Loon 运行环境。
  const requestUserAgent = () => {
    if (!req || !req.headers || "object" != typeof req.headers) return "";
    for (const key in req.headers) {
      if (String(key).toLowerCase() !== "user-agent") continue;
      const value = req.headers[key];
      return String(Array.isArray(value) ? value[0] || "" : value == null ? "" : value);
    }
    return "";
  };
  const detectDesktop = () => {
    const ua = requestUserAgent();
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return false;
    if (/Macintosh|Mac OS X|Darwin|Windows NT/i.test(ua)) return true;
    const loon = typeof $loon !== "undefined" ? String($loon) : "";
    return /^Mac\b/i.test(loon);
  };
  const desktopMode = (v) => {
    if (v === undefined || v === null || v === "") return detectDesktop();
    const mode = String(v).trim().toLowerCase();
    if (mode === "auto") return detectDesktop();
    if (mode === "macos" || mode === "mac" || mode === "desktop") return true;
    if (mode === "ios" || mode === "iphone" || mode === "ipad" || mode === "mobile") return false;
    return flag(v, false);
  };
  const desktop = desktopMode(opt.desktop);

  // 匹配用的繁→简折叠：Spotify 的中文曲名 / 歌手常是繁体，网易云 / QQ 曲库是
  // 简体；不折叠时「說謊」对不上「说谎」，「周杰倫」对不上「周杰伦」。
  const foldHanVariants = flag(opt.ignore_han_variants, true);
  // 歌词显示字形：hans（默认）把官方与第三方歌词都转成简体，source 保持原文。
  // 官方响应以 language 字段为准（zh-Hant / zh-TW 直接转，并同步改成 zh-Hans），
  // 第三方歌词只在整段判定为繁体时转换；简体 / 英文 / 日文歌词原样返回。
  // 纯文本伪同步：只有纯文本歌词时，按歌曲时长把行均分出时间轴，让它能跟着滚动。
  // 默认开：反正拿不到同步歌词，能滚动比只能整屏文字有用；关掉则保持 UNSYNCED。
  const pseudoSync = flag(opt.sync_plain_lyrics, true);
  // ISRC 反查：前面几轮都没搜到时，用 Deezer 公开 API 反查 ISRC，再用 ISRC 直查
  // Musixmatch、用 Deezer 的规范曲名重查一遍。只在落空后才跑，不占主链路预算。
  const isrcLookup = flag(opt.lyrics_isrc, true);
  const wordLyrics = flag(opt.word_lyrics, false);
  // 预取下一首：只有 feed 脚本（辅助模式）会用。
  const prefetchNextOn = flag(opt.prefetch_lyrics, true);

  const hansLyrics = (() => {
    const raw = opt.lyrics_script === undefined || opt.lyrics_script === null ? "hans" : opt.lyrics_script;
    const mode = String(raw).trim().toLowerCase();
    return mode !== "source" && mode !== "original" && mode !== "keep";
  })();

  // 参数关闭时直接放行；请求阶段的缓存命中在下面处理，未命中同样立即放行。
  // Loon 靠 enable= 决定是否加载脚本，Egern 不支持条件加载，只能在这里早退。
  if (!HELPER && !flag(opt.enable_lyrics, true)) {
    $done({});
    return;
  }

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  let trackId = HELPER ? "" : match ? match[1] : "";
  if (!HELPER && !match) {
    $done({});
    return;
  }

  // 桌面端（macOS / Windows 新版播放器）跑在 CEF 里，歌词请求是跨域 fetch：
  // 先发 OPTIONS 预检，再发 GET。预检响应只带 CORS 头、没有 body，脚本一旦
  // 把它当成「官方没歌词」回一份歌词 JSON，Access-Control-Allow-* 就被顶掉，
  // 浏览器直接判 PreflightMissingAllowOriginHeader，GET 根本发不出去，
  // App 显示「无法加载这首歌曲的歌词，请稍后再试」。
  // 所以：预检一律原样放行；带预检标记头（Allow-Methods / Max-Age）的响应
  // 也不碰，避免误判。iOS 客户端不发 OPTIONS，这条分支对移动端不生效。
  const requestMethod = String((req && req.method) || "").toUpperCase();
  const preflightResponse = !!res && (headerValue(res.headers, "access-control-allow-methods") !== ""
    || headerValue(res.headers, "access-control-max-age") !== "");
  if (!HELPER && (requestMethod === "OPTIONS" || preflightResponse)) {
    $done({});
    return;
  }

  // LRCLIB 要求请求方在 UA 里说明自己是谁，所以默认保留这个描述性 UA。
  // 网易云 / QQ 音乐用的是网页接口，按接口形态换成浏览器 UA：
  // 非浏览器 UA 目前也能拿到数据，但更容易被风控或后续加白名单时挡掉。
  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const BROWSER_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
  // search_for_qq_cp 是 QQ 音乐的移动端入口，配移动浏览器 UA 更一致。
  const MOBILE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // spotify.js 在改写曲目元数据时，顺手把曲名 / 歌手 / 时长存进了本地存储。
  // 命中时连 oEmbed 都不用请求，只留 embed 页面取封面配色。
  const TRACK_CACHE_KEY = "spotify.track.meta.v2";
  const TRACK_CACHE_MAX = 64;

  // 歌词结果缓存：同一首歌的播放器、歌词页与歌词卡会重复请求 color-lyrics，
  // 命中后直接回缓存，不再打第三方源。命中的歌词基本不会变，存久一点；
  // 查不到 / 超时都不写缓存，避免一次网络抖动把这首歌判成「无歌词」。
  const LYRICS_CACHE_KEY = "spotify.lyrics.cache.v2";
  const LYRICS_CACHE_MAX = 24;
  const LYRICS_CACHE_HIT_TTL = 24 * 60 * 60 * 1000;
  const LYRICS_CACHE_MAX_LINES = 400;
  const LYRICS_CACHE_MAX_BYTES = 400 * 1024;
  // 4.5s 是「官方响应到达后」的预算：客户端大约 5s 就不再刷新 Now Playing，
  // 再等下去结果也显示不出来。只有真的在等第三方轮次时才会用满；所有源都
  // 快速返回「没有」时仍会立刻放行。
  const LYRICS_DEADLINE_MS = 4500;
  const PLAIN_FALLBACK_MS = 3500;
  // 元数据回源（open.spotify.com 的 oEmbed / embed 页面）单次上限。两个请求
  // 并行发出，超时不会让整条链路多等一轮；卡住不返回的请求最多拖 2.5 秒。
  const META_TIMEOUT_MS = 2500;
  // feed 在 scrollsita 里顺手回填曲名 / 歌手；首次进 Now Playing 时它可能比
  // 歌词脚本晚一点点。100ms 看一次缓存，最多 2s；命中后立刻开始查歌词，
  // 不用等 open.spotify.com 的 oEmbed。定时器只是优化：没命中时仍按原来的
  // oEmbed / embed 流程走，不会多等。
  const META_WAIT_MS = 2000;
  const META_POLL_MS = 100;

  // 确认没有歌词的曲目，短期内不再补空卡。
  const MISS_KEY = "spotify.lyrics.miss";
  const MISS_TTL_MS = 5 * 60 * 1000;

  // 歌词请求进度：请求阶段写 pending。feed 补卡时据此判断「这首歌的歌词正在查」，
  // 有请求在路上时旧的 miss 标记不作数，避免把这次可能成功的歌词挡掉。
  const PENDING_KEY = "spotify.lyrics.pending";
  // 歌词脚本自己的 deadline 是 4.5s；超过 10s 还没清掉就是脚本被杀了，按失效处理。
  const PENDING_TTL_MS = 10 * 1000;

  // Musixmatch：两跳要各给短超时，整条链路的总预算是 4.5s，token 慢就等于这一源
  // 白等。换到的匿名 token 大约 10 分钟有效，存起来省掉下一次往返；接口回非 200
  // 说明 token 失效，下次重新换。
  // 这些常量必须声明在顶层调用 resolveLyrics() 之前：const 有 TDZ，函数声明虽然
  // 提升，执行到函数体时读到的常量可能还没初始化（ReferenceError）。
  const MMX_APP_ID = "mac-ios-v2.0";
  const MMX_TOKEN_KEY = "spotify.mmx.token";
  const MMX_TOKEN_TIMEOUT_MS = 1500;
  const MMX_TIMEOUT_MS = 2500;
  const MMX_TOKEN_TTL_MS = 8 * 60 * 1000;

  // 预取下一首歌词：attempt 记录免掉重复网络请求（同一首 30 分钟内只试一次），
  // 队列整体过期时间与 spotify.queue 保持一致。
  const PREFETCH_KEY = "spotify.prefetch.v1";
  const PREFETCH_TTL_MS = 30 * 60 * 1000;
  const PREFETCH_MARK_MAX = 32;
  const QUEUE_KEY = "spotify.queue";
  const QUEUE_TTL_MS = 30 * 60 * 1000;
  const DEEZER_TIMEOUT_MS = 2500;
  const DEEZER_API = "https://api.deezer.com";

  const storeBackend = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  function readJsonMap(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const map = raw ? JSON.parse(raw) : null;
      return map && "object" == typeof map && !Array.isArray(map) ? map : {};
    } catch (e) {
      return {};
    }
  }

  function writeJsonMap(key, map) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(JSON.stringify(map), key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 请求标记：不同脚本实例（歌词 / connect-state / feed）之间只靠持久化存储
  // 通信，标记一律带时间戳，脚本被超时杀掉时也不会长期阻塞后续调度。
  function readMark(key) {
    const store = storeBackend();
    if (!store) return null;
    try {
      const raw = store.read(key);
      const value = raw ? JSON.parse(raw) : null;
      return value && "object" == typeof value ? value : null;
    } catch (e) {
      return null;
    }
  }

  function writeMark(key, value) {
    const store = storeBackend();
    if (!store) return;
    try {
      store.write(value ? JSON.stringify(value) : "", key);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  function activeMark(key, id, ttl) {
    const mark = readMark(key);
    return mark && (!id || mark.id === id) && Number(mark.at) && Date.now() - Number(mark.at) < ttl ? mark : null;
  }

  // 歌词请求已经开始（请求阶段放行官方请求之前），feed 据此判断这首歌是否
  // 正在查询，避免旧的 miss 标记把这次可能成功的歌词挡掉。
  const markPending = () => {
    if (trackId) writeMark(PENDING_KEY, { id: trackId, at: Date.now() });
  };

  function cachedTrackMeta(id) {
    const map = readJsonMap(TRACK_CACHE_KEY);
    const value = map && map[id];
    if (!value || !value[0]) return null;
    const ms = Number(value[2]);
    const color = value[4];
    return {
      title: String(value[0]),
      artist: String(value[1] || "").trim(),
      duration: Number.isFinite(ms) && ms > 10000 ? ms / 1000 : undefined,
      color: color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))
        ? { r: Number(color.r), g: Number(color.g), b: Number(color.b) }
        : null,
    };
  }

  // 从 oEmbed / embed 拿到的元数据也写回同一份缓存：下次播放直接命中，
  // 连 open.spotify.com 都不用请求。顺便缓存封面色，歌词页背景保持一致。
  function rememberTrackMeta(id, title, artist, durationMs, color) {
    if (!id || !title) return;
    const map = readJsonMap(TRACK_CACHE_KEY) || {};
    const next = [String(title), String(artist || ""), Number(durationMs) || 0, Date.now()];
    if (color && Number.isFinite(Number(color.r)) && Number.isFinite(Number(color.g)) && Number.isFinite(Number(color.b))) {
      next[4] = { r: Number(color.r), g: Number(color.g), b: Number(color.b) };
    }
    const old = map[id];
    if (
      old &&
      old[0] === next[0] &&
      old[1] === next[1] &&
      Number(old[2]) === next[2] &&
      (!next[4] || (old[4] && old[4].r === next[4].r && old[4].g === next[4].g && old[4].b === next[4].b))
    ) return;
    map[id] = next;
    const ids = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const key of ids.slice(TRACK_CACHE_MAX)) delete map[key];
    writeJsonMap(TRACK_CACHE_KEY, map);
  }

  function lyricsSourceKey() {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    return wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq" ? wanted : "auto";
  }

  const lyricsCacheKey = (id) => lyricsSourceKey() + "|" + (hansLyrics ? "hans" : "source")
    + "|" + (wordLyrics ? "word" : "line") + "|" + id;

  function readLyricsCache(key, id) {
    const map = readJsonMap(LYRICS_CACHE_KEY);
    const valid = (value) => !!value && "object" == typeof value && !value.m &&
      Date.now() - Number(value.t || 0) < LYRICS_CACHE_HIT_TTL &&
      // 缓存存的是已经转换过的歌词；字形设置换过就不复用，避免显示成另一种字形。
      // feed 预取没有携带词表，可能留下未转换的条目，命中时在下面再判一次。
      (HELPER || (Number(value.z) || 0) === (hansLyrics ? 1 : 0));
    let entry = map && map[key];
    // 配置换过歌词源（auto ↔ lrclib）时旧缓存 key 会不同；按曲目 id 再找一次，
    // 避免同一首歌已经缓存过却因为前缀不同重新查源。
    if (!valid(entry) && id) {
      const suffix = "|" + (wordLyrics ? "word" : "line") + "|" + id;
      const legacySuffix = "|" + id;
      for (const name of Object.keys(map || {})) {
        const currentMode = name.slice(-suffix.length) === suffix;
        const legacyMode = name.slice(-legacySuffix.length) === legacySuffix;
        if (!currentMode && !legacyMode) continue;
        const candidate = map[name];
        const hasWordLines = candidate && Array.isArray(candidate.a)
          && candidate.a.some((line) => Array.isArray(line) && Array.isArray(line[3]) && line[3].length);
        if (legacyMode && ((wordLyrics && !hasWordLines) || (!wordLyrics && hasWordLines))) continue;
        if (valid(candidate)) {
          entry = candidate;
          break;
        }
      }
    }
    if (!valid(entry)) return null;
    const lines = Array.isArray(entry.a) ? entry.a : [];
    if (!lines.length) return null;
    const signed = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
    const provider = String(entry.p || "LRCLIB");
    const rebuilt = lines.map((pair) => ({
      startTimeMs: String(Number(pair && pair[0]) || 0),
      words: String((pair && pair[1]) || ""),
      syllables: Array.isArray(pair && pair[3]) ? pair[3].map((part) => ({
        startTimeMs: String(Number(part && part[0]) || 0),
        endTimeMs: String(Number(part && part[1]) || 0),
        words: String((part && part[2]) || ""),
      })) : [],
      endTimeMs: String(Number(pair && pair[2]) || 0),
    }));
    // 预取由 feed 脚本完成，它没有携带 t2s 词表；旧版本写下的缓存也可能没转。
    // 命中时再判一次，繁体就折叠，已经简体的缓存不受影响。
    if (!HELPER && hansLyrics && typeof SPOTIFY_HAN_VARIANTS !== "undefined") {
      if (SPOTIFY_HAN_VARIANTS.isTraditional(jsonSample(rebuilt).text)) {
        for (let i = 0; i < rebuilt.length; i += 1) {
          rebuilt[i].words = SPOTIFY_HAN_VARIANTS.fold(rebuilt[i].words);
          for (const part of rebuilt[i].syllables) part.words = SPOTIFY_HAN_VARIANTS.fold(part.words);
        }
      }
    }
    return {
      payload: {
        lyrics: {
          syncType: entry.s === "UNSYNCED" ? "UNSYNCED" : entry.s === "SYLLABLE_SYNCED" ? "SYLLABLE_SYNCED" : "LINE_SYNCED",
          lines: rebuilt,
          // 缓存里只存了行，重建时一样要补 previewLines：桌面端直接对它
          // .map()，缺字段会抛 TypeError，命中缓存的歌一律变成「无法加载」。
          previewLines: rebuilt.slice(0, PREVIEW_LINES),
          provider: provider,
          providerLyricsId: entry.i === undefined || entry.i === null ? "" : String(entry.i),
          providerDisplayName: provider,
          syncLyricsUri: "",
          isDenseTypeface: false,
          alternatives: [],
          language: String(entry.l || "en"),
          isRtlLanguage: false,
          fullscreenAction: "FULLSCREEN_LYRICS",
        },
        colors: {
          background: signed(Number(entry.c && entry.c[0]) || 0xff808080),
          text: signed(Number(entry.c && entry.c[1]) || 0xff000000),
          highlightText: signed(Number(entry.c && entry.c[2]) || 0xffffffff),
        },
        hasVocalRemoval: false,
      },
    };
  }


  function writeLyricsCache(key, payload) {
    // 只缓存真正拿到的歌词；查不到 / 超时都不写，下一次打开可以立刻重试。
    if (!payload) return;
    const map = readJsonMap(LYRICS_CACHE_KEY) || {};
    const now = Date.now();
    const lyrics = payload.lyrics || {};
    const colors = payload.colors || {};
    const lines = [];
    const raw = Array.isArray(lyrics.lines) ? lyrics.lines : [];
    for (let i = 0; i < raw.length && i < LYRICS_CACHE_MAX_LINES; i += 1) {
      const line = raw[i];
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      const syllables = Array.isArray(line.syllables) ? line.syllables.slice(0, 100).map((part) => [
        Number(part.startTimeMs) || 0,
        Number(part.endTimeMs) || 0,
        String(part.words || "").slice(0, 80),
      ]) : [];
      lines.push([Number(line.startTimeMs) || 0, line.words.slice(0, 200), Number(line.endTimeMs) || 0, syllables]);
    }
    if (!lines.length) return;
    map[key] = {
      t: now,
      m: 0,
      z: hansLyrics ? 1 : 0,
      s: lyrics.syncType === "UNSYNCED" ? "UNSYNCED" : lyrics.syncType === "SYLLABLE_SYNCED" ? "SYLLABLE_SYNCED" : "LINE_SYNCED",
      p: String(lyrics.provider || "LRCLIB"),
      i: lyrics.providerLyricsId === undefined || lyrics.providerLyricsId === null ? "" : String(lyrics.providerLyricsId),
      l: String(lyrics.language || "en"),
      c: [Number(colors.background) || 0xff808080, Number(colors.text) || 0xff000000, Number(colors.highlightText) || 0xffffffff],
      a: lines,
    };
    for (const id of Object.keys(map)) {
      const entry = map[id];
      // 清掉过期条目和 miss 记录。
      if (!entry || entry.m || !(now - Number(entry.t || 0) < LYRICS_CACHE_HIT_TTL)) delete map[id];
    }
    const byAge = () => Object.keys(map).sort((a, b) => Number(map[b].t || 0) - Number(map[a].t || 0));
    for (const id of byAge().slice(LYRICS_CACHE_MAX)) delete map[id];

    // 存储空间和解析成本都要控住：整包超过上限时继续按时间淘汰最旧的。
    const store = storeBackend();
    if (!store) return;
    try {
      let json = JSON.stringify(map);
      for (const id of byAge()) {
        if (json.length <= LYRICS_CACHE_MAX_BYTES || Object.keys(map).length <= 1) break;
        delete map[id];
        json = JSON.stringify(map);
      }
      store.write(json, LYRICS_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响本次响应。
    }
  }

  // 歌词页配色在 albumColors() 里按官方规则计算：封面主色做背景，未激活行黑色，
  // 当前 / 已唱行白色。三项都是 alpha=0xFF 的不透明色，不能依赖 alpha 区分。
  // 官方 previewLines 给 5 行；超过歌词总行数时按实际行数截断。
  const PREVIEW_LINES = 5;

  // 这些正则会在逐行解析里反复用到，提到外层只创建一次。
  const LRC_STAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
  const LRC_OFFSET = /^\[offset:\s*(-?\d+)\s*\]$/i;
  const LRC_BRACKET = /\[[^\]]*\]/g;
  const NORMALIZE_DROP = /[^\p{L}\p{M}\p{N}]+/gu;
  const LIVE_MARK = /(?:\blive\b|live版|现场|現場|[一二三四五六七八九十\d]+公)/i;
  const STAGE_MARK = /([一二三四五六七八九十\d]+公)/;
  const INSTRUMENTAL_MARK = /伴奏|instrumental|karaoke/i;
  const SONG_TITLE_LIVE = /\s*[-–—]\s*[^-–—]*(?:\blive\b|live版|现场|現場).*$/i;
  const SONG_TITLE_LIVE_BRACKET = /[（(][^()（）]*(?:live|现场|現場)[^()（）]*[)）]/gi;
  const SONG_TITLE_BRACKET_GROUP = /[（(]([^()（）]*)[)）]/g;
  // 括号里带这些词时说明是不同版本（Live / Remix / 伴奏…），不能当装饰信息删掉。
  const SONG_TITLE_VERSION_BRACKET = /\b(?:live|acoustic|unplugged|remix|mix|version|edit|remaster(?:ed)?|instrumental|karaoke|demo|cover|session|mono|stereo|deluxe|bonus|explicit|clean)\b|现场|現場|演唱会|演唱會|伴奏|纯音乐|純音樂|混音|重制|重製|翻唱|翻自|试听|試聽|片段|版/i;
  const SONG_TITLE_BRACKET_NOISE = /[（(\[][^()（）\[\]]*\b(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|feat\.?|ft\.?|featuring|with|prod\.?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\b[^()（）\[\]]*[)）\]]/gi;
  const SONG_TITLE_DASH_FEAT = /\s*[-–—]\s*(?:feat\.?|ft\.?|featuring|with|prod\.?)\b.*$/i;
  const SONG_TITLE_DASH_EDITION = /\s*[-–—]\s*(?:(?:\d{4}\s+)?remaster(?:ed)?(?:\s+\d{4})?(?:\s+version)?|radio edit|single version|album version|bonus track|deluxe(?: edition)?|explicit|clean|mono|stereo)\s*$/i;
  // DJ 版本：DJ版 / DJ Remix / DJ Mix / (DJ) / 末尾 - DJ。只认这些版本写法，
  // 避免把 "DJ Got Us Fallin' In Love" 这类曲名当成 DJ 版本。
  const DJ_VERSION_MARK = /dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club)|[（(\[]\s*dj\s*[)）\]]|(?:^|[\s\-–—])dj\s*$/i;
  const SONG_TITLE_DASH_DJ = /\s*[-–—]\s*dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club).*$|\s*[-–—]\s*dj\s*$/i;
  const SONG_TITLE_LEADING_DJ = /^\s*dj\s*(?:版|remix|mix|version|edit|抖音|舞曲|慢摇|house|club)\s*[-–—:]?\s*/i;
  const ARTIST_SPLIT = /[,，、/;&]|\b(?:feat\.?|ft\.?|featuring|with)\b/i;
  const CJK_MARK = /[\u3400-\u9fff]/;
  const KANA_MARK = /[\u3040-\u30ff]/;
  const HANGUL_MARK = /[\uac00-\ud7af]/;
  const HAN_MARK = /[\u4e00-\u9fff]/;

  // 响应体上限：官方歌词正常 < 300 KiB，第三方 JSON 也远小于 2 MiB。
  // 超过上限直接放行 / 当作没查到，避免异常响应把脚本内存打爆。
  const MAX_LYRICS_BYTES = 2 * 1024 * 1024;
  const MAX_HTTP_JSON_BYTES = 2 * 1024 * 1024;

  let settled = false;
  let deadline;
  let plainTimer;
  let plainFallback = null;
  // plainFallback 里的时间轴是不是「按行均分」编出来的（伪同步）。
  let plainFallbackPseudo = false;
  let onPlainFallback = null;
  let cacheKey = "";
  // 第三方源的应答情况。miss 标记（5 分钟内不再补卡）只在「确实有源回了答、
  // 且都说没歌词」时才写；全部请求都失败时是临时故障（代理没连上、App 在后台
  // 被挂起、脚本被掐），不能拿来判这首歌没歌词，否则回到前台的这 5 分钟里
  // 歌词卡会一直被挡掉。
  let netAnswered = 0;
  // 主链路 settle 之后，嵌套查询（ISRC 反查、预取）仍然可以继续跑：它们不再影响
  // 已经交给客户端的响应，结果只写缓存。stopped() 因此在嵌套轮里保持 false。
  let nestedRuns = 0;
  // 预取轮：辅助模式下替「下一首」查歌词，绝对不能碰 $done（滚动页响应早就交回去了）。
  let prefetching = false;
  const stopped = () => settled && !nestedRuns;
  const markMiss = () => {
    if (!trackId || !netAnswered) return;
    writeMark(MISS_KEY, { id: trackId, at: Date.now() });
  };

  const finish = (value) => {
    if (settled || prefetching) return;
    settled = true;
    if (deadline !== undefined && typeof clearTimeout === "function") clearTimeout(deadline);
    if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
    writeMark(PENDING_KEY, null);
    // 请求阶段没有 $response：Loon / Egern / Shadowrocket 用 { response } 直接
    // 返回合成结果，跳过官方 color-lyrics 请求。
    if (!res) {
      $done(value && (value.status || value.body) ? { response: value } : {});
      return;
    }
    $done(value);
  };

  if (HELPER) {
    // 辅助模式：feed 脚本只复用缓存查询与补卡判断，不发起歌词查询。
    // 曲目元数据回填：feed 从 scrollsita 里抄到的曲名 / 歌手写进同一份缓存。
    globalThis.__spotifyRememberTrackMeta = rememberTrackMeta;

    // 最近确认没有歌词的曲目不再补空卡；已经查到歌词、或有歌词请求在路上时
    // 以实际进度为准，避免旧的 miss 标记把这次可能成功的歌词挡掉。
    globalThis.__spotifyLyricsCard = (id) => {
      if (!id || !flag(opt.enable_lyrics, true)) return false;
      if (readLyricsCache(lyricsCacheKey(id), id)) return true;
      if (activeMark(PENDING_KEY, id, PENDING_TTL_MS)) return true;
      if (activeMark(MISS_KEY, id, MISS_TTL_MS)) return false;
      return true;
    };

    // ---- 预取下一首歌词 ---------------------------------------------------
    //
    // 由 feed 脚本在滚动页里调用（fire-and-forget，绝不等待）：把队列里下一首的
    // 歌词先查出来写进缓存，换歌后客户端请求 color-lyrics 时请求阶段就直接命中。
    // 只在辅助模式里有这功能 —— 这条链路没有主响应要交付，多等几秒没代价。
    //
    // 去重：已经缓存过、或 30 分钟内试过同一首，都不再打网络。
    const prefetchMark = (id) => {
      const map = readJsonMap(PREFETCH_KEY) || {};
      const at = Number(map[id]);
      return Number.isFinite(at) && at > 0 && Date.now() - at < PREFETCH_TTL_MS;
    };
    const rememberPrefetch = (id) => {
      const map = readJsonMap(PREFETCH_KEY) || {};
      map[id] = Date.now();
      const ids = Object.keys(map).sort((a, b) => Number(map[b]) - Number(map[a]));
      for (const key of ids.slice(PREFETCH_MARK_MAX)) delete map[key];
      writeJsonMap(PREFETCH_KEY, map);
    };

    globalThis.__spotifyPrefetch = (id) => {
      const target = id ? String(id) : "";
      if (!target || !prefetchNextOn || !flag(opt.enable_lyrics, true)) return false;
      if (readLyricsCache(lyricsCacheKey(target), target)) return false;
      if (prefetchMark(target)) return false;
      // 没有曲名 / 歌手时要先请求 open.spotify.com，预取就没意义了：等元数据到了再说。
      const meta = cachedTrackMeta(target);
      if (!meta || !meta.title) return false;
      rememberPrefetch(target);
      // 辅助模式下没有主链路在跑，这里的模块级状态可以安全改写。
      prefetching = true;
      trackId = target;
      cacheKey = lyricsCacheKey(target);
      plainFallback = null;
      plainFallbackPseudo = false;
      resolveLyrics((payload) => {
        if (payload) writeLyricsCache(cacheKey, payload);
      });
      return true;
    };
    return;
  }

  const rawBody = res ? res.body : null;
  const rawBytes = toBytes(rawBody);
  const rawLength = "string" == typeof rawBody ? rawBody.length : rawBytes.length;
  if (rawLength > MAX_LYRICS_BYTES) {
    // 超大的官方响应不解析，原样放行；超大 404 也当作没有歌词。
    finish({});
    return;
  }

  // protobuf 不先转 UTF-8：只检查第一个非空白字节来区分 JSON。
  let start = 0;
  while (start < rawBytes.length && (rawBytes[start] === 32 || rawBytes[start] === 9 || rawBytes[start] === 10 || rawBytes[start] === 13)) start++;
  const trimmed = typeof rawBody === "string" ? rawBody.trim() : rawBytes[start] === 123 ? toText(rawBytes).trim() : "";
  const hasBody = typeof rawBody === "string" ? trimmed.length > 0 : rawBytes.length > 0;
  const status = Number(res && (res.status || res.statusCode));

  function headerValue(headers, name) {
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== name) continue;
      const value = headers[key];
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value === undefined || value === null ? "" : value);
    }
    return "";
  }

  // 404 的 body 和 Content-Type 都描述错误，不能用来推断歌词响应格式。
  // 补全时遵循请求的 format / Accept；没有提示则用客户端默认格式。
  function requestedProtoMode() {
    const accept = headerValue(req && req.headers, "accept").toLowerCase();
    const format = /[?&]format=(json|protobuf)(?:&|$)/i.exec(url);
    const requested = format ? format[1].toLowerCase() === "protobuf"
      : accept.indexOf("protobuf") >= 0 ? true
      : accept.indexOf("json") >= 0 ? false
      : null;
    return requested !== null ? requested : !desktop;
  }
  const protoMode = status === 200 && hasBody
    ? trimmed.charAt(0) !== "{"
    : requestedProtoMode();

  // iOS request hook: proxy the official request ourselves and race it against the
  // third-party lookup. Loon's request script can return a synthetic response, so this
  // removes the request/response phase handoff and starts both paths at once.
  if (!res) {
    const loonRuntime = typeof $loon !== "undefined";
    if (!HELPER && !desktop && trackId && flag(opt.enable_lyrics, true)) {
      cacheKey = lyricsCacheKey(trackId);
      const cached = readLyricsCache(cacheKey, trackId);
      if (cached) {
        writeMark(MISS_KEY, null);
        writeMark(PENDING_KEY, null);
        if (requestedProtoMode()) {
          const bytes = encodeProto(cached.payload.lyrics.lines, cached.payload.lyrics.syncType,
            cached.payload.lyrics.provider, cached.payload.lyrics.providerLyricsId,
            cached.payload.lyrics.language, cached.payload.colors);
          finish({ status: 200, headers: { "Content-Type": "application/vnd.google.protobuf" }, body: bytes });
        } else {
          const body = JSON.stringify(jsonPayload(cached.payload));
          finish({ status: 200, headers: syntheticHeaders("application/json; charset=utf-8", encoder.encode(body).length), body: body });
        }
        return;
      }

      if (!loonRuntime) {
        markPending();
        finish({});
        return;
      }
      if (typeof $httpClient === "undefined" || !$httpClient || typeof $httpClient.get !== "function") {
        markPending();
        finish({});
        return;
      }
      markPending();
      const officialHeaders = {};
      const requestHeaders = req && req.headers && typeof req.headers === "object" ? req.headers : {};
      for (const key in requestHeaders) {
        if (!Object.prototype.hasOwnProperty.call(requestHeaders, key)) continue;
        const lower = String(key).toLowerCase();
        if (lower === "host" || lower === "content-length" || lower === "connection" || lower === "accept-encoding") continue;
        officialHeaders[key] = requestHeaders[key];
      }
      const officialUrl = url;
      let officialDone = false;
      let officialMiss = null;
      let providersDone = false;
      const finishOfficial = (error, response, data) => {
        if (settled) return;
        const code = Number(response && (response.status || response.statusCode));
        if (error || !response) {
          officialDone = true;
          return maybeFinishRace();
        }
        const bytes = typeof data === "string" ? encoder.encode(data) : toBytes(data);
        if (bytes.length > MAX_LYRICS_BYTES) {
          officialDone = true;
          officialMiss = { status: code || 502, headers: response.headers || {}, body: data };
          return maybeFinishRace();
        }
        let first = 0;
        while (first < bytes.length && (bytes[first] === 32 || bytes[first] === 9 || bytes[first] === 10 || bytes[first] === 13)) first += 1;
        const text = typeof data === "string" ? data.trim() : (bytes[first] === 123 ? toText(bytes).trim() : "");
        const isJson = text.charAt(0) === "{";
        if (code === 200 && bytes.length) {
          if (isJson && hasLyrics(text)) {
            const rewritten = rewriteOfficialJson(text);
            return winOfficial({ status: 200, headers: response.headers || {}, body: rewritten || data });
          }
          if (!isJson) {
            const inspected = inspectProto(bytes);
            if (inspected && inspected.count > 0) {
              const rewritten = rewriteOfficialProto(inspected);
              return winOfficial({ status: 200, headers: response.headers || {}, body: rewritten || data });
            }
          }
        }
        officialDone = true;
        officialMiss = { status: code || 404, headers: response.headers || {}, body: data };
        maybeFinishRace();
      };
      const winOfficial = (value) => {
        if (settled) return;
        settled = true;
        if (deadline !== undefined && typeof clearTimeout === "function") clearTimeout(deadline);
        if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
        writeMark(PENDING_KEY, null);
        writeMark(MISS_KEY, null);
        const headers = {};
        const source = value.headers || {};
        for (const key in source) {
          const lower = String(key).toLowerCase();
          if (lower === "content-length" || lower === "content-encoding" || lower === "transfer-encoding") continue;
          headers[key] = source[key];
        }
        headers["Content-Length"] = String(typeof value.body === "string" ? encoder.encode(value.body).length : toBytes(value.body).length);
        $done({ response: { status: value.status, headers: headers, body: value.body } });
      };
      const maybeFinishRace = () => {
        if (settled || !officialDone || (!providersDone && !plainFallback)) return;
        if (plainFallback) writeLyricsCache(cacheKey, plainFallback);
        if (plainFallback) emit(plainFallback);
        else finish(officialMiss ? { status: officialMiss.status, headers: officialMiss.headers, body: officialMiss.body } : {});
      };
      const raceDeadline = () => {
        if (settled) return;
        if (plainFallback) {
          writeLyricsCache(cacheKey, plainFallback);
          emit(plainFallback);
        } else if (officialDone && officialMiss) {
          finish(officialMiss);
        } else {
          finish({});
        }
      };
      onPlainFallback = maybeFinishRace;
      if (typeof setTimeout === "function") deadline = setTimeout(raceDeadline, LYRICS_DEADLINE_MS);

      try {
        $httpClient.get({ url: officialUrl, headers: officialHeaders, timeout: LYRICS_DEADLINE_MS, "binary-mode": true }, finishOfficial);
      } catch (e) {
        officialDone = true;
      }
      if (settled) return;
      resolveLyrics((payload) => {
        providersDone = true;
        if (settled) {
          if (payload) writeLyricsCache(cacheKey, payload);
          return;
        }
        if (payload && (payload.lyrics.syncType === "LINE_SYNCED" || payload.lyrics.syncType === "SYLLABLE_SYNCED")) {
          writeLyricsCache(cacheKey, payload);
          emit(payload);
          return;
        }
        if (payload) plainFallback = payload;
        else markMiss();
        maybeFinishRace();
      });
      return;
    }
    markPending();
    finish({});
    return;
  }

  // 不把登录、限流或服务端错误伪装成有歌词。
  if (status !== 200 && status !== 404) {
    finish({});
    return;
  }

  // 官方「没有歌词」不一定回 404：protobuf 请求经常是 200 + 空体。
  // 空体有两种情况，必须区分开：
  //   * 上游确实没内容（content-length 缺失或 0）-> 当作没有歌词，去第三方补；
  //   * body 没交到脚本手里（content-length > 0）-> 原样放行，不能把官方歌词顶掉。
  if (status === 200 && !hasBody) {
    const declared = Number(headerValue(res && res.headers, "content-length"));
    if (Number.isFinite(declared) && declared > 0) {
      finish({});
      return;
    }
  } else if (status === 200) {
    if (protoMode) {
      // 解析不了（拿不到原始字节）时返回 -1，宁可放行也不要顶掉官方歌词。
      const inspected = rawBytes.length ? inspectProto(rawBytes) : null;
      const count = inspected ? inspected.count : -1;
      if (count !== 0) {
        // 免费号的歌词有每月额度，用完服务端会在 restriction（字段 14）里回
        // monthlyLimitReached，客户端就只显示「额度已用完」。归一成 showLyrics 再放行。
        const cleaned = count > 0 ? rewriteOfficialProto(inspected) : null;
        if (cleaned) {
          finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        } else {
          // 原样放行，但 count > 0 说明官方歌词确实有内容。
          finish({});
        }
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = rewriteOfficialJson(trimmed);
      if (cleaned) {
        finish(jsonResponse(cleaned));
      } else {
        finish({});
      }
      return;
    }
  }

  // 歌词结果缓存：同一首歌在播放器 / 歌词页 / 歌词卡之间的重复请求不再重复查源。
  // 只缓存「官方没有歌词」的分支，官方歌词不会走到这里。
  cacheKey = lyricsCacheKey(trackId);
  const cachedLyrics = readLyricsCache(cacheKey, trackId);
  if (cachedLyrics) {
    writeMark(MISS_KEY, null);
    emit(cachedLyrics.payload);
    return;
  }

  // 总时限；超时后用纯文本兜底，没有就放行。超时不写 miss 标记：第三方歌词
  // 可能还在路上，后续到达的歌词会写进缓存，用户重新进歌词页时请求阶段直接命中。
  // 只有所有第三方源都确认没歌词时才写 miss。
  if (typeof setTimeout === "function") deadline = setTimeout(() => {
    if (settled) return;
    if (plainFallback) {
      writeLyricsCache(cacheKey, plainFallback);
      writeMark(MISS_KEY, null);
      emit(plainFallback);
    } else {
      finish({});
    }
  }, LYRICS_DEADLINE_MS);
  resolveLyrics((payload) => {
    if (settled) {
      // 响应已经放行（超时 / 已出结果）：晚到的歌词照样写缓存 —— ISRC 反查和预取
      // 都会走到这里，下次打开歌词页 / 卡片直接命中。
      if (payload) writeLyricsCache(cacheKey, payload);
      else markMiss();
      return;
    }
    writeLyricsCache(cacheKey, payload);
    if (!payload) {
      markMiss();
      finish({});
      return;
    }
    writeMark(MISS_KEY, null);
    emit(payload);
  });

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    resolvePublicLyrics(cb);
  }

  function resolvePublicLyrics(cb) {
    // 客户端拉过的元数据优先：命中时直接查歌词，open.spotify.com 一次都不请求，
    // 歌词页背景用默认底色（不再为封面配色抓 embed 页面）。
    const startWith = (info, colorOf) => {
      runWithIsrc(sourceOrder(info.title, info.artist), info.title, info.artist, cb, info.duration, colorOf);
    };
    const cached = cachedTrackMeta(trackId);
    if (cached) {
      startWith(cached, () => cached.color || null);
      return;
    }
    const oembedUrl = "https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + trackId);
    const embedUrl = "https://open.spotify.com/embed/track/" + trackId;
    let meta = null;
    let embed = null;
    let metaDone = false;
    let embedStarted = false;
    let embedDone = false;
    let started = false;
    const merged = () => {
      const oembed = {
        title: String((meta && meta.title) || ""),
        artist: String((meta && meta.author_name) || "").trim(),
      };
      const page = embed || {};
      // 缺歌手或 Live 曲目时以 embed 的写法 / 时长为准，其余优先 oEmbed。
      const preferEmbed = !oembed.title || !oembed.artist || isLive(oembed.title);
      return {
        title: String((preferEmbed ? page.title : oembed.title) || oembed.title || page.title || ""),
        artist: String((preferEmbed ? page.artist : oembed.artist) || oembed.artist || page.artist || "").trim(),
        duration: page.duration,
      };
    };
    const colorOf = () => (embed && embed.color) || null;
    const start = () => {
      if (started) return;
      const info = merged();
      if (!info.title) {
        started = true;
        cb(null);
        return;
      }
      started = true;
      rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, colorOf());
      startWith({ title: info.title, artist: info.artist, duration: info.duration }, colorOf);
    };
    // embed 提供封面主色与兜底元数据；与 oEmbed 并行发出，谁先到用谁。
    const beginEmbed = () => {
      if (embedStarted) return;
      embedStarted = true;
      httpGetText(embedUrl, (html) => {
        embed = parseEmbedTrack(html);
        embedDone = true;
        // 歌词可能已经先返回了；embed 晚到时只补一份封面配色与更准确的元数据。
        if (started && embed && embed.color) {
          const info = merged();
          rememberTrackMeta(trackId, info.title, info.artist, info.duration ? info.duration * 1000 : 0, embed.color);
        }
        maybeStart();
      }, null, META_TIMEOUT_MS);
    };
    const maybeStart = () => {
      if (started) return;
      const info = merged();
      if (!metaDone) return;
      if (!info.title) {
        // oEmbed 没给曲名时靠 embed 补；embed 也失败才放弃。
        if (!embedDone) {
          beginEmbed();
          return;
        }
        start();
        return;
      }
      // 缺歌手、Live 或 DJ 版本要靠 embed 的歌手 / 时长做校验，才等 embed。
      if ((!info.artist || isLive(info.title) || isDj(info.title)) && !embedDone) {
        beginEmbed();
        return;
      }
      // 正常曲目立即开始查歌词，同时发出配色请求，但不等待它。
      beginEmbed();
      start();
    };
    // 两个来源并行：oEmbed 有曲名 / 歌手，embed 有封面色和更规范的写法。
    beginEmbed();
    httpGetJson(oembedUrl, (data) => {
      meta = data;
      metaDone = true;
      maybeStart();
    }, null, META_TIMEOUT_MS);
    // feed 回填的元数据可能比 oEmbed 先就绪：100ms 看一次缓存，最多 2s。
    // 命中就直接开始查歌词，oEmbed / embed 晚到只补封面配色；没命中则保持原流程。
    if (storeBackend() && typeof setTimeout === "function") {
      let waited = 0;
      const poll = () => {
        setTimeout(() => {
          if (started || settled) return;
          const hit = cachedTrackMeta(trackId);
          if (hit) {
            started = true;
            startWith(hit, () => (embed && embed.color) || hit.color || null);
            return;
          }
          waited += META_POLL_MS;
          if (waited < META_WAIT_MS) poll();
        }, META_POLL_MS);
      };
      poll();
    }
  }

  // ---- 歌词源 -----------------------------------------------------------

  function sourceOrder(title, artist) {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    // Musixmatch 是 Spotify 的官方歌词上游，还能用 track_spotify_id 直查，匹配
    // 精度最好。它在 auto 里排在最后：四个源并行发出，前三个有结果就立刻用，
    // 它只负责前三个都落空时再兜一层（以前只在显式选择时才查）。
    const auto = CJK_MARK.test(title + artist)
      ? ["netease", "qq", "lrclib", "musixmatch"] : ["lrclib", "netease", "qq", "musixmatch"];
    if (wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq") return [wanted];
    return auto;
  }

  // 主链路：先按正常顺序查一轮；全部落空且开了 ISRC 反查时，再用 Deezer 的
  // 规范曲名 / 歌手和 ISRC 补两枪。这一轮通常在客户端 4.5s 窗口之后才回来，
  // 结果是写进缓存（下次打开 / 卡片直接命中），不占主链路的时间预算。
  function runWithIsrc(order, title, artist, done, duration, colorOf) {
    runSource(order, title, artist, (payload) => {
      if (payload || !isrcLookup) {
        done(payload);
        return;
      }
      nestedRuns += 1;
      const endNested = () => {
        nestedRuns = Math.max(0, nestedRuns - 1);
      };
      let left = 0;
      let settledInner = false;
      const finishInner = (found) => {
        if (settledInner) {
          if (found) writeLyricsCache(cacheKey, found);
          return;
        }
        if (found) {
          settledInner = true;
          endNested();
          done(found);
          return;
        }
        left -= 1;
        if (left > 0) return;
        settledInner = true;
        endNested();
        done(null);
      };
      lookupDeezer(title, artist, duration, (canonical) => {
        if (!canonical) {
          finishInner(null);
          return;
        }
        // 1) ISRC 直查 Musixmatch：不再依赖任何名字匹配。
        // 2) 用 Deezer 的规范曲名 / 歌手再查一轮曲库。
        left = canonical.isrc ? 2 : 1;
        if (canonical.isrc) {
          lookupMusixmatchByIsrc(canonical.isrc, (record) => {
            finishInner(record ? payloadFrom(record, canonical.duration || duration) : null);
          });
        }
        runSource(sourceOrder(canonical.title, canonical.artist), canonical.title, canonical.artist,
          (payload) => finishInner(payload), canonical.duration || duration, colorOf);
      });
    }, duration, colorOf);
  }

  // 并发查询所有来源：首个通过校验的同步歌词胜出；只有纯文本时等全部结束。
  // settled 后不再 emit（响应已放行），但仍然写缓存：用户重新进歌词页时
  // 请求阶段就能直接命中。全部源都确认没歌词时才写 miss 标记。
  function runSource(order, title, artist, done, duration, colorOf) {
    if (stopped()) return;
    if (!order.length) {
      done(null);
      return;
    }
    let remaining = order.length;
    let finished = false;
    const checkAllDone = () => {
      if (!remaining && !finished) {
        finished = true;
        done(plainFallback);
      }
    };
    for (const name of order) {
      if (stopped() || finished) return;
      lookup(name, title, artist, duration, (record) => {
        // 伪同步要按歌曲时长均分时间轴，时长只能从这一层传下去。
        if (record && duration && !record.trackDurationMs) record.trackDurationMs = Number(duration) * 1000;
        if (stopped()) {
          // deadline 超时放行：歌词晚到时写缓存，下次请求阶段直接命中。
          if (record && colorOf) record.albumColor = colorOf();
          const latePayload = buildPayload(record);
          if (latePayload) writeLyricsCache(cacheKey, latePayload);
          remaining -= 1;
          checkAllDone();
          return;
        }
        if (finished) return;
        if (record && colorOf) record.albumColor = colorOf();
        // record.pseudo 表示这份 payload 的时间轴是按行均分编出来的：它不能让
        // 这一轮提前收工，得等真正的同步歌词；只有实在没有同步歌词时才用它兜底。
        const pseudo = !!(record && record.pseudo);
        const payload = buildPayload(record);
        if (payload && (order.length === 1 || ((payload.lyrics.syncType === "LINE_SYNCED" || payload.lyrics.syncType === "SYLLABLE_SYNCED") && !pseudo))) {
          finished = true;
          done(payload);
          return;
        }
        if (payload && (!plainFallback || (plainFallbackPseudo && !pseudo))) {
          plainFallback = payload;
          plainFallbackPseudo = pseudo;
          // 有纯文本但同步歌词还在路上时，先把纯文本发出去，后续结果不再覆盖。
          // deadline 超时放行后仍然写缓存，供下次请求命中。
          if (typeof setTimeout === "function") plainTimer = setTimeout(() => {
            if (!plainFallback) return;
            writeLyricsCache(cacheKey, plainFallback);
            if (!settled) {
              if (onPlainFallback) onPlainFallback();
              else emit(plainFallback);
            }
          }, PLAIN_FALLBACK_MS);
        }
        remaining -= 1;
        checkAllDone();
      });
    }
  }

  function lookup(name, title, artist, duration, cb) {
    if (name === "lrclib") return lookupLrclib(title, artist, duration, cb);
    if (name === "netease") return lookupNetease(title, artist, duration, cb);
    if (name === "qq") return lookupQq(title, artist, duration, cb);
    if (name === "musixmatch") return lookupMusixmatch(title, artist, duration, cb);
    cb(null);
  }

  // LRCLIB：/api/get 与 /api/search 都会带回歌词。完整曲名、去掉装饰括号后的
  // 曲名、以及繁→简折叠后的写法，各发 get + search；歌名-only 的搜索也放进
  // 同一批。全部并行，首个通过校验的同步歌词立即返回——不再有串行的兜底轮次。
  function lookupLrclib(title, artist, duration, cb) {
    const cleanTitle = queryTitle(title);
    // DJ 版本常换制作人署名，查询时不带歌手；pickRecord 仍会拿 artist 做打分。
    const queryArtist = isDj(title) ? "" : artist;
    const fold = (value) => (foldHanVariants && typeof SPOTIFY_HAN_VARIANTS !== "undefined"
      ? SPOTIFY_HAN_VARIANTS.fold(String(value || ""))
      : String(value || ""));

    // 每个曲名配对应的歌手写法；繁简折叠后的曲名配折叠后的歌手。
    const variants = [];
    const addVariant = (name, singer) => {
      const text = String(name || "").trim();
      if (!text) return;
      const key = text + "\n" + String(singer || "");
      if (variants.some((item) => item.key === key)) return;
      variants.push({ key: key, name: text, artist: String(singer || "") });
    };
    addVariant(title, queryArtist);
    addVariant(cleanTitle, queryArtist);
    if (foldHanVariants && typeof SPOTIFY_HAN_VARIANTS !== "undefined") {
      const foldedArtist = fold(queryArtist);
      addVariant(fold(title), foldedArtist);
      addVariant(fold(cleanTitle), foldedArtist);
    }

    const lists = [];
    const records = [];
    let done = false;
    // 候选必须摊平成一维：search 回来的是数组，get 回来的是单条记录。
    // 以前这里直接 concat 数组，pickRecord 收到的是「数组套数组」，只有 /api/get
    // 的结果会被考虑，search 里的同名版本全被丢掉 —— 纯文本兜底基本等于没生效。
    const all = () => {
      const out = [];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) out.push(item);
      }
      for (const record of records) out.push(record);
      return out;
    };
    const syncedPick = () => pickRecord(all().filter(isSynced), title, duration, artist);

    // 先把所有请求列出来再统一发出：同步回调不会在批次中途把 pending 减到 0，
    // pending 减到 0，避免提前判定「都没命中」。
    const specs = [];
    const addSpec = (path, name, singer) => {
      const query = "track_name=" + encodeURIComponent(name) + (singer ? "&artist_name=" + encodeURIComponent(singer) : "");
      const url = "https://lrclib.net/api/" + path + "?" + query;
      if (specs.some((item) => item.url === url)) return;
      specs.push({ url: url, path: path });
    };
    for (const item of variants) {
      addSpec("get", item.name, item.artist);
      addSpec("search", item.name, item.artist);
    }
    // 歌手写法不一致（feat. / 多歌手 / 翻译名）时的兜底也并进首轮。
    addSpec("search", cleanTitle || title, "");
    const foldedName = fold(cleanTitle || title);
    if (foldedName !== (cleanTitle || title)) addSpec("search", foldedName, "");
    if (!specs.length) {
      cb(null);
      return;
    }
    let pending = specs.length;

    const settle = () => {
      pending -= 1;
      if (done) return;
      const hit = syncedPick();
      if (hit) {
        done = true;
        cb(withProvider(hit, "LRCLIB"));
        return;
      }
      if (pending) return;
      done = true;
      // 严格规则一条都没命中时，再用「同名 + 时长」放宽一轮：歌手写法对不上
      // （feat. / 制作人署名 / 翻译名）的曲目在这一轮会被救回来。
      const picked = pickRecord(all(), title, duration, artist)
        || pickRecord(all(), title, duration, artist, matchesSongLoose);
      cb(picked ? withProvider(picked, "LRCLIB") : null);
    };

    for (const spec of specs) {
      httpGetJson(spec.url, (data) => {
        if (spec.path === "get") {
          if (data && "object" === typeof data) records.push(data);
        } else if (Array.isArray(data)) {
          lists.push(data);
        }
        settle();
      });
    }
  }

  // 网易云：搜索接口不需要 token，中文曲库覆盖最好。
  function lookupNetease(title, artist, duration, cb) {
    const queryArtist = isDj(title) ? "" : artist;
    const query = encodeURIComponent(queryTitle(title) + (queryArtist ? " " + queryArtist : ""));
    const headers = { Referer: "https://music.163.com/", "User-Agent": BROWSER_UA };
    const artistOf = (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []);
    const durationOf = (item) => Number(item.duration) / 1000;
    httpGetJson("https://music.163.com/api/search/get?s=" + query + "&type=1&limit=10&offset=0", (data) => {
      const songs = data && data.result && data.result.songs;
      // 同一首歌的歌词只取一次：alias 补全期间的预取和正式候选会并行，
      // 后到的调用合并到在途请求上，不重复打接口。
      const lyrics = Object.create(null);
      const waiting = Object.create(null);
      const fetchLyric = (song, next) => {
        const id = String(song.id);
        if (lyrics[id] !== undefined) {
          next(lyrics[id]);
          return;
        }
        if (waiting[id]) {
          waiting[id].push(next);
          return;
        }
        waiting[id] = [next];
        httpGetJson("https://music.163.com/api/song/lyric/v1?id=" + id + "&cp=false&lv=0&kv=0&tv=0&rv=0&yv="
          + (wordLyrics ? "0" : "-1") + "&ytv=0&yrv=0", (lyric) => {
          const wordText = lyric && lyric.yrc && lyric.yrc.lyric;
          const wordLines = wordLyrics && typeof wordText === "string" ? parseYrc(wordText) : [];
          const text = lyric && lyric.lrc && lyric.lrc.lyric;
          const record = wordLines.length
            ? { provider: "NetEase", providerId: id, wordLyrics: wordLines, syncedLyrics: text || "" }
            : text ? { provider: "NetEase", providerId: id, syncedLyrics: text } : null;
          lyrics[id] = record;
          const callbacks = waiting[id] || [];
          delete waiting[id];
          for (const fn of callbacks) fn(record);
        }, headers);
      };
      // 先按严格规则找；落空后先走歌手 alias 核对，alias 也对不上时再放宽。
      // 不能在 alias 之前就放宽歌手：同名的别的歌手版本会抢先命中，alias 白查。
      const ranked = rankSongs(songs, title, artist, duration, (item) => item.name, artistOf, durationOf);
      if (ranked.length) {
        tryCandidates(ranked, fetchLyric, cb);
        return;
      }
      // 搜索结果可能缺少歌手别名：只对匹配的曲目按歌手 ID 补全，最多 3 次请求。
      const pending = [];
      if (artist && Array.isArray(songs)) {
        const speculative = [];
        for (const song of songs) {
          if (!song || !matchesSong(title, "", duration, song.name, "", durationOf(song))) continue;
          const people = Array.isArray(song.artists) ? song.artists : [];
          if (matchesArtist(artist, artistOf(song))) continue;
          // 歌名 / 时长已对上、只差歌手写法：先把歌词取回来，alias 确认后直接复用。
          if (speculative.length < 2) speculative.push(song);
          for (const person of people) {
            if (!person || !/^\d+$/.test(String(person.id)) || pending.some((p) => p.id === person.id)) continue;
            if (pending.length < 3) pending.push(person);
          }
        }
        // 预取与歌手详情并行发出；晚到的结果由 fetchLyric 合并。
        for (const song of speculative) fetchLyric(song, () => {});
      }
      const resolve = () => {
        if (!pending.length) {
          tryCandidates(rankSongsWithFallback(songs, title, artist, duration, (item) => item.name, artistOf, durationOf), fetchLyric, cb);
          return;
        }
        // 歌手详情请求并行发出，全部回来后再统一补 alias。
        let left = pending.length;
        for (const person of pending) {
          httpGetJson("https://music.163.com/api/artist/" + person.id, (details) => {
            const verified = details && details.artist;
            if (verified && String(verified.id) === String(person.id) && Array.isArray(songs)) {
              for (const song of songs) {
                for (const candidate of (song && Array.isArray(song.artists) ? song.artists : [])) {
                  if (candidate && candidate.id === person.id) candidate.alias = artistNames(candidate).concat(artistNames(verified));
                }
              }
            }
            left -= 1;
            if (!left) {
              // 已经查过歌手 ID / alias 仍对不上，说明是另一位歌手的同名版本，
              // 不再用「同名 + 时长」放宽，避免贴错歌词。
              tryCandidates(rankSongs(songs, title, artist, duration, (item) => item.name, artistOf, durationOf), fetchLyric, cb);
            }
          }, headers);
        }
      };
      resolve();
    }, headers);
  }

  // QQ 音乐：搜索拿 songmid，再用 nobase64=1 取明文 LRC。
  function lookupQq(title, artist, duration, cb) {
    const queryArtist = isDj(title) ? "" : artist;
    const query = encodeURIComponent(queryTitle(title) + (queryArtist ? " " + queryArtist : ""));
    const headers = { Referer: "https://y.qq.com/", "User-Agent": MOBILE_UA };
    // QQ 旧版 client_search_cp 在部分网络下会直接 500 且要等 5 秒；
    // search_for_qq_cp 是同一个搜索服务的移动端入口，返回结构一致。
    httpGetJson("https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=" + query + "&format=json&n=10&p=1", (data) => {
      const list = data && data.data && data.data.song && data.data.song.list;
      const candidates = rankSongsWithFallback(list, title, artist, duration, (item) => item.songname,
        (item) => (item.singer || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.interval));
      tryCandidates(candidates, (picked, next) => {
        httpGetJson(
          "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=" + picked.songmid + "&format=json&nobase64=1&g_tk=5381",
          (lyric) => {
            const text = lyric && lyric.lyric;
            next(text ? { provider: "QQ Music", providerId: String(picked.songmid), syncedLyrics: text } : null);
          },
          headers,
        );
      }, cb);
    }, headers);
  }

  // Musixmatch：沿用 EeveeSpotify 的做法，先用固定 app_id 换匿名 token，
  // 再调 macro.subtitles.get 拿逐行字幕。两跳各给短超时：整条链路的总预算是
  // 4.5s，token 慢就等于这一源白等。token 大约 10 分钟有效，存起来省一次往返。
  function cachedMusixToken() {
    const mark = readMark(MMX_TOKEN_KEY);
    if (!mark || !mark.token || !Number(mark.at)) return "";
    if (Date.now() - Number(mark.at) >= MMX_TOKEN_TTL_MS) return "";
    return String(mark.token);
  }

  // 按 spotify id 或 isrc 取字幕；validate 用来做曲目校验（ISRC 直查时不需要）。
  function musixSubtitles(params, validate, cb) {
    const withToken = (userToken) => {
      if (!userToken) {
        cb(null);
        return;
      }
      let target = "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" + MMX_APP_ID +
        "&usertoken=" + encodeURIComponent(userToken) + "&subtitle_format=lrc&user_language=zh";
      if (params.isrc) {
        target += "&track_isrc=" + encodeURIComponent(params.isrc);
      } else {
        target += "&track_spotify_id=" + encodeURIComponent(params.spotifyId || "");
        if (params.title) target += "&q_track=" + encodeURIComponent(params.title);
        if (params.artist) target += "&q_artist=" + encodeURIComponent(params.artist);
      }
      httpGetJson(target, (data) => {
        const status = data && data.message && data.message.header && data.message.header.status_code;
        const calls = data && data.message && data.message.body && data.message.body.macro_calls;
        // token 失效时清掉缓存，下一次重新换。
        if (data && Number(status) !== 200) writeMark(MMX_TOKEN_KEY, null);
        const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
        const track = matched && matched.body && matched.body.track;
        // 字幕接口可能返回无关的默认结果，需同时校验曲目匹配与字幕状态。
        if (Number(status) !== 200 || !matched || !matched.header || Number(matched.header.status_code) !== 200 ||
            !track || Number(track.instrumental) === 1 || (validate && !validate(track))) {
          cb(null);
          return;
        }
        const sub = calls && calls["track.subtitles.get"] && calls["track.subtitles.get"].message;
        const list = sub && sub.body && sub.body.subtitle_list;
        const first = Array.isArray(list) ? list[0] : null;
        const body = first && first.subtitle && first.subtitle.subtitle_body;
        if (!sub || !sub.header || Number(sub.header.status_code) !== 200 || !body || Number(first.subtitle.restricted) === 1) {
          cb(null);
          return;
        }
        cb({ provider: "Musixmatch", providerId: String(first.subtitle.subtitle_id || ""), syncedLyrics: body });
      }, null, MMX_TIMEOUT_MS);
    };
    const cached = cachedMusixToken();
    if (cached) {
      withToken(cached);
      return;
    }
    httpGetJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + MMX_APP_ID, (token) => {
      const userToken = token && token.message && token.message.body && token.message.body.user_token;
      if (userToken) writeMark(MMX_TOKEN_KEY, { token: String(userToken), at: Date.now() });
      withToken(userToken);
    }, null, MMX_TOKEN_TIMEOUT_MS);
  }

  function lookupMusixmatch(title, artist, duration, cb) {
    // 该接口不提供足够的场次信息，Live 曲目直接跳过。
    if (isLive(title)) { cb(null); return; }
    const queryArtist = isDj(title) ? "" : artist;
    musixSubtitles(
      { spotifyId: trackId, title: title, artist: queryArtist },
      (track) => matchesSong(title, artist, duration, track.track_name, track.artist_name, Number(track.track_length)),
      cb,
    );
  }

  function lookupMusixmatchByIsrc(isrc, cb) {
    // ISRC 已经是「同一首录音」的强标识，这里不再做名字校验。
    musixSubtitles({ isrc: isrc }, null, cb);
  }

  // ---- ISRC 反查（Deezer 公开 API，不需要 token）--------------------------
  //
  // 用它解决两类漏配：Spotify 上的曲名 / 歌手写法太特殊（feat.、译名、装饰括号、
  // CJK 罗马字），以及同名不同版。拿到 Deezer 的规范写法与 ISRC 后：
  //   * Musixmatch 可以用 track_isrc 直查字幕，完全不依赖名字匹配；
  //   * LRCLIB / 网易云 / QQ 用规范写法再搜一轮，命中率明显高于原名。
  // Deezer 本身不提供歌词，它只用来「认出这首歌是谁」。
  function lookupDeezer(title, artist, duration, cb) {
    const clean = (value) => String(value || "").replace(/["\\]/g, " ").trim();
    const query = 'track:"' + clean(title) + '"' + (artist ? ' artist:"' + clean(artist) + '"' : "");
    httpGetJson(DEEZER_API + "/search?q=" + encodeURIComponent(query) + "&limit=5", (data) => {
      const list = data && Array.isArray(data.data) ? data.data : [];
      if (!list.length) {
        cb(null);
        return;
      }
      let picked = null;
      for (const item of list) {
        if (!item || !item.title) continue;
        const singer = item.artist && item.artist.name;
        if (matchesSong(title, artist, duration, item.title, singer, Number(item.duration))) {
          picked = item;
          break;
        }
      }
      if (!picked) {
        // 严格规则没命中时按放宽规则再试一次（同名 + 时长），仍然要求曲名完全一致。
        for (const item of list) {
          if (!item || !item.title) continue;
          const singer = item.artist && item.artist.name;
          if (matchesSongLoose(title, artist, duration, item.title, singer, Number(item.duration))) {
            picked = item;
            break;
          }
        }
      }
      if (!picked || !picked.id) {
        cb(null);
        return;
      }
      httpGetJson(DEEZER_API + "/2/track/" + picked.id, (detail) => {
        const track = detail && detail.id ? detail : null;
        if (!track || !track.title) {
          cb(null);
          return;
        }
        cb({
          title: String(track.title),
          artist: String((track.artist && track.artist.name) || (picked.artist && picked.artist.name) || ""),
          duration: Number(track.duration) || Number(picked.duration) || 0,
          isrc: String(track.isrc || ""),
        });
      }, null, DEEZER_TIMEOUT_MS);
    }, null, DEEZER_TIMEOUT_MS);
  }

  function withProvider(record, name) {
    const out = {};
    for (const key in record) {
      if (Object.prototype.hasOwnProperty.call(record, key)) out[key] = record[key];
    }
    out.provider = name;
    return out;
  }

  function isSynced(record) {
    return Boolean(record && "string" == typeof record.syncedLyrics && record.syncedLyrics.trim());
  }

  function rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf, matcher) {
    if (!Array.isArray(list)) return [];
    const wanted = normalize(queryTitle(title));
    const singer = normalize(artist);
    const matches = matcher || matchesSong;
    const score = (item) => {
      const name = normalize(queryTitle(nameOf(item)));
      const seconds = durationOf(item);
      return (name === wanted ? 4 : name.indexOf(wanted) === 0 ? 2 : 0)
        + (singer && matchesArtist(artist, artistOf(item)) ? 8 : 0)
        + (Number.isFinite(duration) && duration > 0 && Math.abs(seconds - duration) <= 4 ? 6 : 0);
    };
    return list.filter((item) => item && matches(title, artist, duration, nameOf(item), artistOf(item), durationOf(item)))
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  // 严格轮没结果时再按放宽规则挑一遍。曲名仍要完全相等，所以不会串到同名
  // 不同版的另一首；只有歌手写法不一致这类「曲库里其实有这首歌」的情况才会救回来。
  function rankSongsWithFallback(list, title, artist, duration, nameOf, artistOf, durationOf) {
    const strict = rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf);
    if (strict.length) return strict;
    return rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf, matchesSongLoose);
  }

  function isLive(title) {
    return LIVE_MARK.test(String(title));
  }

  function isDj(title) {
    return DJ_VERSION_MARK.test(String(title));
  }

  function stripDecorativeParentheses(value) {
    const text = String(value || "");
    const pairs = { "(": ")", "（": "）" };
    const stack = [];
    const remove = [];
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (pairs[char]) {
        stack.push({ start: i, close: pairs[char] });
        continue;
      }
      if (!stack.length || char !== stack[stack.length - 1].close) continue;
      const group = stack.pop();
      if (!stack.length) {
        const whole = text.slice(group.start, i + 1);
        const inner = text.slice(group.start + 1, i);
        if (!SONG_TITLE_VERSION_BRACKET.test(inner)) remove.push([group.start, i + 1]);
        SONG_TITLE_VERSION_BRACKET.lastIndex = 0;
      }
    }
    if (!remove.length) return text;
    let out = "";
    let start = 0;
    for (const range of remove) {
      out += text.slice(start, range[0]) + " ";
      start = range[1];
    }
    return out + text.slice(start);
  }

  // 去掉 DJ 版本标记后再比较曲名：Spotify 写 "Song (DJ版)"，曲库可能只写
  // "Song"；括号里是 "DJ Snake Remix" 这类制作人署名时不会误删。
  function stripDjVersion(title) {
    let text = String(title);
    text = text.replace(SONG_TITLE_BRACKET_GROUP, (whole, inner) => (DJ_VERSION_MARK.test(inner) ? " " : whole));
    return text.replace(SONG_TITLE_DASH_DJ, "").replace(SONG_TITLE_LEADING_DJ, "");
  }

  function songTitle(title) {
    let text = String(title).replace(SONG_TITLE_LIVE, "").replace(SONG_TITLE_LIVE_BRACKET, "");
    // 歌手名、版本说明不参与歌名比较：Spotify 常见 "Song (feat. X)"、
    // "Song - 2011 Remaster" 而曲库只写 "Song"。
    text = stripDjVersion(text);
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    return normalize(text);
  }

  // 查询第三方曲库时也先去掉 feat / remaster 等后缀；Live / Acoustic / Remix
  // 这类真正决定版本的信息保留，避免把现场版查成录音室版。
  // 括号里的影视 / 节目 / 歌手等装饰信息也一并去掉；只有包含版本词时才保留。
  // DJ 版本单独去掉，先按原曲名去搜，再靠 matchesSong 的放宽规则匹配。
  function queryTitle(title) {
    let text = stripDjVersion(String(title));
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    text = stripDecorativeParentheses(text);
    return text.replace(/\s+/g, " ").trim() || String(title);
  }

  // 曲名可能是 "Song (电影《…》主题曲)"，曲库只写 "Song"；两边都按完整曲名
  // 和去掉装饰括号后的曲名各比一次。版本词、Live、歌手等校验仍在 matchesSong
  // 里单独进行。
  function matchTitles(title, candidateTitle) {
    const wanted = [];
    for (const value of [songTitle(title), normalize(queryTitle(title))]) {
      if (value && wanted.indexOf(value) < 0) wanted.push(value);
    }
    for (const value of [songTitle(candidateTitle), normalize(queryTitle(candidateTitle))]) {
      if (value && wanted.indexOf(value) >= 0) return true;
    }
    return false;
  }

  function artistNames(person) {
    if (!person || "object" != typeof person) return [];
    return [person.name, person.trans].concat(Array.isArray(person.alias) ? person.alias : [],
      Array.isArray(person.transNames) ? person.transNames : []).filter((name) => typeof name === "string" && name.trim());
  }

  function matchesArtist(artist, candidates) {
    const names = [];
    const add = (value) => {
      if (typeof value !== "string") return;
      const text = value.trim();
      if (!text) return;
      names.push(text);
      for (const part of text.split(ARTIST_SPLIT)) {
        const name = part.trim();
        if (name) names.push(name);
      }
    };
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) add(candidate);
    } else {
      add(candidates);
    }
    // 兼容曲库的“姓, 名”写法。
    const key = (name) => normalize(String(name || "").replace(/^([^,，]+)[,，]\s*([^,，]+)$/, "$2 $1"));
    const wanted = new Set([key(artist)]);
    for (const part of String(artist || "").split(ARTIST_SPLIT)) {
      if (part.trim()) wanted.add(key(part));
    }
    wanted.delete("");
    return names.some((name) => wanted.has(key(name)));
  }

  // LRCLIB 用秒，网易云搜索用毫秒，QQ 用秒；时长可能来自任一方。
  // 大于 10000 的值按毫秒归一，避免同一首歌因为单位不同被判成两首。
  function durationSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 10000 ? number / 1000 : number;
  }

  function matchesSong(title, artist, duration, candidateTitle, candidateArtist, candidateDuration) {
    if (!candidateTitle || !matchTitles(title, candidateTitle)) return false;
    if (isLive(title) !== isLive(candidateTitle)) return false;
    if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
    // DJ 版本经常换制作人署名，歌手对不上不代表不是同一首；时长也可能因为
    // 加长 / 剪辑差出几十秒。命中 DJ 标记时放宽这两项，其余校验照旧。
    const dj = isDj(title) || isDj(candidateTitle);
    const singer = normalize(artist);
    if (singer && !dj && !matchesArtist(artist, candidateArtist)) return false;
    const stage = STAGE_MARK.exec(title);
    const otherStage = STAGE_MARK.exec(candidateTitle);
    if (stage && otherStage && stage[1] !== otherStage[1]) return false;
    // 时长是最便宜的「同名翻唱 / 伴奏 / 剪辑版」过滤器：两边都有时长时，
    // 相差超过 10 秒基本不是同一版。缺时长（Spotify 元数据没拿到）时不拦。
    const wantedDuration = durationSeconds(duration);
    const candidateSeconds = durationSeconds(candidateDuration);
    const timed = Number.isFinite(wantedDuration) && wantedDuration > 0 &&
      Number.isFinite(candidateSeconds) && candidateSeconds > 0;
    const delta = timed ? Math.abs(candidateSeconds - wantedDuration) : 0;
    // 仅凭 “Live” 无法确定具体场次，需再核对时长和场次信息。
    if (isLive(title)) {
      if (timed && delta > (dj ? 60 : 8)) return false;
      if (stage && !otherStage && (!timed || !singer)) return false;
    } else if (timed && delta > (dj ? 60 : 10)) {
      return false;
    }
    return true;
  }

  // 严格匹配失败后的第二轮：只放开「歌手」一项，曲名必须完全对得上
  // （不是前缀、不是包含），Live / 伴奏 / 场次仍按原规则拦。
  // 曲库侧常见「歌手写法不同 / 挂的制作人不同 / 合唱拆开」，严格轮会把整首歌
  // 判成没有歌词；这一轮用同名 + 时长兜底，同名加上时长对得上基本不会串歌。
  function matchesSongLoose(title, artist, duration, candidateTitle, candidateArtist, candidateDuration) {
    if (!candidateTitle) return false;
    const wanted = [songTitle(title), normalize(queryTitle(title))].filter(Boolean);
    const found = [songTitle(candidateTitle), normalize(queryTitle(candidateTitle))].filter(Boolean);
    if (!wanted.length || !found.some((name) => wanted.indexOf(name) >= 0)) return false;
    if (isLive(title) !== isLive(candidateTitle)) return false;
    if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
    const stage = STAGE_MARK.exec(title);
    const otherStage = STAGE_MARK.exec(candidateTitle);
    if (stage && otherStage && stage[1] !== otherStage[1]) return false;
    const wantedDuration = durationSeconds(duration);
    const candidateSeconds = durationSeconds(candidateDuration);
    const timed = Number.isFinite(wantedDuration) && wantedDuration > 0 &&
      Number.isFinite(candidateSeconds) && candidateSeconds > 0;
    const singer = normalize(artist);
    // 场次对不上又缺时长 / 歌手时无法确认是不是同一场，这里仍按严格轮拦。
    if (stage && !otherStage && (!timed || !singer)) return false;
    if (timed) {
      // 同名不同版的时长差通常远大于 10 秒；两边都有时长时用它挡掉翻唱 / 剪辑版。
      if (Math.abs(candidateSeconds - wantedDuration) > 12) return false;
      return true;
    }
    // 没有时长可对时只认「毫无歧义」的情况：名字完全一致，且歌手也对得上或
    // 曲库里根本没写歌手。宁可少补一首，也不要把别的歌的歌词贴上去。
    return !singer || !candidateArtist || matchesArtist(artist, candidateArtist);
  }

  // 候选歌词请求并行发出（最多 3 个），首个拿到可解析歌词的胜出；全部没歌词
  // 时返回 null。
  function tryCandidates(candidates, fetch, cb, limit = 3) {
    if (stopped()) return;
    const picked = Array.isArray(candidates) ? candidates.slice(0, limit) : [];
    if (!picked.length) { cb(null); return; }
    let pending = picked.length;
    let done = false;
    for (const candidate of picked) {
      fetch(candidate, (record) => {
        if (stopped() || done) return;
        if (buildPayload(record)) {
          done = true;
          cb(record);
          return;
        }
        pending -= 1;
        if (!pending) {
          done = true;
          cb(null);
        }
      });
    }
  }

  // ---- 工具函数 ---------------------------------------------------------

  function toText(value) {
    if (typeof value === "string") return value;
    if (value instanceof ArrayBuffer) return utf8.decode(new Uint8Array(value));
    if (value && ArrayBuffer.isView(value)) return utf8.decode(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
    return "";
  }

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function hasLyrics(text) {
    try {
      const data = JSON.parse(text);
      const lines = data && data.lyrics && data.lyrics.lines;
      return Array.isArray(lines) && lines.some((line) => line && String(line.words || "").trim());
    } catch (e) {
      return false;
    }
  }

  function httpGetJson(target, callback, extraHeaders, timeoutMs) {
    httpGetText(target, (data) => {
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch (e) {}
      callback(parsed);
    }, extraHeaders, timeoutMs);
  }

  function httpGetText(target, callback, extraHeaders, timeoutMs) {
    if (stopped()) return;
    let done = false;
    const reply = (value) => {
      if (done || stopped()) return;
      done = true;
      callback(value);
    };
    try {
      const headers = { "User-Agent": USER_AGENT, Accept: target.indexOf("/embed/track/") >= 0 ? "text/html" : "application/json" };
      if (extraHeaders) {
        for (const key in extraHeaders) {
          if (Object.prototype.hasOwnProperty.call(extraHeaders, key)) headers[key] = extraHeaders[key];
        }
      }
      const options = { url: target, headers: headers, timeout: timeoutMs || 4000 };
      // 元数据请求（open.spotify.com 的 oEmbed / embed）和 Musixmatch 换 token 的
      // 那一跳也走这里，它们成功不代表歌词源给过答复，所以统计只算真正的歌词查询。
      const counted = target.indexOf("open.spotify.com") < 0 && target.indexOf("/token.get") < 0;
      const onReply = (error, response, data) => {
        if (done || stopped()) return;
        const statusCode = Number(response && response.status);
        if (error || !response) {
          reply(null);
          return;
        }
        // 404 / 400 是第三方源的「确定没有」答复，算有效应答；5xx / 429 / 超时
        // 属于临时故障，不算，避免把网络故障写成 miss。
        if (statusCode === 404 || statusCode === 400) {
          if (counted) netAnswered += 1;
          reply(null);
          return;
        }
        if (statusCode >= 400 || !data) {
          reply(null);
          return;
        }
        // 第三方接口不可控：超长响应不解析，避免 JSON.parse 占满内存。
        if ("string" != typeof data || data.length > MAX_HTTP_JSON_BYTES) {
          reply(null);
          return;
        }
        if (counted) netAnswered += 1;
        reply(data);
      };

      // 优先用客户端的 $httpClient；没有注入时回退到 QX 的 $task.fetch 和
      // 运行时自带的 fetch。某个客户端只实现了其中一种时也不会静默失败。
      if (typeof $httpClient !== "undefined" && $httpClient && typeof $httpClient.get === "function") {
        $httpClient.get(options, onReply);
        return;
      }
      if (typeof $task !== "undefined" && $task && typeof $task.fetch === "function") {
        $task.fetch({ url: target, headers: headers, timeout: timeoutMs || 4000 }).then(
          (res) => onReply(null, { status: res.statusCode || res.status }, res.body),
          (err) => onReply(err, null, null),
        );
        return;
      }
      if (typeof fetch === "function") {
        fetch(target, { headers: headers }).then(
          (res) => res.text().then((text) => onReply(null, { status: res.status }, text)),
          (err) => onReply(err, null, null),
        );
        return;
      }
      onReply(new Error("no http client"), null, null);
    } catch (e) {
      reply(null);
    }
  }

  function emit(payload) {
    if (protoMode) {
      const bytes = encodeProto(payload.lyrics.lines, payload.lyrics.syncType, payload.lyrics.provider,
        payload.lyrics.providerLyricsId, payload.lyrics.language, payload.colors);
      // 与官方响应头保持一致。
      finish({ status: 200, headers: { "Content-Type": "application/vnd.google.protobuf" }, body: bytes });
      return;
    }

    // 桌面端是跨域 fetch：合成响应必须带上原响应的 CORS 头，否则浏览器判定
    // 实际响应不可读，App 显示「无法加载这首歌曲的歌词」。
    finish(jsonResponse(JSON.stringify(jsonPayload(payload))));
  }

  function jsonPayload(payload) {
    const out = Object.assign({}, payload, { lyrics: Object.assign({}, payload.lyrics) });
    const toClient = (line) => Object.assign({}, line, {
      syllables: (line.syllables || []).map((part) => ({
        startTimeMs: String(part.startTimeMs),
        endTimeMs: String(part.endTimeMs),
        numChars: String(Array.from(part.words || "").length),
      })),
    });
    out.lyrics.lines = payload.lyrics.lines.map(toClient);
    out.lyrics.previewLines = payload.lyrics.previewLines.map(toClient);
    return out;
  }

  // 请求阶段合成没有官方响应头可抄。只有请求带 Origin（浏览器 / CEF 桌面端）
  // 时才补 CORS 头；iOS 原生客户端不带 Origin，返回的响应头和以前完全一致。
  function syntheticHeaders(contentType, length) {
    const headers = { "Content-Type": contentType };
    if (length !== undefined) headers["Content-Length"] = String(length);
    const origin = headerValue(req && req.headers, "origin");
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Access-Control-Allow-Credentials"] = "true";
      headers["Vary"] = "Origin";
    }
    return headers;
  }

  // 用官方响应头做底、只换 body：CORS 头（Access-Control-Allow-Origin 等）
  // 原样保留，Content-Length 按新 body 重算，Content-Encoding 去掉（脚本拿到的
  // 已经是解压后的字节，再声明 gzip / br 浏览器会解析失败）。
  function jsonResponse(body) {
    const headers = {};
    const source = res && res.headers;
    if (source && "object" == typeof source) {
      for (const key in source) {
        const lower = String(key).toLowerCase();
        if (lower === "content-length" || lower === "content-encoding"
          || lower === "content-type" || lower === "transfer-encoding") continue;
        headers[key] = source[key];
      }
    }
    let hasOrigin = false;
    for (const key in headers) {
      if (String(key).toLowerCase() === "access-control-allow-origin") hasOrigin = true;
    }
    if (!hasOrigin) {
      // 预检通过后，实际响应仍要回一条 Allow-Origin；带 authorization 头的
      // 请求按凭据模式处理，还需要 Allow-Credentials。
      const origin = headerValue(req && req.headers, "origin");
      headers["Access-Control-Allow-Origin"] = origin || "*";
      if (origin) {
        headers["Access-Control-Allow-Credentials"] = "true";
        headers["Vary"] = "Origin";
      }
    }
    headers["Content-Type"] = "application/json; charset=utf-8";
    headers["Content-Length"] = String(encoder.encode(body).length);
    return { status: 200, headers: headers, body: body };
  }

  // ---- protobuf ---------------------------------------------------------
  //
  // 字段与官方 color-lyrics 响应一致（Content-Type: application/vnd.google.protobuf）：
  //   message Response   { LyricsData data = 1; LyricsColors colors = 2; }
  //   message LyricsData {
  //     bool timeSynchronized = 1;         // 1 = 逐行同步
  //     repeated LyricsLine lines = 2;     // 完整歌词
  //     string provider = 3;               // "MusixMatch"
  //     string providerLyricsId = 4;       // "9539392"
  //     string providerDisplayName = 5;    // "Musixmatch"
  //     bool isDenseTypeface = 8;          // 中日韩用更紧的字形
  //     string language = 10;              // "zh-Hant"
  //     LyricsRestriction restriction = 14;// 1 = showLyrics
  //     repeated LyricsLine previewLines = 17;  // 歌词卡用的前几行
  //   }
  //   message LyricsLine { int32 offsetMs = 1; string content = 2; }
  //   message LyricsColors { uint32 backgroundColor = 1; uint32 lineColor = 2; uint32 activeLineColor = 3; }
  //
  // previewLines 供 Now Playing 歌词卡使用，必须和完整歌词一起返回。

  function encodeLine(line) {
    const content = encoder.encode(String(line.words || ""));
    const parts = [pbUint(1, Number(line.startTimeMs) || 0), pbBytes(2, content)];
    const syllables = Array.isArray(line.syllables) ? line.syllables : [];
    for (const syllable of syllables) {
      const word = String(syllable.words || "");
      if (!word) continue;
      parts.push(pbBytes(3, pbConcat([
        pbUint(1, Number(syllable.startTimeMs) || 0),
        pbUint(2, Number(syllable.endTimeMs) || 0),
        pbUint(3, Array.from(word).length),
      ])));
    }
    return pbConcat(parts);
  }

  function encodeProto(lines, syncType, provider, providerId, language, colors) {
    const parts = [pbUint(1, syncType === "UNSYNCED" ? 0 : 1)];
    for (let i = 0; i < lines.length; i += 1) parts.push(pbBytes(2, encodeLine(lines[i])));
    parts.push(pbBytes(3, encoder.encode(provider || "LRCLIB")));
    parts.push(pbBytes(4, encoder.encode(String(providerId === undefined || providerId === null ? "" : providerId))));
    parts.push(pbBytes(5, encoder.encode(provider || "LRCLIB")));

    const lang = String(language || "");
    const dense = /^(?:zh|ja|ko)(?:-|$)/i.test(lang);
    if (dense) parts.push(pbUint(8, 1));
    if (lang) parts.push(pbBytes(10, encoder.encode(lang)));
    parts.push(pbUint(14, 1));
    for (let i = 0; i < lines.length && i < PREVIEW_LINES; i += 1) parts.push(pbBytes(17, encodeLine(lines[i])));

    const lyrics = pbConcat(parts);
    // colors 必须给：客户端拿它刷歌词页的背景和文字，字段缺失时是 0，alpha 也是 0，
    // 整页歌词就成了透明的。JSON 用有符号整数，protobuf 这里必须还原成 uint32。
    const argb = (value) => Number(value) >>> 0;
    const palette = colors || {};
    const colorsBytes = pbConcat([
      pbUint(1, argb(palette.background === undefined ? 0xff808080 : palette.background)),
      pbUint(2, argb(palette.text === undefined ? 0xff000000 : palette.text)),
      pbUint(3, argb(palette.highlightText === undefined ? 0xffffffff : palette.highlightText)),
    ]);
    return pbConcat([pbBytes(1, lyrics), pbBytes(2, colorsBytes)]);
  }

  function inspectProto(bytes) {
    try {
      const top = pbFields(bytes);
      for (let i = 0; i < top.length; i += 1) {
        const field = top[i];
        if (field.field !== 1 || field.wire !== 2) continue;
        const inner = pbFields(field.bytes);
        let count = 0;
        for (let j = 0; j < inner.length; j += 1) {
          if (inner[j].field === 2 && inner[j].wire === 2 && inner[j].bytes && inner[j].bytes.length) count += 1;
        }
        return { count, top, lyrics: field, inner };
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // 官方歌词的语言标记决定要不要转简体：zh-Hant / zh-TW / zh-HK 直接转；
  // zh-Hans / zh-CN 默认不动，但正文出现繁体特征字时仍会补一次转换；
  // "zh" 或缺失时完全按正文判断。
  function hanLanguage(value) {
    const lang = String(value || "").trim().toLowerCase();
    if (!lang) return "unknown";
    if (!/^zh(?:$|[-_])/.test(lang)) return "other";
    if (/hant|[-_](?:tw|hk|mo)(?:$|[-_])/.test(lang)) return "hant";
    if (/hans|[-_](?:cn|sg)(?:$|[-_])/.test(lang)) return "hans";
    return "zh";
  }

  // 语言标记明确是繁体时直接转；zh / 缺失 / 误标成 zh-Hans 时再看正文，
  // 只有确实出现繁体特征字才转，简体文本不会被逐字改写。
  function shouldFoldHan(kind, sample) {
    if (kind === "hant") return true;
    if (kind === "other") return false;
    return CJK_MARK.test(sample) && SPOTIFY_HAN_VARIANTS.isTraditional(sample);
  }

  function protoLineText(field) {
    try {
      const line = pbFields(field.bytes);
      let out = "";
      for (let i = 0; i < line.length; i += 1) {
        const part = line[i];
        if (part.wire !== 2) continue;
        const text = toText(part.bytes);
        if (CJK_MARK.test(text)) out += text;
      }
      return out;
    } catch (e) {
      // 单行解析失败时按没有正文处理，整条响应仍然可以放行。
    }
    return "";
  }

  // 采样时优先收集含汉字的行：前奏 / 英文段很长时，前 40 行可能全是英文，
  // 只看开头会把后面真正的中文歌词漏掉。
  function protoSample(inner) {
    const sample = [];
    const fallback = [];
    let hasHan = false;
    for (let i = 0; i < inner.length; i += 1) {
      const field = inner[i];
      if (!((field.field === 2 || field.field === 17) && field.wire === 2)) continue;
      const text = protoLineText(field);
      if (!text) continue;
      if (CJK_MARK.test(text)) {
        hasHan = true;
        if (sample.length < 40) sample.push(text);
        if (sample.length >= 40) break;
      } else if (fallback.length < 40) {
        fallback.push(text);
      }
    }
    return { text: (sample.length ? sample : fallback).join(""), hasHan: hasHan };
  }

  // 只改歌词行里的文本字段，offsetMs（wire 0）和未知字段按原字节保留。
  // 官方行通常只有 content(2)，逐字歌词还会带 syllables 之类的子消息；
  // 这里对所有 wire 2 文本字段做折叠，字段号变了也能覆盖。
  // 官方歌词里有只带时间戳、没有正文的空行，这种行原样写回。
  function foldProtoLine(field) {
    let line;
    try {
      line = pbFields(field.bytes);
    } catch (e) {
      return null;
    }
    let changed = false;
    const out = [];
    for (let i = 0; i < line.length; i += 1) {
      const part = line[i];
      if (part.wire === 2) {
        const text = toText(part.bytes);
        if (CJK_MARK.test(text)) {
          const folded = SPOTIFY_HAN_VARIANTS.fold(text);
          if (folded !== text) {
            // toText 是非 fatal 解码；非法 UTF-8 重编码后会变样，这种行不碰。
            const original = encoder.encode(text);
            let valid = original.length === part.bytes.length;
            for (let j = 0; valid && j < original.length; j += 1) {
              if (original[j] !== part.bytes[j]) valid = false;
            }
            if (valid) {
              out.push(pbBytes(part.field, encoder.encode(folded)));
              changed = true;
              continue;
            }
          }
        }
      }
      out.push(pbEncodeField(part));
    }
    return changed ? pbConcat(out) : null;
  }

  // 官方 protobuf 的改写：歌词转简体 + restriction 归一。
  // 顶层 Response 与 LyricsData 的其它字段都按原字节写回，避免客户端解析异常。
  function rewriteOfficialProto(inspected) {
    if (!inspected) return null;
    const inner = inspected.inner;
    let language = "";
    for (let i = 0; i < inner.length; i += 1) {
      if (inner[i].field === 10 && inner[i].wire === 2) {
        language = toText(inner[i].bytes);
        break;
      }
    }
    const kind = hanLanguage(language);
    const sample = protoSample(inner);
    const fold = hansLyrics && typeof SPOTIFY_HAN_VARIANTS !== "undefined" && shouldFoldHan(kind, sample.text);
    const nextLanguage = fold && sample.hasHan && (kind === "hant" || kind === "zh") ? "zh-Hans" : "";

    let changed = false;
    const outInner = [];
    for (let i = 0; i < inner.length; i += 1) {
      const field = inner[i];
      if (fold && (field.field === 2 || field.field === 17) && field.wire === 2) {
        const folded = foldProtoLine(field);
        if (folded) {
          outInner.push(pbBytes(field.field, folded));
          changed = true;
          continue;
        }
      }
      if (nextLanguage && field.field === 10 && field.wire === 2) {
        outInner.push(pbBytes(10, encoder.encode(nextLanguage)));
        changed = true;
        continue;
      }
      // 免费号额度用完时服务端回 3，客户端只显示额度提示；改回 1 后正常放行。
      if (field.field === 14 && field.wire === 0) {
        if (field.value !== 1) changed = true;
        outInner.push(pbUint(14, 1));
        continue;
      }
      outInner.push(pbEncodeField(field));
    }
    if (!changed) return null;

    const outTop = [];
    for (let i = 0; i < inspected.top.length; i += 1) {
      const field = inspected.top[i];
      outTop.push(field === inspected.lyrics ? pbBytes(1, pbConcat(outInner)) : pbEncodeField(field));
    }
    return pbConcat(outTop);
  }

  function jsonSample(lines) {
    const sample = [];
    const fallback = [];
    let hasHan = false;
    if (!Array.isArray(lines)) return { text: "", hasHan: false };
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line || typeof line.words !== "string" || !line.words) continue;
      if (CJK_MARK.test(line.words)) {
        hasHan = true;
        if (sample.length < 40) sample.push(line.words);
        if (sample.length >= 40) break;
      } else if (fallback.length < 40) {
        fallback.push(line.words);
      }
    }
    return { text: (sample.length ? sample : fallback).join(""), hasHan: hasHan };
  }

  // 桌面端 JSON：lines 与 previewLines 都要转，逐字同步的 syllables 也跟着转，
  // 否则整行是简体、逐字高亮又跳回繁体。
  function foldJsonLine(line) {
    if (!line || "object" != typeof line) return false;
    let changed = false;
    if (typeof line.words === "string") {
      const folded = SPOTIFY_HAN_VARIANTS.fold(line.words);
      if (folded !== line.words) {
        line.words = folded;
        changed = true;
      }
    }
    if (Array.isArray(line.syllables)) {
      for (let i = 0; i < line.syllables.length; i += 1) {
        const syllable = line.syllables[i];
        if (!syllable || typeof syllable.words !== "string") continue;
        const folded = SPOTIFY_HAN_VARIANTS.fold(syllable.words);
        if (folded !== syllable.words) {
          syllable.words = folded;
          changed = true;
        }
      }
    }
    return changed;
  }

  function foldJsonLines(lines) {
    if (!Array.isArray(lines)) return false;
    let changed = false;
    for (let i = 0; i < lines.length; i += 1) {
      if (foldJsonLine(lines[i])) changed = true;
    }
    return changed;
  }

  // 官方 JSON 的改写：删掉额度限制，并按语言标记把正文转成简体。
  // 返回 null 表示不需要改，调用方原样放行。
  function rewriteOfficialJson(text) {
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    const lyrics = data && data.lyrics;
    if (!lyrics || "object" != typeof lyrics) return null;

    let changed = false;
    if (Object.prototype.hasOwnProperty.call(lyrics, "restriction")) {
      delete lyrics.restriction;
      changed = true;
    }
    if (hansLyrics && typeof SPOTIFY_HAN_VARIANTS !== "undefined") {
      const kind = hanLanguage(lyrics.language);
      const sample = jsonSample(lyrics.lines);
      const fold = shouldFoldHan(kind, sample.text);
      if (fold) {
        if (foldJsonLines(lyrics.lines)) changed = true;
        if (foldJsonLines(lyrics.previewLines)) changed = true;
        // alternatives 是另一份译文；只有它自己的语言也是繁体时才一起转。
        const alternatives = Array.isArray(lyrics.alternatives) ? lyrics.alternatives : [];
        for (let i = 0; i < alternatives.length; i += 1) {
          const alt = alternatives[i];
          if (!alt || "object" != typeof alt) continue;
          const altKind = hanLanguage(alt.language);
          const altSample = jsonSample(alt.lines);
          if (!shouldFoldHan(altKind, altSample.text)) continue;
          if (foldJsonLines(alt.lines)) changed = true;
          if (altSample.hasHan && (altKind === "hant" || altKind === "zh")) {
            alt.language = "zh-Hans";
            changed = true;
          }
        }
        if (sample.hasHan && (kind === "hant" || kind === "zh")) {
          lyrics.language = "zh-Hans";
          changed = true;
        }
      }
    }
    return changed ? JSON.stringify(data) : null;
  }

  function pbEncodeField(f) {
    return f.raw;
  }

  // 直接拼 Uint8Array，避免逐字节 push 到普通数组：长歌词时既慢，
  // 也可能撞上 Function.prototype.apply 的参数上限。
  function pbConcat(list) {
    let size = 0;
    for (let i = 0; i < list.length; i += 1) size += list[i].length;
    const out = new Uint8Array(size);
    let at = 0;
    for (let i = 0; i < list.length; i += 1) {
      out.set(list[i], at);
      at += list[i].length;
    }
    return out;
  }

  function pbFields(bytes) {
    const out = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = pos;
      const key = pbReadVarint(bytes, pos);
      if (key.next < 0 || !Number.isSafeInteger(key.value) || key.value < 8) throw new Error("protobuf key");
      const field = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (wire === 0) {
        const value = pbReadVarint(bytes, key.next);
        if (value.next < 0) throw new Error("protobuf varint");
        out.push({ field: field, wire: 0, value: value.value });
        pos = value.next;
      } else if (wire === 2) {
        const len = pbReadVarint(bytes, key.next);
        if (len.next < 0 || !Number.isSafeInteger(len.value) || len.value > bytes.length - len.next) throw new Error("protobuf length");
        out.push({ field: field, wire: 2, bytes: bytes.subarray(len.next, len.next + len.value) });
        pos = len.next + len.value;
      } else if (wire === 5) {
        pos = key.next + 4;
        out.push({ field, wire });
      } else if (wire === 1) {
        pos = key.next + 8;
        out.push({ field, wire });
      } else {
        throw new Error("protobuf wire");
      }
      if (pos > bytes.length) throw new Error("protobuf truncated");
      out[out.length - 1].raw = bytes.subarray(start, pos);
    }
    return out;
  }

  function pbReadVarint(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      // 绝大多数是 1-4 字节的小整数，走位运算快路径；超出后再退回乘法。
      if (shift < 28) value |= (byte & 0x7f) << shift;
      else value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if (shift === 63 && byte > 1) break;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 63) break;
    }
    return { value: 0, next: -1 };
  }

  function pbWriteVarint(value) {
    const out = [];
    let rest = Math.max(0, Math.floor(value));
    // 字段号 / 长度 / 毫秒时间戳都小于 2^31，位运算比 % 和 Math.floor 快。
    if (rest <= 0x7fffffff) {
      while (rest >= 128) {
        out.push((rest & 0x7f) | 0x80);
        rest >>>= 7;
      }
      out.push(rest);
      return out;
    }
    while (rest >= 128) {
      out.push((rest % 128) | 128);
      rest = Math.floor(rest / 128);
    }
    out.push(rest);
    return out;
  }

  function pbUint(field, value) {
    return pbConcat([pbWriteVarint(field * 8), pbWriteVarint(value)]);
  }

  function pbBytes(field, bytes) {
    return pbConcat([pbWriteVarint(field * 8 + 2), pbWriteVarint(bytes.length), bytes]);
  }

  // 只有纯文本时，按歌曲时长把行均分出时间轴：能跟着滚动的歌词总比整屏文字有用。
  // 从第二行开始排（第一行通常留 1.2 秒前奏），最后一行落在结束前 4 秒。
  // 时长缺失或太短时不编时间轴，保持 UNSYNCED。
  function distributeLines(words, spanMs) {
    const first = 1200;
    const last = Math.max(first, spanMs - 4000);
    const step = words.length > 1 ? (last - first) / (words.length - 1) : 0;
    return words.map((text, index) => ({
      startTimeMs: String(Math.round(first + step * index)),
      words: text,
      syllables: [],
      endTimeMs: "0",
    }));
  }

  function plainWords(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  function buildPayload(record) {
    if (!record || "object" != typeof record || record.instrumental) return null;

    if (wordLyrics && Array.isArray(record.wordLyrics) && record.wordLyrics.length) {
      const payload = makePayload("SYLLABLE_SYNCED", record.wordLyrics, record);
      if (payload && payload.lyrics.lines.some((line) => line.syllables.length)) return payload;
    }

    if (typeof record.syncedLyrics === "string") {
      const lines = parseLrc(record.syncedLyrics);
      if (lines.length) return makePayload("LINE_SYNCED", lines, record);
    }

    if (typeof record.plainLyrics === "string") {
      const words = plainWords(record.plainLyrics);
      const span = Number(record.trackDurationMs) || 0;
      if (pseudoSync && words.length && span >= 20000) {
        const payload = makePayload("LINE_SYNCED", distributeLines(words, span), record);
        // 标记成伪同步：runSource 不让它提前收工，等真正的同步歌词先。
        if (payload) {
          record.pseudo = true;
          return payload;
        }
      }
      const lines = words.map((text) => ({ startTimeMs: "0", words: text, syllables: [], endTimeMs: "0" }));
      if (lines.length) return makePayload("UNSYNCED", lines, record);
    }

    return null;
  }

  // ISRC 反查拿回来的 record（只有时间轴歌词）转成 payload，走同一套规范化。
  function payloadFrom(record, duration) {
    if (record && duration && !record.trackDurationMs) record.trackDurationMs = Number(duration) * 1000;
    return buildPayload(record);
  }

  // 客户端按 startTimeMs 递增定位当前行，并据此滚动列表。外部来源的行统一在这里
  // 规范化：类型转字符串、丢掉无效和空行、按时间升序，避免乱序或空文本影响定位。
  function normalizeLines(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const line of raw) {
      if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
      const ms = Number(line.startTimeMs);
      if (!Number.isSafeInteger(ms) || ms < 0) continue;
      const syllables = Array.isArray(line.syllables) ? line.syllables.filter((part) => part
        && typeof part.words === "string" && part.words.length
        && Number.isSafeInteger(Number(part.startTimeMs)) && Number(part.startTimeMs) >= 0
        && Number.isSafeInteger(Number(part.endTimeMs)) && Number(part.endTimeMs) >= Number(part.startTimeMs))
        .map((part) => ({ startTimeMs: String(Number(part.startTimeMs)), endTimeMs: String(Number(part.endTimeMs)), words: part.words })) : [];
      out.push({ startTimeMs: String(ms), words: line.words, syllables: syllables, endTimeMs: String(Number(line.endTimeMs) || 0) });
    }
    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  // 客户端按严格结构读取这个对象，字段形状需要与官方 color-lyrics/v2 一致：
  //
  //   { lyrics: { syncType, lines[], provider, providerLyricsId, providerDisplayName,
  //               syncLyricsUri, isDenseTypeface, alternatives, language,
  //               isRtlLanguage, fullscreenAction },
  //     colors: { background, text, highlightText },
  //     hasVocalRemoval }
  //
  // iOS 与桌面共用同一套 JSON 形状。
  function makePayload(syncType, rawLines, record) {
    const lines = normalizeLines(rawLines);
    if (!lines.length) return null;
    // 补全歌词默认转简体：先对整段做一次判定，只有繁体才逐行折叠。
    // 网易云 / QQ 的简体歌词、英文与日文歌词都不会走到逐字转换。
    if (hansLyrics && typeof SPOTIFY_HAN_VARIANTS !== "undefined") {
      const sample = [];
      for (let i = 0; i < lines.length && i < 40; i += 1) sample.push(lines[i].words);
      if (SPOTIFY_HAN_VARIANTS.isTraditional(sample)) {
        for (let i = 0; i < lines.length; i += 1) {
          lines[i].words = SPOTIFY_HAN_VARIANTS.fold(lines[i].words);
          for (const syllable of lines[i].syllables) syllable.words = SPOTIFY_HAN_VARIANTS.fold(syllable.words);
        }
      }
    }
    const provider = record.provider || "LRCLIB";
    const id = record.providerId !== undefined ? record.providerId : record.id;
    const language = detectLanguage(lines);
    const syllableSync = syncType === "SYLLABLE_SYNCED" && lines.some((line) => line.syllables.length);
    // 值是 32 位有符号整数。
    const signed = (v) => (v > 0x7fffffff ? v - 0x100000000 : v);
    const palette = albumColors(record);
    return {
      lyrics: {
        syncType: syncType === "SYLLABLE_SYNCED" && !syllableSync ? "LINE_SYNCED" : syncType,
        lines: lines,
        provider: provider,
        providerLyricsId: id === undefined || id === null ? "" : String(id),
        providerDisplayName: provider,
        syncLyricsUri: "",
        isDenseTypeface: false,
        alternatives: [],
        language: language,
        isRtlLanguage: false,
        fullscreenAction: "FULLSCREEN_LYRICS",
        // 桌面端（CEF / xpui）直接读 previewLines 做歌词卡预览，缺这个字段会抛
        // TypeError（undefined.map），整页歌词退化成「无法加载」。官方 JSON
        // 一直带它，这里按同样的前 N 行补齐；iOS 走 protobuf，不受影响。
        previewLines: lines.slice(0, PREVIEW_LINES),
      },
      colors: {
        background: signed(palette.background),
        text: signed(palette.line),
        highlightText: signed(palette.active),
      },
      hasVocalRemoval: false,
    };
  }

  // ---- 歌词页配色 -------------------------------------------------------
  //
  // 官方歌词页把封面主色当背景，未激活的行用黑字，当前 / 已唱行用白字
  // （参考 EeveeSpotify 的 LyricsColors：backgroundColor=封面提取色，
  // lineColor=黑，activeLineColor=白）。默认值 0 会让整页透明，所以必须显式给。
  // 封面色统一压到中等亮度，黑字才不会在深色封面上消失；拿不到封面色时用
  // 灰色底，与参考实现的 Color.gray 兜底一致。
  function albumColors(record) {
    const line = 0xff000000;
    const active = 0xffffffff;
    const fallback = 0xff808080;
    const source = record && record.albumColor;
    const channel = (value) => Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
    if (!source || !Number.isFinite(Number(source.r)) || !Number.isFinite(Number(source.g)) || !Number.isFinite(Number(source.b))) {
      return { background: fallback, line: line, active: active };
    }
    const r = channel(source.r);
    const g = channel(source.g);
    const b = channel(source.b);
    const brightness = (r * 299 + g * 587 + b * 114) / 255000;
    const amount = Math.abs(0.5 - brightness);
    const mix = (value) => (brightness < 0.5
      ? Math.round(value * (1 - amount) + 255 * amount)
      : Math.round(value * (1 - amount)));
    const background = (0xff000000 | (mix(r) << 16) | (mix(g) << 8) | mix(b)) >>> 0;
    return { background: background, line: line, active: active };
  }

  // 公开 embed 页面（__NEXT_DATA__）同时带曲目元数据与封面主色。
  function parseEmbedTrack(html) {
    try {
      const match = /<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
      const data = match && JSON.parse(match[1]);
      const entity = data && data.props && data.props.pageProps && data.props.pageProps.state && data.props.pageProps.state.data && data.props.pageProps.state.data.entity;
      if (!entity || entity.type !== "track" || entity.id !== trackId || !(entity.title || entity.name)) return null;
      const artists = Array.isArray(entity.artists)
        ? entity.artists.filter(Boolean).map((item) => item && item.name).filter((name) => typeof name === "string" && name.trim())
        : [];
      const base = entity.visualIdentity && entity.visualIdentity.backgroundBase;
      const color = base && Number.isFinite(Number(base.red)) && Number.isFinite(Number(base.green)) && Number.isFinite(Number(base.blue))
        ? { r: Number(base.red), g: Number(base.green), b: Number(base.blue) }
        : null;
      return {
        title: String(entity.title || entity.name),
        artist: artists.join(", "),
        duration: Number(entity.duration) / 1000,
        color: color,
      };
    } catch (e) {
      return null;
    }
  }

  // LRC -> Spotify 的 lines。支持一行多个时间戳、[offset:±ms]、两位或三位毫秒。
  function parseLrc(text) {
    const out = [];
    let offset = 0;

    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;

      const off = LRC_OFFSET.exec(line);
      if (off) {
        offset = parseInt(off[1], 10) || 0;
        continue;
      }

      const stamps = [];
      let m;
      LRC_STAMP.lastIndex = 0;
      while ((m = LRC_STAMP.exec(line))) stamps.push(m);
      if (!stamps.length) continue;

      const words = line.replace(LRC_BRACKET, "").trim();
      if (!words) continue;

      for (const s of stamps) {
        const minutes = parseInt(s[1], 10);
        const seconds = parseInt(s[2], 10);
        const fracRaw = s[3] || "0";
        const frac = parseInt(fracRaw, 10) / Math.pow(10, fracRaw.length);
        let ms = Math.round((minutes * 60 + seconds + frac) * 1000) - offset;
        if (ms < 0) ms = 0;
        out.push({ startTimeMs: String(ms), words: words, syllables: [], endTimeMs: "0" });
      }
    }

    out.sort((a, b) => Number(a.startTimeMs) - Number(b.startTimeMs));
    return out;
  }

  function parseYrc(text) {
    const out = [];
    const stamp = /^\[(\d+),(\d+)\](.*)$/;
    const token = /\((\d+),(\d+),\d+\)([\s\S]*?)(?=\(\d+,\d+,\d+\)|$)/g;
    for (const raw of String(text || "").split(/\r?\n/)) {
      const match = stamp.exec(raw.trim());
      if (!match) continue;
      const lineStart = Number(match[1]);
      const lineDuration = Number(match[2]);
      if (!Number.isSafeInteger(lineStart) || !Number.isSafeInteger(lineDuration)) continue;
      const body = match[3];
      const syllables = [];
      let part;
      token.lastIndex = 0;
      while ((part = token.exec(body))) {
        const words = part[3];
        if (!words) continue;
        const startTimeMs = Number(part[1]);
        const durationMs = Number(part[2]);
        if (!Number.isSafeInteger(startTimeMs) || !Number.isSafeInteger(durationMs) || durationMs < 0) continue;
        syllables.push({ startTimeMs: String(startTimeMs), endTimeMs: String(startTimeMs + durationMs), words: words });
      }
      if (!syllables.length) continue;
      out.push({ startTimeMs: String(lineStart), endTimeMs: String(lineStart + lineDuration),
        words: syllables.map((item) => item.words).join(""), syllables: syllables });
    }
    return out;
  }

  // 同名曲目往往有好几版（原版、Video Edit、Extended Mix）。打分选版本：
  // 时长贴近的优先（时间轴才对得上），其次要有同步时间轴，其次曲名精确匹配。
  function pickRecord(list, title, duration, artist, matcher) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(queryTitle(title));
    const matches = matcher || matchesSong;
    const usable = list.filter((item) => {
      if (!item || "object" != typeof item || item.instrumental) return false;
      if (!matches(title, artist, duration, item.trackName, item.artistName, Number(item.duration))) return false;
      return Boolean(
        (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) ||
          (typeof item.plainLyrics === "string" && item.plainLyrics.trim()),
      );
    });
    if (!usable.length) return null;

    const synced = (item) => Boolean(item.syncedLyrics && item.syncedLyrics.trim());
    const named = (item) => normalize(queryTitle(item.trackName)) === wanted;
    const near = (item) =>
      Number.isFinite(duration) &&
      duration > 0 &&
      Number.isFinite(Number(item.duration)) &&
      Math.abs(Number(item.duration) - duration) <= 3;
    const singer = normalize(artist);
    const score = (item) => (synced(item) ? 2 : 0) + (named(item) ? 1 : 0) + (near(item) ? 4 : 0)
      + (singer && matchesArtist(artist, item.artistName) ? 8 : 0);

    let best = usable[0];
    let bestScore = score(best);
    for (let i = 1; i < usable.length; i += 1) {
      const current = score(usable[i]);
      if (current > bestScore) {
        best = usable[i];
        bestScore = current;
      }
    }
    return best;
  }

  function normalize(text) {
    // NFKC 处理全角 / 组合字符。查歌词时把繁体折叠成简体再比较：
    // Spotify 与曲库的繁简写法不同也能对上（可由 ignore_han_variants 关闭）。
    const value = String(text || "");
    const folded = foldHanVariants && typeof SPOTIFY_HAN_VARIANTS !== "undefined"
      ? SPOTIFY_HAN_VARIANTS.fold(value)
      : value;
    return folded
      .normalize("NFKC")
      .toLowerCase()
      .replace(NORMALIZE_DROP, "");
  }

  function detectLanguage(lines) {
    const sample = lines
      .slice(0, 20)
      .map((line) => line.words)
      .join("");
    if (KANA_MARK.test(sample)) return "ja";
    if (HANGUL_MARK.test(sample)) return "ko";
    if (HAN_MARK.test(sample)) return "zh";
    return "en";
  }
})();

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
    // 认出来的卡片数量：section 里带 section id（23）/ 曲目引用（5）/ 广告内容（30）
    // 才算一列卡片。形状对不上说明这不是滚动页的卡片列表（或者客户端换了结构），
    // 这时插一个 section 进去会把整包结构写坏 —— 客户端解析失败后整页空白，
    // 比「没有歌词卡」严重得多，所以只删广告、不插卡。
    let recognized = 0;
    const trackRef = trackId ? new TextEncoder().encode("spotify:track:" + trackId) : null;
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
      // 官方歌词 section 的真实字节：和 lyricsSection() 的合成结果对比用。
      if (hasTrack && hasSectionId) hasLyrics = true;
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

    // 只往「确实是一列卡片」的响应里插卡：列表形状对不上时插进去会把整包
    // 结构写坏，客户端解析失败后整页空白，比不补卡严重得多。
    // 判定条件放宽到「认出了任意一列卡片」或者「body 里确实有当前曲目的引用」，
    // 后者能兜住客户端换 section 结构、但列表确实属于这首歌的情况。
    const addCard = wantCard && !!trackId && !hasLyrics
      && (recognized > 0 || (trackRef && containsBytes(buffer, trackRef)));
    if (!removed && !addCard) return null;
    if (addCard) kept.unshift(wireEncodeField(1, 2, lyricsSection(trackId)));

    const rebuilt = wireEncodeField(1, 2, wireConcat(kept));
    const parts = [];
    for (const f of top) parts.push(f === structure ? rebuilt : f.raw);
    const out = wireConcat(parts);
    return wireEqual(out, buffer) ? null : out;
  }

  // 入口：首页 / 搜索 / 滚动页的赞助内容过滤，滚动页额外补歌词卡对应的 section。
  const req = (typeof $request !== "undefined" && $request) || null;
  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  const url = res.url || (req && req.url) || "";
  const status = Number(res.status || res.statusCode);

  if (status >= 300) {
    $done({});
    return;
  }

  // 查询串很常见（?locale=zh / ?market=US）；只用 (?:\/|$) 会把这些请求整个放行。
  const HOME_URL = /\/casita\/v\d+\/home(?:\/|\?|$)/;
  const BROWSE_URL = /\/browsita\/v\d+\/browse(?:\/|\?|$)/;
  const SCROLL_URL = /\/scrollsita\/v\d+\/scroll\//;

  const isHome = HOME_URL.test(url);
  const isBrowse = BROWSE_URL.test(url);
  const isScroll = SCROLL_URL.test(url);
  const wantAds = adsOn;
  const wantCard = isScroll && lyricsOn;
  if (!(isHome || isBrowse || isScroll) || !(wantAds || wantCard)) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  if (body.length > MAX_FEED_BYTES) {
    $done({});
    return;
  }

  const trackId = isScroll ? scrollTrackId(url) : "";

  function headerValue(headers, name) {
    if (!headers || "object" != typeof headers) return "";
    for (const key in headers) {
      if (String(key).toLowerCase() !== name) continue;
      const value = headers[key];
      if (Array.isArray(value)) return String(value[0] || "");
      return String(value === undefined || value === null ? "" : value);
    }
    return "";
  }

  // 换 body 时必须自己处理响应头，否则客户端拿到「新 body + 旧头」，整页直接空白：
  //   * Content-Length 要按新 body 重算。沿用旧长度客户端会按旧长度截断，
  //     protobuf 解析失败 —— Now Playing 走 connect-state 照旧显示，症状就是
  //     「只有卡片列表（scrollsita）没渲染」；
  //   * Content-Encoding 必须去掉。脚本拿到的是解压后的字节，再声明 gzip / br
  //     客户端解压失败，同样是空白列表；
  //   * CORS 头保留并在缺失时补上（桌面端 xpui 对这些接口是跨域 fetch）。
  function headersFor(length) {
    const source = res && res.headers;
    if (!source || "object" != typeof source) return null;
    const headers = {};
    let kept = 0;
    for (const key in source) {
      const lower = String(key).toLowerCase();
      if (lower === "content-length" || lower === "content-encoding" || lower === "transfer-encoding") continue;
      headers[key] = source[key];
      kept += 1;
    }
    // 拿不到原始响应头时返回 null，由 finish 退回「只换 body」的老路子。
    if (!kept) return null;
    headers["Content-Length"] = String(length);
    let hasOrigin = false;
    for (const key in headers) {
      if (String(key).toLowerCase() === "access-control-allow-origin") hasOrigin = true;
    }
    if (!hasOrigin) {
      const origin = headerValue(req && req.headers, "origin");
      if (origin) {
        headers["Access-Control-Allow-Origin"] = origin;
        headers["Access-Control-Allow-Credentials"] = "true";
        headers["Vary"] = "Origin";
      }
    }
    return headers;
  }

  const finish = (out) => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    const headers = headersFor(out.length);
    if (!headers) {
      $done({ body: out });
      return;
    }
    $done({ status: status || 200, headers: headers, body: out });
  };

  // 任何异常都要落回原样放行：脚本不调用 $done，这条请求会挂到客户端超时，
  // 客户端拿不到 body，卡片列表整块空白。
  const safePatch = (fn) => {
    try {
      return fn();
    } catch (e) {
      return null;
    }
  };

  // 队列里的下一首：spotify.js 处理 connect-state 时写入 spotify.queue
  // （PlayerState: track = 7、next_tracks = 20）。只有队列里的当前曲目与本次
  // 滚动页一致时才认，避免用上一首歌的队列去预取。
  const nextQueueTrack = (current) => {
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store || !current) return "";
    try {
      const raw = store.read("spotify.queue");
      const queue = raw ? JSON.parse(raw) : null;
      if (!queue || !Array.isArray(queue.next)) return "";
      const at = Number(queue.at) || 0;
      if (at && Date.now() - at > 30 * 60 * 1000) return "";
      if (queue.current && queue.current !== current) return "";
      const next = String(queue.next[0] || "");
      return next && next !== current ? next : "";
    } catch (e) {
      return "";
    }
  };

  // 预取下一首：队列（spotify.queue）由 spotify.js 处理 connect-state 时写入，
  // 这里只读它、拿下一首的 id。查询是 fire-and-forget，绝不等待 —— 客户端要的是
  // 尽快拿到列表，多等一秒列表就可能不被采用。
  if (isScroll && trackId) {
    const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyPrefetch : null;
    if (typeof prefetch === "function") {
      safePatch(() => {
        const next = nextQueueTrack(trackId);
        return next ? prefetch(next) : false;
      });
    }
  }

  // 补卡不等歌词：Now Playing 打开时客户端先渲染列表，之后才合并 scrollsita 的
  // 响应；晚到的响应只更新模型、不重绘列表，卡片要收起再展开才出现。
  // 所以立刻补卡，内容由随后的 color-lyrics 响应填充。
  if (isScroll && wantCard) {
    const card = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsCard : null;
    const hasCard = typeof hasLyricsCard === "function" && safePatch(() => hasLyricsCard(body));
    const allowed = !!trackId && !hasCard && (typeof card === "function" ? card(trackId) : true);
    if (!allowed) {
      finish(safePatch(() => patchScroll(body, trackId, wantAds, false)));
      return;
    }
    finish(safePatch(() => patchScroll(body, trackId, wantAds, true)));
    return;
  }

  let out = null;
  if (isHome) {
    out = wantAds ? safePatch(() => stripHomeAds(body)) : null;
  } else if (isBrowse) {
    out = wantAds ? safePatch(() => hideBrowseAds(body)) : null;
  } else {
    // 滚动页一次遍历完成：先删广告 section，再按过滤后的列表补歌词 section，
    // 避免补在会被丢弃的 section 之后。
    out = safePatch(() => patchScroll(body, trackId, wantAds, wantCard));
  }

  finish(out);

})();
