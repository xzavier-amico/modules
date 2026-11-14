//=======================================================================================
// Spotify Premium — 信息流广告过滤
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
      const modeInFifth = ["full", "no_card", "metadata_only", "response_only", "card_only"].indexOf(raw[4]) >= 0;
      opt = { spoof_premium: raw[0], block_ads: raw[1], unlock_playback: raw[2], enable_lyrics: raw[3], desktop: modeInFifth ? false : raw[4], lyrics_mode: modeInFifth ? raw[4] : raw[5], prefetch: raw[6] };
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
  // full / no_card / metadata_only 处理元数据和歌词响应；card_only 只补歌词 section。
  // 保留旧值解析，兼容已保存的参数。
  const lyricsMode = ["full", "no_card", "metadata_only", "response_only", "card_only"].indexOf(opt.lyrics_mode) >= 0 ? opt.lyrics_mode : "full";
  const lyricsMetaOn = lyricsOn && (lyricsMode === "full" || lyricsMode === "no_card" || lyricsMode === "metadata_only");
  // 歌词卡片：full / card_only 时向 scrollsita 列表补一个真实的歌词 section。
  const lyricsCardOn = lyricsOn && (lyricsMode === "full" || lyricsMode === "card_only");
  // 预取下一首：滚动页补卡时顺手把队列里下一首的歌词也查好写进缓存。
  const prefetchOn = flag(opt.prefetch, true);

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
    return fields.map((f) =>
      f.wire === 0
        ? { no: f.no, w: 0, v: wireReadVarint(f.data, { i: 0 }), raw: f.raw }
        : { no: f.no, w: f.wire, p: f.data, raw: f.raw },
    );
  }

  function serialize(fields) {
    return wireConcat(fields.map((f) => wireEncodeField(f.no, f.w, f.w === 0 ? wireEncodeVarint(f.v) : f.p)));
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

  // feed 脚本复用 lyrics.js 的查询 / 缓存逻辑，但只加载 prefetch 入口。
  // 这里在 lyrics.js 之前执行：告诉它不要处理 color-lyrics 响应，并把 feed
  // 自己的参数位置翻译成歌词脚本认识的选项。
  const SPOTIFY_LYRICS_PREFETCH = true;
  const SPOTIFY_PREFETCH_OPTIONS = (() => {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：spoof, ads, unlock, enable_lyrics, desktop, lyrics_source。
      return { enable_lyrics: raw[3], lyrics_source: raw[5] };
    }
    if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw || "{}") || {};
        return { enable_lyrics: parsed.enable_lyrics, lyrics_source: parsed.lyrics_source };
      } catch (e) {
        return {};
      }
    }
    if (raw && "object" == typeof raw) {
      return { enable_lyrics: raw.enable_lyrics, lyrics_source: raw.lyrics_source };
    }
    return {};
  })();

// Spotify Lyrics — 官方没有歌词时，用第三方歌词补上。
//
// 只处理 color-lyrics/v{N}/track/{id} 的响应：
//   200 且歌词非空  -> 清掉额度限制后原样放行（官方歌词质量更好）
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

  // feed 脚本会在同一份源码上以 prefetch 模式加载：只暴露歌词查询 / 缓存，
  // 不处理 color-lyrics 响应。独立歌词脚本仍按原来的入口执行。
  const PREFETCH = typeof SPOTIFY_LYRICS_PREFETCH !== "undefined" && SPOTIFY_LYRICS_PREFETCH;

  const req = typeof $request !== "undefined" && $request ? $request : null;
  const res = typeof $response !== "undefined" && $response ? $response : null;
  const url = (res && res.url) || (req && req.url) || "";

  // Loon 传位置数组，Egern 传 JSON 字符串。
  let opt = {};
  if (PREFETCH) {
    // feed 的位置参数和歌词脚本不同，由 feed/lyrics-prefetch.js 解析后传入。
    opt = typeof SPOTIFY_PREFETCH_OPTIONS !== "undefined" && SPOTIFY_PREFETCH_OPTIONS ? SPOTIFY_PREFETCH_OPTIONS : {};
  } else {
    try {
      const raw = typeof $argument !== "undefined" ? $argument : undefined;
      if (Array.isArray(raw)) {
        const modes = ["full", "no_card", "metadata_only", "response_only", "card_only"];
        const modeInThird = modes.indexOf(raw[2]) >= 0;
        opt = { lyrics_source: raw[0], enable_lyrics: raw[1], desktop: modeInThird ? false : raw[2],
          lyrics_mode: modeInThird ? raw[2] : modes.includes(raw[3]) ? raw[3] : undefined };
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

  // 这个脚本只在响应阶段被调用；请求阶段或参数关闭时直接放行。
  // Loon 靠 enable= 决定是否加载脚本，Egern 不支持条件加载，只能在这里早退。
  if (!PREFETCH && !res) {
    $done({});
    return;
  }
  if (!PREFETCH && (!flag(opt.enable_lyrics, true) || opt.lyrics_mode === "metadata_only" || opt.lyrics_mode === "card_only")) {
    $done({});
    return;
  }

  const match = /\/color-lyrics\/v\d\/track\/([A-Za-z0-9]+)/.exec(url);
  let trackId = PREFETCH ? "" : match ? match[1] : "";
  if (!PREFETCH && !match) {
    $done({});
    return;
  }

  const USER_AGENT = "xzavier-modules/1.0 (https://github.com/xzavier-amico/modules)";
  const utf8 = new TextDecoder("utf-8");
  const encoder = new TextEncoder();

  // spotify.js 在改写曲目元数据时，顺手把曲名 / 歌手 / 时长存进了本地存储。
  // 命中时连 oEmbed 都不用请求，只留 embed 页面取封面配色。
  const TRACK_CACHE_KEY = "spotify.track.meta";
  const TRACK_CACHE_MAX = 24;

  // 歌词结果缓存：同一首歌的播放器、歌词页与歌词卡会重复请求 color-lyrics，
  // 命中后直接回缓存，不再打第三方源。命中的歌词基本不会变，存久一点；
  // 查不到时只记 10 分钟，避免一次网络抖动把这首歌永久判成「无歌词」。
  const LYRICS_CACHE_KEY = "spotify.lyrics.cache";
  const LYRICS_CACHE_MAX = 8;
  const LYRICS_CACHE_HIT_TTL = 24 * 60 * 60 * 1000;
  const LYRICS_CACHE_MISS_TTL = 10 * 60 * 1000;
  const LYRICS_CACHE_MAX_LINES = 400;
  const LYRICS_CACHE_MAX_BYTES = 400 * 1024;
  const LYRICS_DEADLINE_MS = 15000;
  const PLAIN_FALLBACK_MS = 5000;
  // feed 脚本在返回 scrollsita 之前等歌词；比歌词页的 15 秒短，避免 Now Playing
  // 卡片列表等太久。超时就不补卡，歌词页之后仍可正常重试。
  const PREFETCH_DEADLINE_MS = 8000;

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

  const lyricsCacheKey = (id) => lyricsSourceKey() + "|" + id;

  function readLyricsCache(key) {
    const map = readJsonMap(LYRICS_CACHE_KEY);
    const entry = map && map[key];
    if (!entry || "object" != typeof entry) return null;
    const ttl = entry.m ? LYRICS_CACHE_MISS_TTL : LYRICS_CACHE_HIT_TTL;
    if (!(Date.now() - Number(entry.t || 0) < ttl)) return null;
    if (entry.m) return { miss: true };
    const lines = Array.isArray(entry.a) ? entry.a : [];
    if (!lines.length) return null;
    const signed = (value) => (value > 0x7fffffff ? value - 0x100000000 : value);
    const provider = String(entry.p || "LRCLIB");
    return {
      payload: {
        lyrics: {
          syncType: entry.s === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
          lines: lines.map((pair) => ({
            startTimeMs: String(Number(pair && pair[0]) || 0),
            words: String((pair && pair[1]) || ""),
            syllables: [],
            endTimeMs: "0",
          })),
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
    const map = readJsonMap(LYRICS_CACHE_KEY) || {};
    const now = Date.now();
    if (!payload) {
      map[key] = { t: now, m: 1 };
    } else {
      const lyrics = payload.lyrics || {};
      const colors = payload.colors || {};
      const lines = [];
      const raw = Array.isArray(lyrics.lines) ? lyrics.lines : [];
      for (let i = 0; i < raw.length && i < LYRICS_CACHE_MAX_LINES; i += 1) {
        const line = raw[i];
        if (!line || typeof line.words !== "string" || !line.words.trim()) continue;
        lines.push([Number(line.startTimeMs) || 0, line.words.slice(0, 200)]);
      }
      if (!lines.length) return;
      map[key] = {
        t: now,
        m: 0,
        s: lyrics.syncType === "UNSYNCED" ? "UNSYNCED" : "LINE_SYNCED",
        p: String(lyrics.provider || "LRCLIB"),
        i: lyrics.providerLyricsId === undefined || lyrics.providerLyricsId === null ? "" : String(lyrics.providerLyricsId),
        l: String(lyrics.language || "en"),
        c: [Number(colors.background) || 0xff808080, Number(colors.text) || 0xff000000, Number(colors.highlightText) || 0xffffffff],
        a: lines,
      };
    }
    for (const id of Object.keys(map)) {
      const entry = map[id];
      const ttl = entry && entry.m ? LYRICS_CACHE_MISS_TTL : LYRICS_CACHE_HIT_TTL;
      if (!entry || !(now - Number(entry.t || 0) < ttl)) delete map[id];
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
  // 第三方请求是否出现过网络错误 / 5xx / 429；这类失败不应写成「无歌词」短缓存。
  let networkFailed = false;
  let cacheKey = "";
  let prefetchTimer;
  let prefetchCallback = null;
  let prefetchSettle = null;
  // 本轮预取是否还有没回来的来源（超时 / 先发纯文本）。feed 用它在结束后决定
  // 能不能紧接着预取下一首：还有请求在飞时重置状态会让旧结果写进新曲目的缓存。
  let prefetchIncomplete = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    if (deadline !== undefined && typeof clearTimeout === "function") clearTimeout(deadline);
    if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
    $done(value);
  };

  if (PREFETCH) {
    // 只暴露一个「先查歌词、写完缓存再回调」的入口。feed 脚本在补歌词卡之前
    // 调用它：歌词已经准备好才组装卡片，客户端随后请求 color-lyrics 时直接命中
    // 缓存，不会出现「卡片先出来、歌词过一会儿才到」的空卡。
    prefetchSettle = (payload) => {
      if (settled) return;
      settled = true;
      if (prefetchTimer !== undefined && typeof clearTimeout === "function") clearTimeout(prefetchTimer);
      const callback = prefetchCallback;
      prefetchCallback = null;
      if (callback) callback(payload, { incomplete: prefetchIncomplete });
    };
    globalThis.__spotifyLyricsPrefetch = (id, callback) => {
      if (!id || typeof callback !== "function") return;
      if (!flag(opt.enable_lyrics, true)) {
        callback(null, { incomplete: false });
        return;
      }
      // 同一脚本实例会连续预取当前曲目和下一首：每轮重置状态与定时器。
      // 只有上一轮没有遗留请求时才会走到这里（feed 用 incomplete 拦截）。
      if (prefetchTimer !== undefined && typeof clearTimeout === "function") clearTimeout(prefetchTimer);
      if (plainTimer !== undefined && typeof clearTimeout === "function") clearTimeout(plainTimer);
      settled = false;
      networkFailed = false;
      plainFallback = null;
      prefetchIncomplete = false;
      prefetchTimer = undefined;
      plainTimer = undefined;
      trackId = id;
      cacheKey = lyricsCacheKey(id);
      const cached = readLyricsCache(cacheKey);
      if (cached) {
        prefetchCallback = null;
        callback(cached.miss ? null : cached.payload, { incomplete: false });
        return;
      }
      prefetchCallback = callback;
      if (typeof setTimeout === "function") {
        prefetchTimer = setTimeout(() => {
          if (settled) return;
          // 超时不算「确认没有歌词」，不写 miss，下次歌词页还能重试。
          networkFailed = true;
          prefetchIncomplete = true;
          prefetchSettle(null);
        }, PREFETCH_DEADLINE_MS);
      }
      resolvePublicLyrics((payload) => {
        if (settled) return;
        if (payload || !networkFailed) writeLyricsCache(cacheKey, payload);
        prefetchSettle(payload);
      });
    };
    return;
  }

  const rawBody = res.body;
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
  const status = Number(res.status || res.statusCode);

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
  const accept = headerValue(req && req.headers, "accept").toLowerCase();
  const format = /[?&]format=(json|protobuf)(?:&|$)/i.exec(url);
  const requestedProto = format ? format[1].toLowerCase() === "protobuf"
    : accept.indexOf("protobuf") >= 0 ? true
    : accept.indexOf("json") >= 0 ? false
    : null;
  const protoMode = status === 200 && hasBody
    ? trimmed.charAt(0) !== "{"
    : requestedProto !== null ? requestedProto : !desktop;

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
        const cleaned = count > 0 ? normalizeRestrictionProto(inspected) : null;
        if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/x-protobuf" }, body: cleaned });
        else finish({});
        return;
      }
    } else if (hasLyrics(trimmed)) {
      const cleaned = stripRestrictionJson(trimmed);
      if (cleaned) finish({ status: 200, headers: { "Content-Type": "application/json; charset=utf-8" }, body: cleaned });
      else finish({});
      return;
    }
  }

  // 歌词结果缓存：同一首歌在播放器 / 歌词页 / 歌词卡之间的重复请求不再重复查源。
  // 只缓存「官方没有歌词」的分支，官方歌词不会走到这里。
  cacheKey = lyricsCacheKey(trackId);
  const cachedLyrics = readLyricsCache(cacheKey);
  if (cachedLyrics) {
    if (cachedLyrics.miss) {
      finish({});
      return;
    }
    emit(cachedLyrics.payload);
    return;
  }

  // 总时限；超时后用纯文本兜底，没有就按「没有歌词」放行。
  if (typeof setTimeout === "function") deadline = setTimeout(() => {
    if (settled) return;
    // 超时说明至少有一个源没按时回来，不能当作「确认无歌词」写短缓存。
    networkFailed = true;
    if (plainFallback) {
      writeLyricsCache(cacheKey, plainFallback);
      emit(plainFallback);
    } else {
      finish({});
    }
  }, LYRICS_DEADLINE_MS);
  resolveLyrics((payload) => {
    if (settled) return;
    // 纯网络失败不写 miss，下一次打开还能重试；只有所有源都明确没结果才记 10 分钟。
    if (payload || !networkFailed) writeLyricsCache(cacheKey, payload);
    if (!payload) {
      finish({});
      return;
    }
    emit(payload);
  });

  // 取曲目元数据 -> 按配置的歌词源找 -> 回调 payload
  function resolveLyrics(cb) {
    resolvePublicLyrics(cb);
  }

  function resolvePublicLyrics(cb) {
    // 客户端拉过的元数据优先：命中时直接查歌词，open.spotify.com 一次都不请求，
    // 歌词页背景用默认底色（不再为封面配色抓 embed 页面）。
    const cached = cachedTrackMeta(trackId);
    if (cached) {
      runSource(sourceOrder(cached.title, cached.artist), cached.title, cached.artist, cb, cached.duration, () => cached.color || null);
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
      runSource(sourceOrder(info.title, info.artist), info.title, info.artist,
        (payload) => cb(payload), info.duration, colorOf);
    };
    // embed 提供封面主色与兜底元数据；请求与歌词查询并行，不阻塞歌词响应。
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
      });
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
      // 缺歌手、或 Live 曲目要靠 embed 的歌手 / 时长做校验，才等 embed。
      if ((!info.artist || isLive(info.title)) && !embedDone) {
        beginEmbed();
        return;
      }
      // 正常曲目立即开始查歌词，同时发出配色请求，但不等待它。
      beginEmbed();
      start();
    };
    httpGetJson(oembedUrl, (data) => {
      meta = data;
      metaDone = true;
      maybeStart();
    });
  }

  // ---- 歌词源 -----------------------------------------------------------

  function sourceOrder(title, artist) {
    const wanted = String(opt.lyrics_source || "auto").toLowerCase();
    // Musixmatch 是 Spotify 的官方歌词上游，auto 不使用，仅在显式选择时查询。
    const auto = CJK_MARK.test(title + artist)
      ? ["netease", "qq", "lrclib"] : ["lrclib", "netease", "qq"];
    if (wanted === "lrclib" || wanted === "musixmatch" || wanted === "netease" || wanted === "qq") return [wanted];
    return auto;
  }

  // 并发查询所有来源：首个通过校验的同步歌词胜出；只有纯文本时等全部结束。
  function runSource(order, title, artist, done, duration, colorOf) {
    if (settled) return;
    if (!order.length) {
      done(null);
      return;
    }
    let remaining = order.length;
    let finished = false;
    for (const name of order) {
      if (settled || finished) return;
      lookup(name, title, artist, duration, (record) => {
        if (settled || finished) return;
        if (record && colorOf) record.albumColor = colorOf();
        const payload = buildPayload(record);
        if (payload && (payload.lyrics.syncType === "LINE_SYNCED" || order.length === 1)) {
          finished = true;
          done(payload);
          return;
        }
        if (payload && !plainFallback) {
          plainFallback = payload;
          // 有纯文本但同步歌词还在路上时，别让用户干等到总超时：
          // 5 秒内还没有同步版本就先把纯文本发出去，后续结果不再覆盖。
          if (typeof setTimeout === "function") plainTimer = setTimeout(() => {
            if (settled || !plainFallback) return;
            if (PREFETCH) prefetchIncomplete = true;
            writeLyricsCache(cacheKey, plainFallback);
            emit(plainFallback);
          }, PLAIN_FALLBACK_MS);
        }
        remaining -= 1;
        if (!remaining) {
          finished = true;
          done(plainFallback);
        }
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

  // LRCLIB：/api/get 与 /api/search 都会带回歌词。完整曲名和去掉装饰括号后的
  // 曲名各发 get + search，四路并行；首个通过校验的同步歌词立即返回，只有全都
  // 没命中时才用歌名再搜一次（歌手写法不一致的兜底）。
  function lookupLrclib(title, artist, duration, cb) {
    const cleanTitle = queryTitle(title);
    const names = cleanTitle && cleanTitle !== title ? [title, cleanTitle] : [title];
    const lists = [];
    const records = [];
    let pending = names.length * 2;
    let done = false;

    const all = () => lists.concat(records);
    const syncedPick = () => {
      const synced = [];
      for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const item of list) if (isSynced(item)) synced.push(item);
      }
      for (const record of records) if (isSynced(record)) synced.push(record);
      return pickRecord(synced, title, duration, artist);
    };

    const finish = () => {
      if (done || pending) return;
      done = true;
      const picked = pickRecord(all(), title, duration, artist);
      if (picked) {
        cb(withProvider(picked, "LRCLIB"));
        return;
      }
      // 歌手写法不一致（feat. / 多歌手 / 翻译名）时，用歌名再搜一次；
      // pickRecord 仍会按 artist 过滤，不会把别人的同名歌当成结果。
      if (!artist) {
        cb(null);
        return;
      }
      httpGetJson("https://lrclib.net/api/search?track_name=" + encodeURIComponent(names[names.length - 1]), (list) => {
        const fallback = pickRecord(list, title, duration, artist);
        cb(fallback ? withProvider(fallback, "LRCLIB") : null);
      });
    };

    const settle = () => {
      pending -= 1;
      if (done) return;
      const hit = syncedPick();
      if (hit) {
        done = true;
        cb(withProvider(hit, "LRCLIB"));
        return;
      }
      finish();
    };

    for (const name of names) {
      const query = "track_name=" + encodeURIComponent(name) + (artist ? "&artist_name=" + encodeURIComponent(artist) : "");
      httpGetJson("https://lrclib.net/api/get?" + query, (record) => {
        if (record && "object" === typeof record) records.push(record);
        settle();
      });
      httpGetJson("https://lrclib.net/api/search?" + query, (list) => {
        if (Array.isArray(list)) lists.push(list);
        settle();
      });
    }
  }

  // 网易云：搜索接口不需要 token，中文曲库覆盖最好。
  function lookupNetease(title, artist, duration, cb) {
    const query = encodeURIComponent(queryTitle(title) + (artist ? " " + artist : ""));
    const headers = { Referer: "https://music.163.com/" };
    httpGetJson("https://music.163.com/api/search/get?s=" + query + "&type=1&limit=10&offset=0", (data) => {
      const songs = data && data.result && data.result.songs;
      const select = () => {
        const candidates = rankSongs(songs, title, artist, duration, (item) => item.name,
          (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.duration) / 1000);
        tryCandidates(candidates, (picked, next) => {
          httpGetJson("https://music.163.com/api/song/lyric?id=" + picked.id + "&lv=-1&kv=-1&tv=-1", (lyric) => {
            const text = lyric && lyric.lrc && lyric.lrc.lyric;
            next(text ? { provider: "NetEase", providerId: String(picked.id), syncedLyrics: text } : null);
          }, headers);
        }, cb);
      };
      // 搜索结果可能缺少歌手别名：只对匹配的曲目按歌手 ID 补全，最多 3 次请求。
      const pending = [];
      if (rankSongs(songs, title, artist, duration, (item) => item.name,
          (item) => (item.artists || []).reduce((names, a) => names.concat(artistNames(a)), []), (item) => Number(item.duration) / 1000).length) {
        select();
        return;
      }
      if (artist && Array.isArray(songs)) {
        for (const song of songs) {
          if (!song || !matchesSong(title, "", duration, song.name, "", Number(song.duration) / 1000)) continue;
          const people = Array.isArray(song.artists) ? song.artists : [];
          if (matchesArtist(artist, people.reduce((names, a) => names.concat(artistNames(a)), []))) continue;
          for (const person of people) {
            if (!person || !/^\d+$/.test(String(person.id)) || pending.some((p) => p.id === person.id)) continue;
            if (pending.length < 3) pending.push(person);
          }
        }
      }
      const resolve = () => {
        if (!pending.length) { select(); return; }
        // 歌手详情请求并行发出，全部回来后再统一补 alias；旧实现一个个等，
        // 最多 3 个歌手会串成 3 个 RTT。
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
            if (!left) select();
          }, headers);
        }
      };
      resolve();
    }, headers);
  }

  // QQ 音乐：搜索拿 songmid，再用 nobase64=1 取明文 LRC。
  function lookupQq(title, artist, duration, cb) {
    const query = encodeURIComponent(queryTitle(title) + (artist ? " " + artist : ""));
    const headers = { Referer: "https://y.qq.com/" };
    httpGetJson("https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=" + query + "&format=json&n=10&p=1", (data) => {
      const list = data && data.data && data.data.song && data.data.song.list;
      const candidates = rankSongs(list, title, artist, duration, (item) => item.songname,
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
  // 再调 macro.subtitles.get 拿逐行字幕。
  function lookupMusixmatch(title, artist, duration, cb) {
    // 该接口不提供足够的场次信息，Live 曲目直接跳过。
    if (isLive(title)) { cb(null); return; }
    const APP_ID = "mac-ios-v2.0";
    httpGetJson("https://apic.musixmatch.com/ws/1.1/token.get?app_id=" + APP_ID, (token) => {
      const userToken = token && token.message && token.message.body && token.message.body.user_token;
      if (!userToken) {
        cb(null);
        return;
      }
      const target =
        "https://apic.musixmatch.com/ws/1.1/macro.subtitles.get?format=json&app_id=" + APP_ID +
        "&usertoken=" + encodeURIComponent(userToken) +
        "&track_spotify_id=" + encodeURIComponent(trackId) +
        "&subtitle_format=lrc" +
        "&q_track=" + encodeURIComponent(title) +
        (artist ? "&q_artist=" + encodeURIComponent(artist) : "") +
        "&user_language=zh";
      httpGetJson(target, (data) => {
        const status = data && data.message && data.message.header && data.message.header.status_code;
        const calls = data && data.message && data.message.body && data.message.body.macro_calls;
        const matched = calls && calls["matcher.track.get"] && calls["matcher.track.get"].message;
        const track = matched && matched.body && matched.body.track;
        // 字幕接口可能返回无关的默认结果，需同时校验曲目匹配与字幕状态。
        if (Number(status) !== 200 || !matched || !matched.header || Number(matched.header.status_code) !== 200 || !track || Number(track.instrumental) === 1 ||
            !matchesSong(title, artist, duration, track.track_name, track.artist_name, Number(track.track_length))) {
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
      });
    });
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

  function rankSongs(list, title, artist, duration, nameOf, artistOf, durationOf) {
    if (!Array.isArray(list)) return [];
    const wanted = normalize(queryTitle(title));
    const singer = normalize(artist);
    const score = (item) => {
      const name = normalize(nameOf(item));
      const seconds = durationOf(item);
      return (name === wanted ? 4 : name.indexOf(wanted) === 0 ? 2 : 0)
        + (singer && matchesArtist(artist, artistOf(item)) ? 8 : 0)
        + (Number.isFinite(duration) && duration > 0 && Math.abs(seconds - duration) <= 4 ? 6 : 0);
    };
    return list.filter((item) => item && matchesSong(title, artist, duration, nameOf(item), artistOf(item), durationOf(item)))
      .sort((a, b) => score(b) - score(a)).slice(0, 3);
  }

  function isLive(title) {
    return LIVE_MARK.test(String(title));
  }

  function songTitle(title) {
    let text = String(title).replace(SONG_TITLE_LIVE, "").replace(SONG_TITLE_LIVE_BRACKET, "");
    // 歌手名、版本说明不参与歌名比较：Spotify 常见 "Song (feat. X)"、
    // "Song - 2011 Remaster" 而曲库只写 "Song"。
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    return normalize(text);
  }

  // 查询第三方曲库时也先去掉 feat / remaster 等后缀；Live / Acoustic / Remix
  // 这类真正决定版本的信息保留，避免把现场版查成录音室版。
  // 括号里的影视 / 节目 / 歌手等装饰信息也一并去掉；只有包含版本词时才保留。
  function queryTitle(title) {
    let text = String(title);
    text = text.replace(SONG_TITLE_DASH_FEAT, "").replace(SONG_TITLE_DASH_EDITION, "");
    text = text.replace(SONG_TITLE_BRACKET_NOISE, "");
    text = text.replace(SONG_TITLE_BRACKET_GROUP, (whole, inner) =>
      SONG_TITLE_VERSION_BRACKET.test(inner) ? whole : " ");
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

  function matchesSong(title, artist, duration, candidateTitle, candidateArtist, candidateDuration) {
    if (!candidateTitle || !matchTitles(title, candidateTitle)) return false;
    if (isLive(title) !== isLive(candidateTitle)) return false;
    if (INSTRUMENTAL_MARK.test(candidateTitle) && !INSTRUMENTAL_MARK.test(title)) return false;
    const singer = normalize(artist);
    if (singer && !matchesArtist(artist, candidateArtist)) return false;
    const stage = STAGE_MARK.exec(title);
    const otherStage = STAGE_MARK.exec(candidateTitle);
    if (stage && otherStage && stage[1] !== otherStage[1]) return false;
    // 仅凭 “Live” 无法确定具体场次，需再核对时长和场次信息。
    if (isLive(title)) {
      const timed = Number.isFinite(duration) && duration > 0 && Number.isFinite(candidateDuration) && candidateDuration > 0;
      if (timed && Math.abs(candidateDuration - duration) > 8) return false;
      if (stage && !otherStage && (!timed || !singer)) return false;
    }
    return true;
  }

  // 候选歌词请求并行发出（最多 3 个），首个拿到可解析歌词的胜出；全部没歌词
  // 时返回 null。旧实现按排名一个个试，候选越多越慢。
  function tryCandidates(candidates, fetch, cb, limit = 3) {
    if (settled) return;
    const picked = Array.isArray(candidates) ? candidates.slice(0, limit) : [];
    if (!picked.length) { cb(null); return; }
    let pending = picked.length;
    let done = false;
    for (const candidate of picked) {
      fetch(candidate, (record) => {
        if (settled || done) return;
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

  function httpGetJson(target, callback, extraHeaders) {
    httpGetText(target, (data) => {
      let parsed = null;
      try { parsed = data ? JSON.parse(data) : null; } catch (e) {}
      callback(parsed);
    }, extraHeaders);
  }

  function httpGetText(target, callback, extraHeaders, timeoutMs) {
    if (settled) return;
    let done = false;
    const reply = (value) => {
      if (done || settled) return;
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
      const options = { url: target, headers: headers, timeout: timeoutMs || 8000 };
      const onReply = (error, response, data) => {
        if (done || settled) return;
        const statusCode = Number(response && response.status);
        if (error || !response) {
          networkFailed = true;
          reply(null);
          return;
        }
        // 429 / 5xx 是临时故障，标记后不写「无歌词」短缓存，下次还能重试。
        if (statusCode === 429 || statusCode >= 500) networkFailed = true;
        if (statusCode >= 400 || !data) {
          reply(null);
          return;
        }
        // 第三方接口不可控：超长响应不解析，避免 JSON.parse 占满内存。
        if ("string" != typeof data || data.length > MAX_HTTP_JSON_BYTES) {
          reply(null);
          return;
        }
        reply(data);
      };

      // 优先用客户端的 $httpClient；没有注入时回退到 QX 的 $task.fetch 和
      // 运行时自带的 fetch。某个客户端只实现了其中一种时也不会静默失败。
      if (typeof $httpClient !== "undefined" && $httpClient && typeof $httpClient.get === "function") {
        $httpClient.get(options, onReply);
        return;
      }
      if (typeof $task !== "undefined" && $task && typeof $task.fetch === "function") {
        $task.fetch({ url: target, headers: headers, timeout: timeoutMs || 8000 }).then(
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
      networkFailed = true;
      reply(null);
    }
  }

  function emit(payload) {
    if (PREFETCH) {
      if (prefetchSettle) prefetchSettle(payload);
      return;
    }
    if (protoMode) {
      const bytes = encodeProto(payload.lyrics.lines, payload.lyrics.syncType, payload.lyrics.provider,
        payload.lyrics.providerLyricsId, payload.lyrics.language, payload.colors);
      // 与官方响应头保持一致。
      finish({ status: 200, headers: { "Content-Type": "application/vnd.google.protobuf" }, body: bytes });
      return;
    }

    finish({
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(payload),
    });
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
    return pbConcat([pbUint(1, Number(line.startTimeMs) || 0), pbBytes(2, content)]);
  }

  function encodeProto(lines, syncType, provider, providerId, language, colors) {
    const parts = [pbUint(1, syncType === "LINE_SYNCED" ? 1 : 0)];
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

  // 把 LyricsData.restriction（字段 14）统一成 1 = showLyrics。
  // 免费号额度用完时服务端回 3，客户端只显示额度提示；这里改回 1 后正常放行。
  function normalizeRestrictionProto(inspected) {
    const top = inspected.top;
    let changed = false;
    const outTop = [];
    for (let i = 0; i < top.length; i += 1) {
      const f = top[i];
      if (f !== inspected.lyrics) {
        outTop.push(pbEncodeField(f));
        continue;
      }
      const inner = inspected.inner;
      const outInner = [];
      for (let j = 0; j < inner.length; j += 1) {
        const g = inner[j];
        if (g.field === 14 && g.wire === 0) {
          if (g.value !== 1) {
            changed = true;
          }
          outInner.push(pbUint(14, 1));
          continue;
        }
        outInner.push(pbEncodeField(g));
      }
      outTop.push(pbBytes(1, pbConcat(outInner)));
    }
    return changed ? pbConcat(outTop) : null;
  }

  function stripRestrictionJson(text) {
    try {
      const data = JSON.parse(text);
      const lyrics = data && data.lyrics;
      if (!lyrics || !Object.prototype.hasOwnProperty.call(lyrics, "restriction")) return null;
      delete lyrics.restriction;
      return JSON.stringify(data);
    } catch (e) {
      return null;
    }
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

  function buildPayload(record) {
    if (!record || "object" != typeof record || record.instrumental) return null;

    if (typeof record.syncedLyrics === "string") {
      const lines = parseLrc(record.syncedLyrics);
      if (lines.length) return makePayload("LINE_SYNCED", lines, record);
    }

    if (typeof record.plainLyrics === "string") {
      const lines = record.plainLyrics
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((words) => ({ startTimeMs: "0", words: words, syllables: [], endTimeMs: "0" }));
      if (lines.length) return makePayload("UNSYNCED", lines, record);
    }

    return null;
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
      out.push({ startTimeMs: String(ms), words: line.words, syllables: [], endTimeMs: "0" });
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
    const provider = record.provider || "LRCLIB";
    const id = record.providerId !== undefined ? record.providerId : record.id;
    const language = detectLanguage(lines);
    // 值是 32 位有符号整数。
    const signed = (v) => (v > 0x7fffffff ? v - 0x100000000 : v);
    const palette = albumColors(record);
    return {
      lyrics: {
        syncType: syncType,
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

  // 同名曲目往往有好几版（原版、Video Edit、Extended Mix）。打分选版本：
  // 时长贴近的优先（时间轴才对得上），其次要有同步时间轴，其次曲名精确匹配。
  function pickRecord(list, title, duration, artist) {
    if (!Array.isArray(list) || !list.length) return null;
    const wanted = normalize(title);
    const usable = list.filter((item) => {
      if (!item || "object" != typeof item || item.instrumental) return false;
      if (!matchesSong(title, artist, duration, item.trackName, item.artistName, Number(item.duration))) return false;
      return Boolean(
        (typeof item.syncedLyrics === "string" && item.syncedLyrics.trim()) ||
          (typeof item.plainLyrics === "string" && item.plainLyrics.trim()),
      );
    });
    if (!usable.length) return null;

    const synced = (item) => Boolean(item.syncedLyrics && item.syncedLyrics.trim());
    const named = (item) => normalize(item.trackName) === wanted;
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
    // NFKC 处理全角 / 组合字符；翻译与简繁转换需要来源提供对应文本。
    return String(text || "")
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

  // 补卡前先做一次廉价的字节扫描：列表里已经有歌词 section 时不用去查歌词，
  // 避免每首官方有歌词的歌都白等一次第三方查询。完整的 section 结构仍由
  // patchScroll 在重编码时确认。
  function hasLyricsCard(buffer) {
    if (!buffer || !buffer.length || buffer.length < LYRICS_SECTION_ID_BYTES.length) return false;
    const needle = LYRICS_SECTION_ID_BYTES;
    const last = buffer.length - needle.length;
    for (let i = 0; i <= last; i += 1) {
      if (buffer[i] !== needle[0]) continue;
      let j = 1;
      while (j < needle.length && buffer[i + j] === needle[j]) j += 1;
      if (j === needle.length) return true;
    }
    return false;
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

  // 入口：首页 / 搜索 / 滚动页的赞助内容过滤，滚动页额外补歌词卡对应的 section。
  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  const url = res.url || (typeof $request !== "undefined" && $request && $request.url) || "";
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
  const wantCard = isScroll && lyricsCardOn;
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
  const PREFETCH_NEXT_MS = 1500;
  // 下一首：connect-state 存下的队列顺序。只用于预取歌词，取不到就跳过。
  const nextTrackId = (() => {
    if (!prefetchOn || !isScroll || !trackId) return "";
    const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
    if (!store) return "";
    try {
      const raw = store.read("spotify.queue");
      const queue = raw ? JSON.parse(raw) : null;
      if (!queue) return "";
      const at = Number(queue.at) || 0;
      if (at && Date.now() - at > 30 * 60 * 1000) return "";
      // 新结构是 current + next[]；旧安装里可能还是 ids[]，按当前曲目位置兜底。
      let next = "";
      if (Array.isArray(queue.next)) {
        if (queue.current && queue.current !== trackId) return "";
        next = queue.next[0] || "";
      } else if (Array.isArray(queue.ids)) {
        const index = queue.ids.indexOf(trackId);
        next = index >= 0 ? queue.ids[index + 1] || "" : "";
      }
      if (!next || next === trackId) return "";
      // 没有曲名 / 歌手时预取要先请求 oEmbed，反而拖慢补卡；等元数据到了再说。
      const metaRaw = store.read("spotify.track.meta");
      const meta = metaRaw ? JSON.parse(metaRaw) : null;
      return meta && meta[next] ? next : "";
    } catch (e) {
      return "";
    }
  })();
  const finish = (out) => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    $done({ body: out });
  };

  // 滚动页的歌词卡：先让歌词脚本把结果写进缓存，再补 section。这样卡片出现时
  // 客户端随后请求 color-lyrics 会直接命中缓存，不会先显示空卡、重进才加载。
  // 列表里已经有歌词 section（官方歌词）时不做这次查询。
  const prefetch = typeof globalThis !== "undefined" ? globalThis.__spotifyLyricsPrefetch : null;
  if (isScroll && wantCard && trackId && typeof prefetch === "function" &&
      !(typeof hasLyricsCard === "function" && hasLyricsCard(body))) {
    const finishCard = (payload) => finish(patchScroll(body, trackId, wantAds, !!payload));
    prefetch(trackId, (payload, meta) => {
      // 当前曲目超时、或还有来源没回来时，不再接着预取下一首：下一轮需要重置
      // 歌词脚本状态，上一轮晚到的结果会写进下一首的缓存。
      const canPrefetchNext = prefetchOn && !!nextTrackId && !(meta && meta.incomplete) &&
        typeof setTimeout === "function";
      if (!canPrefetchNext) {
        finishCard(payload);
        return;
      }
      let settledNext = false;
      let timer = null;
      const afterNext = () => {
        if (settledNext) return;
        settledNext = true;
        if (timer !== null && typeof clearTimeout === "function") clearTimeout(timer);
        finishCard(payload);
      };
      // 下一首只为写缓存，最多等 1.5 秒，避免没有歌词的歌把滚动页拖住。
      timer = setTimeout(afterNext, PREFETCH_NEXT_MS);
      prefetch(nextTrackId, afterNext);
    });
    return;
  }

  let out = null;
  if (isHome) {
    out = wantAds ? stripHomeAds(body) : null;
  } else if (isBrowse) {
    out = wantAds ? hideBrowseAds(body) : null;
  } else {
    // 滚动页一次遍历完成：先删广告 section，再按过滤后的列表补歌词 section，
    // 避免补在会被丢弃的 section 之后。
    out = patchScroll(body, trackId, wantAds, wantCard);
  }

  finish(out);

})();
