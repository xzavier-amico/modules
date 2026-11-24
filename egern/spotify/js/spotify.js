//=======================================================================================
// Spotify Enhance — bootstrap / UCS / 元数据 / 远程配置 / 账号属性
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


const ENV_BODY_BINARY = true;

//=====================================================================================
// Egern 原生模式适配层
//
// Egern 的脚本入口是 export default async function (ctx)，参数从 ctx.env 读；
// 而 Loon / Shadowrocket 用的仍是 Surge 兼容全局（$request / $response / $done /
// $persistentStore / $argument）。为了三端共用同一份脚本主体，这里把 ctx 适配成
// 那几个全局变量，脚本主体一行都不用改。
//
// 参数：env_schema 生成的设置项会以字符串写进 ctx.env，直接作为 $argument 交给脚本；
// 各脚本的 flag() / asBool() 已经能处理 "true" / "false" 字符串。
//=====================================================================================

export default async function (ctx) {
  const plainHeaders = (headers) => {
    const out = {};
    if (!headers) return out;
    if ("function" == typeof headers.forEach) {
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    for (const key of Object.keys(headers)) out[key] = headers[key];
    return out;
  };

  // ctx 的 body 是只能读一次的流，先整体读出来交给兼容代码按字符串 / 字节处理。
  // 文本脚本按字符串给 body，protobuf / 二进制脚本给字节。
  // 构建时按目标注入 ENV_BODY_BINARY。
  const binaryBody = "undefined" != typeof ENV_BODY_BINARY && ENV_BODY_BINARY;
  const readBody = async (message) => {
    if (!message || !message.body) return undefined;
    try {
      const bytes = new Uint8Array(await message.arrayBuffer());
      return binaryBody ? bytes : new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      return undefined;
    }
  };

  // 响应阶段脚本不读请求体，跳过 ctx.request.arrayBuffer() 避免额外缓冲与内存占用。
  const requestBody = ctx.response ? undefined : await readBody(ctx.request);
  const responseBody = await readBody(ctx.response);

  const request = ctx.request
    ? { url: ctx.request.url, method: ctx.request.method, headers: plainHeaders(ctx.request.headers), body: requestBody }
    : undefined;
  const response = ctx.response
    ? {
        url: ctx.request && ctx.request.url,
        status: ctx.response.status,
        statusCode: ctx.response.status,
        headers: plainHeaders(ctx.response.headers),
        body: responseBody,
      }
    : undefined;

  // $httpClient 的 callback 形式（error, response, data）。
  const httpOptions = (options) => ("string" == typeof options ? { url: options } : options || {});
  const httpCall = (method, options, callback) => {
    const opt = httpOptions(options);
    Promise.resolve()
      .then(() =>
        ctx.http[method](opt.url, {
          headers: opt.headers,
          body: opt.body,
          timeout: opt.timeout,
        }),
      )
      .then(async (res) => {
        const headers = plainHeaders(res.headers);
        callback(null, { status: res.status, statusCode: res.status, headers }, await res.text());
      })
      .catch((error) => callback(error || new Error("request failed"), null, null));
  };

  // 数组是 Loon 旧版的位置参数，原样透传，脚本自己按位置还原。
  const $argument = Array.isArray(ctx.env) ? ctx.env : Object.assign({}, ctx.env || {});
  const $request = request;
  const $response = response;
  const $persistentStore = {
    read: (key) => (ctx.storage ? ctx.storage.get(key) : null),
    write: (value, key) => {
      if (ctx.storage) ctx.storage.set(key, value);
      return true;
    },
  };
  const $httpClient = {
    get: (options, callback) => httpCall("get", options, callback),
    post: (options, callback) => httpCall("post", options, callback),
  };

  return await new Promise((resolve) => {
    let settled = false;

    // 把 $done 的返回值翻译成 ctx 的返回值。
    const finish = (value) => {
      if (settled) return;
      settled = true;

      // 请求阶段直接返回本地响应。
      if (value && value.response) {
        resolve(ctx.respond ? ctx.respond(value.response) : value.response);
        return;
      }

      const body = ctx.response ? responseBody : requestBody;

      // 原样放行：body 已经被读走，必须显式还回去，否则请求 / 响应体会变成空。
      if (!value || !Object.keys(value).length) {
        resolve(body === undefined ? undefined : { body });
        return;
      }

      const next = Object.assign({}, value);
      if (next.body === undefined && body !== undefined) next.body = body;
      resolve(next);
    };

    function $done(value) {
      finish(value);
    }

    try {

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
    if ("number" == typeof value && value >= 0 && value <= 0x7fffffff) {
      let n = value | 0;
      const len = n < 0x80 ? 1 : n < 0x4000 ? 2 : n < 0x200000 ? 3 : n < 0x10000000 ? 4 : 5;
      const out = new Uint8Array(len);
      let at = 0;
      while (n >= 0x80) {
        out[at++] = (n & 0x7f) | 0x80;
        n >>>= 7;
      }
      out[at] = n;
      return out;
    }
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

  // 流式遍历字段，不分配字段对象与子数组；回调返回 true 时提前停止。
  function wireForEachField(bytes, onField) {
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
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no, wire, dataStart, state.i, rawStart, state.i)) return true;
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
      // prefetch_lyrics, sync_plain_lyrics, lyrics_isrc。
      opt = {
        spoof_premium: raw[0], block_ads: raw[1], unlock_playback: raw[2],
        enable_lyrics: raw[3], desktop: raw[4], lyrics_source: raw[5],
        prefetch_lyrics: raw[6], sync_plain_lyrics: raw[7], lyrics_isrc: raw[8],
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
  const MAX_META_BYTES = 12 * 1024 * 1024; // extended-metadata / metadata：大块无关扩展数据会被跳过，不整树解析
  // context-resolve / connect-state 是大量小字段，整树解析时每 1MB 响应约占 7MB JS 堆；
  // Loon 的网络扩展只有约 50MB，超过 3MB 直接放行，避免把隧道进程撑爆。
  const MAX_CONTEXT_BYTES = 3 * 1024 * 1024;
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

  // 小整数 varint（字段号 / 长度）：失败（截断 / 超长 / 越界）返回 -1，不抛异常。
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
      // 超过 4 字节：退回 BigInt 路径，拒绝超出 32 位范围的非法 tag / 长度。
      try {
        const big = wireReadVarint(bytes, state, limit);
        return big <= 0xffffffffn ? Number(big) : -1;
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
      let varintValue;
      if (wire === 2) {
        const length = readCount(b, state);
        if (length < 0 || length > total - state.i) return null;
        dataStart = state.i;
        end = dataStart + length;
      } else if (wire === 0) {
        // 单趟解码 varint：1-4 字节小整数直接位运算，避免 subarray 与逐字节 BigInt 分配。
        let at = dataStart;
        let small = 0;
        let shift = 0;
        let resolved = false;
        while (at < total && shift < 28) {
          const byte = b[at++];
          small |= (byte & 0x7f) << shift;
          if (!(byte & 0x80)) {
            const u = small >>> 0;
            varintValue = u === 0 ? 0n : u === 1 ? 1n : BigInt(u);
            end = at;
            resolved = true;
            break;
          }
          shift += 7;
        }
        if (!resolved) {
          state.i = dataStart;
          try {
            varintValue = wireReadVarint(b, state, total);
          } catch (e) {
            return null;
          }
          end = state.i;
        }
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
        fields.push({ no: no, w: 0, v: varintValue, raw: raw });
      } else if (wire === 3) {
        // group 原样保留：p 存的是含起止 tag 的整段，serialize 直接写回。
        fields.push({ no: no, w: 3, p: raw, raw: raw });
      } else {
        fields.push({ no: no, w: wire, p: b.subarray(dataStart, end), raw: raw });
      }
    }
    return fields;
  }

  // varint 的 Number 版：字段号 / 长度 / 常见数值都远小于 2^31，用常数分支和位运算
  // 避开浮点除法；超过 2^53 的 64 位值仍走 BigInt 保证不丢位。
  const MAX_SAFE_BIG = 9007199254740991n;
  function varintSize(n) {
    if (n < 128) return 1;
    if (n < 16384) return 2;
    if (n < 2097152) return 3;
    if (n < 268435456) return 4;
    if (n <= 0xffffffff) return 5;
    let size = 1;
    while (n >= 128) {
      n = Math.floor(n / 128);
      size += 1;
    }
    return size;
  }

  function writeVarint(out, at, n) {
    if (n <= 0x7fffffff) {
      while (n >= 128) {
        out[at++] = (n & 0x7f) | 0x80;
        n >>>= 7;
      }
      out[at++] = n;
      return at;
    }
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
    if (len === 1) return raw[at] === n;
    if (n <= 0x7fffffff) {
      for (let i = 0; i < len - 1; i += 1) {
        if (raw[at + i] !== ((n & 0x7f) | 0x80)) return false;
        n >>>= 7;
      }
      return raw[at + len - 1] === n;
    }
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
  function edit(message, path, fn, fields = parse(message)) {
    if (!path.length) return fn(message, fields);
    if (!fields || !allCanonical(fields)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;

  // ------------------------------------------------------------ remote config

  // 播放衔接：不改写交叉淡入淡出 / Gapless 相关开关。免费号被强制打开
  // crossfade 后，App 会直接按本地滑杆（常见默认 4 秒）把下一首提前混进来，
  // 表现为倒计时结束又响了 1–2 秒。只强制关闭 AutoMix，它才是按节拍提前
  // 混入下一首的元凶；Crossfade 仍由 App 自己的设置决定。
  const RULES = [
    ["ios-feature-settings","automix_enabled",2,0,"","misc"],
    ["core-automix","automix_enabled",2,0,"","misc"],
    ["","enable_common_capping",0,0,"","cap"],
    ["","enable_pns_common_capping",0,0,"","cap"],
    ["","enable_pick_and_shuffle_common_capping",0,0,"","cap"],
    ["","enable_pick_and_shuffle_dynamic_cap",0,0,"","cap"],
    ["","pick_and_shuffle_timecap",0,0,"","cap"],
    ["ios-feature-queue","",0,0,"","cap"],
    ["","enable_free_on_demand_experiment",0,0,"","misc"],
    ["","enable_free_on_demand_context_menu_experiment",0,0,"","misc"],
    ["","enable_mft_plus_queue",0,0,"","cap"],
    ["","enable_mft_plus_extended_queue",0,0,"","cap"],
    ["","enable_playback_timeout_service",1,0,"","cap"],
    ["","enable_playback_timeout_error_ui",1,0,"","cap"],
    ["","playback_timeout_action",3,0,"Nothing","cap"],
    ["","is_remove_from_queue_enabled_for_mft_plus",0,0,"","cap"],
    ["","is_reordering_for_mft_plus_allowed",0,0,"","cap"],
    ["","ads",1,0,"","ad"],
    ["","ad_metadata",0,0,"","ad"],
    ["","ad_slots",0,0,"","ad"],
    ["","enable_ads",1,0,"","ad"],
    ["","enable_audio_ads",1,0,"","ad"],
    ["","enable_display_ads",1,0,"","ad"],
    ["","enable_video_ads",1,0,"","ad"],
    ["","enable_premium_upsell",1,0,"","ad"],
    ["","enable_upsell",1,0,"","ad"],
    ["","show_upsell",1,0,"","ad"],
    ["","show_premium_upsell",1,0,"","ad"],
    ["","enable_campaigns",1,0,"","misc"],
    ["","enable_promotions",1,0,"","ad"],
    ["","enable_search_ad",1,0,"","ad"],
    ["","enable_search_ads",1,0,"","ad"],
    ["","enable_search_banner_ad",1,0,"","ad"],
    ["","enable_search_banner_ads",1,0,"","ad"],
    ["","enable_search_sponsored_ad",1,0,"","ad"],
    ["","enable_search_sponsored_ads",1,0,"","ad"],
    ["","enable_search_upsell",1,0,"","ad"],
    ["","enable_home_ad",1,0,"","ad"],
    ["","enable_home_ads",1,0,"","ad"],
    ["","enable_home_banner_ad",1,0,"","ad"],
    ["","enable_home_banner_ads",1,0,"","ad"],
    ["","enable_home_sponsored_ad",1,0,"","ad"],
    ["","enable_home_sponsored_ads",1,0,"","ad"],
    ["","enable_home_upsell",1,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","is_enabled_pt2",2,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","linear_upsell_new_style_experiment_enabled",2,0,"","ad"],
    ["ios-feature-shuffletoggleupsell","play_modes_upsell_new_style_experiment_enabled",2,0,"","ad"],
    ["ios-jam-freeusershuffleupsellsheetpage-impl","free_user_shuffle_upsell_sheet_enabled",2,0,"","ad"],
    ["ios-jam-freeuserskipupsellpage-impl","free_user_skip_upsell_sheet_enabled",2,0,"","ad"],
    ["ios-jam-freehostedjamsupsell-impl","free_hosted_jams_upsell_enabled",2,0,"","ad"],
    ["ios-reinventfree-contextualupsellpremiumpromo-impl","is_promo_cta_enabled",2,0,"","ad"],
    ["ios-reinventfree-contextualupsellpremiumpromo-impl","show_time_cap_upsell_with_premium_badge",2,0,"","ad"],
    ["ios-reinventfree-controllerui-impl","enable_video_time_cap_upsell",2,0,"","ad"],
    ["ios-reinventfree-controllerui-impl","enable_video_time_cap_upsell_on_search",2,0,"","ad"],
    ["ios-reinventfree-timecappivot-impl","music_video_upsell_enabled",2,0,"","ad"],
    ["ios-settings-mediaqualitypageplugin-impl","is_gbb_upsell_enabled",2,0,"","ad"],
    ["ios-settings-mediaqualitypageplugin-impl","should_show_pigeon_upsell",2,0,"","ad"],
    ["ios-system-listeningparties","preview_ended_upsell_enabled",2,0,"","ad"],
    ["","enable_now_playing_ad",1,0,"","ad"],
    ["","enable_now_playing_ads",1,0,"","ad"],
    ["","enable_now_playing_banner_ad",1,0,"","ad"],
    ["","enable_now_playing_banner_ads",1,0,"","ad"],
    ["","enable_now_playing_sponsored_ad",1,0,"","ad"],
    ["","enable_now_playing_sponsored_ads",1,0,"","ad"],
    ["","enable_now_playing_upsell",1,0,"","ad"],
    ["","enable_artist_ad",1,0,"","ad"],
    ["","enable_artist_ads",1,0,"","ad"],
    ["","enable_artist_banner_ad",1,0,"","ad"],
    ["","enable_artist_banner_ads",1,0,"","ad"],
    ["","enable_artist_sponsored_ad",1,0,"","ad"],
    ["","enable_artist_sponsored_ads",1,0,"","ad"],
    ["","enable_artist_upsell",1,0,"","ad"],
    ["","enable_playlist_ad",1,0,"","ad"],
    ["","enable_playlist_ads",1,0,"","ad"],
    ["","enable_playlist_banner_ad",1,0,"","ad"],
    ["","enable_playlist_banner_ads",1,0,"","ad"],
    ["","enable_playlist_sponsored_ad",1,0,"","ad"],
    ["","enable_playlist_sponsored_ads",1,0,"","ad"],
    ["","enable_playlist_upsell",1,0,"","ad"],
    ["","enable_album_ad",1,0,"","ad"],
    ["","enable_album_ads",1,0,"","ad"],
    ["","enable_album_banner_ad",1,0,"","ad"],
    ["","enable_album_banner_ads",1,0,"","ad"],
    ["","enable_album_sponsored_ad",1,0,"","ad"],
    ["","enable_album_sponsored_ads",1,0,"","ad"],
    ["","enable_album_upsell",1,0,"","ad"],
    ["","enable_library_ad",1,0,"","ad"],
    ["","enable_library_ads",1,0,"","ad"],
    ["","enable_library_banner_ad",1,0,"","ad"],
    ["","enable_library_banner_ads",1,0,"","ad"],
    ["","enable_library_sponsored_ad",1,0,"","ad"],
    ["","enable_library_sponsored_ads",1,0,"","ad"],
    ["","enable_library_upsell",1,0,"","ad"],
    ["","enable_audiobook_ad",1,0,"","ad"],
    ["","enable_audiobook_ads",1,0,"","ad"],
    ["","enable_audiobook_banner_ad",1,0,"","ad"],
    ["","enable_audiobook_banner_ads",1,0,"","ad"],
    ["","enable_audiobook_sponsored_ad",1,0,"","ad"],
    ["","enable_audiobook_sponsored_ads",1,0,"","ad"],
    ["","enable_audiobook_upsell",1,0,"","ad"],
    ["","enable_podcast_ad",1,0,"","ad"],
    ["","enable_podcast_ads",1,0,"","ad"],
    ["","enable_podcast_banner_ad",1,0,"","ad"],
    ["","enable_podcast_banner_ads",1,0,"","ad"],
    ["","enable_podcast_sponsored_ad",1,0,"","ad"],
    ["","enable_podcast_sponsored_ads",1,0,"","ad"],
    ["","enable_podcast_upsell",1,0,"","ad"],
    ["","enable_sponsored_content",1,0,"","ad"],
    ["","enable_sponsored_playlists",1,0,"","ad"],
    ["","enable_sponsored_sessions",1,0,"","ad"],
    ["","enable_sponsored_stories",1,0,"","ad"],
    ["","enable_sponsored_videos",1,0,"","ad"],
    ["","enable_sponsored_artist",1,0,"","ad"],
    ["","enable_sponsored_artists",1,0,"","ad"],
    ["","enable_sponsored_album",1,0,"","ad"],
    ["","enable_sponsored_albums",1,0,"","ad"],
    ["","enable_sponsored_track",1,0,"","ad"],
    ["","enable_sponsored_tracks",1,0,"","ad"],
    ["","enable_sponsored_show",1,0,"","ad"],
    ["","enable_sponsored_shows",1,0,"","ad"],
    ["","enable_sponsored_episode",1,0,"","ad"],
    ["","enable_sponsored_episodes",1,0,"","ad"],
    ["","enable_sponsored_audiobook",1,0,"","ad"],
    ["","enable_sponsored_audiobooks",1,0,"","ad"],
    ["","enable_sponsored_podcast",1,0,"","ad"],
    ["","enable_sponsored_podcasts",1,0,"","ad"],
    ["","enable_sponsored_search",1,0,"","ad"],
    ["","enable_sponsored_search_results",1,0,"","ad"],
    ["","enable_sponsored_search_banner",1,0,"","ad"],
    ["","enable_sponsored_search_banners",1,0,"","ad"],
    ["","enable_sponsored_home",1,0,"","ad"],
    ["","enable_sponsored_home_banner",1,0,"","ad"],
    ["","enable_sponsored_home_banners",1,0,"","ad"],
    ["","enable_sponsored_now_playing",1,0,"","ad"],
    ["","enable_sponsored_now_playing_banner",1,0,"","ad"],
    ["","enable_sponsored_now_playing_banners",1,0,"","ad"],
    ["","enable_sponsored_artist_banner",1,0,"","ad"],
    ["","enable_sponsored_artist_banners",1,0,"","ad"],
    ["","enable_sponsored_playlist_banner",1,0,"","ad"],
    ["","enable_sponsored_playlist_banners",1,0,"","ad"],
    ["","enable_sponsored_album_banner",1,0,"","ad"],
    ["","enable_sponsored_album_banners",1,0,"","ad"],
    ["","enable_sponsored_library_banner",1,0,"","ad"],
    ["","enable_sponsored_library_banners",1,0,"","ad"],
    ["","enable_sponsored_audiobook_banner",1,0,"","ad"],
    ["","enable_sponsored_audiobook_banners",1,0,"","ad"],
    ["","enable_sponsored_podcast_banner",1,0,"","ad"],
    ["","enable_sponsored_podcast_banners",1,0,"","ad"],
    ["","enable_sponsored_search_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_search_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_home_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_home_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_now_playing_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_now_playing_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_artist_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_artist_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_playlist_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_playlist_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_album_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_album_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_library_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_library_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_audiobook_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_audiobook_sponsored_ads",1,0,"","ad"],
    ["","enable_sponsored_podcast_sponsored_ad",1,0,"","ad"],
    ["","enable_sponsored_podcast_sponsored_ads",1,0,"","ad"],
    ["ios-ad-on-app-open","",0,0,"","ad"],
    ["ios-feature-adonappopen","",0,0,"","misc"],
    ["ios-feature-adonappopen","enabled",1,0,"","misc"],
    ["ios-feature-adonappopen","background_refresh_frequency_seconds",1,0,"","misc"],
    ["","is_ad_on_app_open_enabled",1,0,"","ad"],
    ["","ad_on_app_open_enabled",1,0,"","ad"],
    ["","adonappopen_enabled",1,0,"","misc"],
    ["marquee","",0,0,"","ad"],
    ["ios-feature-marquee","",0,0,"","ad"],
    ["leavebehindadsbase","",0,0,"","misc"],
    ["ios-feature-leavebehindadsbase","",0,0,"","misc"],
    ["ios-nowplaying-scroll-impl","unified_leavebehind_npv_scroll_music_enabled",2,0,"","misc"],
    ["ios-nowplaying-scroll-impl","unified_leavebehind_npv_scroll_podcast_enabled",2,0,"","misc"],
    ["ios-feature-embeddedplaylist","use_unified_leavebehind_fetch",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","foreground_enabled",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","music_track_change_enabled",2,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","enable_ads_on_podcast",2,0,"","ad"],
    ["ios-feature-instreamads","",0,0,"","misc"],
    ["ios-adsembedded-embeddedctaelements-impl","",0,0,"","misc"],
    ["ios-adsnowplaying-embeddednpv-impl","",0,0,"","misc"],
    ["ios-adsplatform-elementimpl","",0,0,"","misc"],
    ["ios-system-adssponsoredcontext","",0,0,"","ad"],
    ["ios-feature-adsbase","enable_ads_connect_state_observer",1,0,"","ad"],
    ["ios-feature-adsbase","enable_minimal_preroll_management",1,0,"","misc"],
    ["ios-feature-adsbase","enable_swift_ads_base_movement_logger",1,0,"","ad"],
    ["ios-feature-adsswift","",0,0,"","misc"],
    ["ios-feature-adsnowplayingui","embedded_npv_video_show_with_canvas",2,0,"","misc"],
    ["ios-feature-adssponsoredcontext","sponsored_context_mismatch_aderror_enabled",1,0,"","ad"],
    ["ios-feature-adssponsoredcontext","sponsored_playlist_v2_enabled",1,0,"","ad"],
    ["ios-feature-adssponsoredcontextnpbattachment","sponsored_npb_slot_fetch_enabled",1,0,"","ad"],
    ["ios-feature-adsidentitytracking","",0,0,"","misc"],
    ["","enable_popups",1,0,"","ad"],
    ["","enable_leave_behind_ads_card_element",1,0,"","ad"],
    ["","music_npv_leavebehinds_enabled",1,0,"","misc"],
    ["","enable_ads_on_podcast",1,0,"","ad"],
    ["","enable_display_element",1,0,"","misc"],
    ["","enable_video_element",1,0,"","misc"],
    ["","is_promo_cta_enabled",1,0,"","ad"],
    ["","show_time_cap_upsell_with_premium_badge",1,0,"","ad"],
    ["","enable_video_time_cap_upsell",1,0,"","ad"],
    ["","enable_video_time_cap_upsell_on_search",1,0,"","ad"],
    ["","music_video_upsell_enabled",1,0,"","ad"],
    ["","is_gbb_upsell_enabled",1,0,"","ad"],
    ["","should_show_pigeon_upsell",1,0,"","ad"],
    ["","disable_suggested_tracks_upsell",1,1,"","ad"],
    ["","is_enabled_pt2",1,0,"","misc"],
    ["","show_skip_button_during_skippable_ads",1,1,"","ad"],
    ["","sponsored_playlist_v2_header_dismissible",1,1,"","ad"],
    ["","use_mock_sponsorship_endpoint",1,0,"","ad"],
    ["","enable_popup",1,0,"","ad"],
    ["","show_popups",1,0,"","ad"],
    ["","show_popup",1,0,"","ad"],
    ["","enable_interstitials",1,0,"","misc"],
    ["","enable_interstitial",1,0,"","ad"],
    ["","enable_overlays",1,0,"","misc"],
    ["","enable_overlay",1,0,"","misc"],
    ["","enable_promotions_on_home",1,0,"","ad"],
    ["","enable_promotions_on_search",1,0,"","ad"],
    ["","enable_search_page_ads",1,0,"","ad"],
    ["","enable_home_page_ads",1,0,"","ad"],
    ["","enable_billboard",1,0,"","ad"],
    ["","enable_billboards",1,0,"","misc"],
    ["","enable_audio_ads_player",1,0,"","ad"],
    ["","enable_display_ads_player",1,0,"","ad"],
    ["","enable_video_ads_player",1,0,"","ad"],
    ["","enable_audio_ads_player_v2",1,0,"","ad"],
    ["","enable_display_ads_player_v2",1,0,"","ad"],
    ["","enable_video_ads_player_v2",1,0,"","ad"],
    ["","enable_sponsored_search_results_v2",1,0,"","ad"],
    ["","enable_sponsored_home_results_v2",1,0,"","ad"],
    ["ios-feature-search","prompted_playlist_merchandizing_enabled",1,0,"","misc"],
    ["","should_nova_scroll_use_scrollsita",0,0,"","misc"],
    ["ios-sociallistening-configuration-impl","premium_gated_start_jam_buttons_enabled",2,0,"","misc"],
    // 歌词相关开关保持开启：客户端只有在这些开关打开时才会请求 color-lyrics。
    ["ios-feature-lyrics","is_lyrics_card_element_enabled",2,1,"","misc"],
    ["ios-feature-lyrics","is_get_lyrics_v2_enabled",2,1,"","misc"],
    ["ios-feature-lyrics","enable_lyrics",2,1,"","misc"],
    // 桌面端（1.3.9 起 remote-config-resolver 返回 JSON，属性在 desktop-ui
    // scope 里，命名与 iOS 那套完全不同）的广告 / 推广 / 升级位开关。只列名字
    // 里明确是广告 / 赞助 / 升级的项，其余桌面特性不动。
    ["desktop-ui","enableEmbeddedAdHtmlDisplay",2,0,"","ad"],
    ["desktop-ui","enable_ad_feedback_in_stream",2,0,"","ad"],
    ["desktop-ui","enable_ad_feedback_milestone_1",2,0,"","ad"],
    ["desktop-ui","enable_ad_feedback_milestone_3",2,0,"","ad"],
    ["desktop-ui","enable_ad_reporting",2,0,"","ad"],
    ["desktop-ui","showAdBreakTimeRemaining",2,0,"","ad"],
    ["desktop-ui","embeddedAdsPrioritizeCanvas",2,0,"","ad"],
    ["desktop-ui","enableSponsoredPlaylistV2",2,0,"","ad"],
    ["desktop-ui","enableSponsoredPlaylistV2ScrollCard",2,0,"","ad"],
    ["desktop-ui","enableSponsoredPlaylistHorizontalVideo",2,0,"","ad"],
    ["desktop-ui","enableSponsorshipLabelsOnSearch",2,0,"","ad"],
    ["desktop-ui","enableSponsorshipLabelsOnPlaylistCards",2,0,"","ad"],
    ["desktop-ui","enableLyricsUpsell",2,0,"","ad"],
    ["desktop-ui","canYourDJUserBeConvertedToPremium",2,0,"","ad"]
  ];

  // -------------------------------------------------------------- attributes

  const yearOn = new Date(Date.now() + 365 * 86400000).toISOString().replace(/\.\d{3}Z$/, "Z");

  const ATTR_CORE = {
    // 不写 enable-crossfade-product-state / enable-gapless-product-state：
    // 这两项由服务端与 App 播放设置决定。强制打开会让上一首结尾和下一首重叠，
    // 表现为倒计时结束后仍响 1–2 秒。
    "catalogue": "premium",
    "financial-product": "pr:premium,tc:0",
    "is-eligible-premium-unboxing": true,
    "name": "Spotify Premium",
    "nft-disabled": "1",
    "on-demand": true,
    "payments-initial-campaign": "default",
    "player-license": "premium",
    "player-license-v2": "premium",
    "product-expiry": yearOn,
    "shuffle-eligible": true,
    "streaming-rules": "",
    "subscription-enddate": yearOn,
    "type": "premium",
    "unrestricted": true,
    "can_use_superbird": true,
    "high-bitrate": true,
    "loudness-levels": "1:-5.0,0.0,3.0:-2.0",
    "mixing-tools": "EDIT",
    "your-library-tags": true,
    "libspotify": true,
    "lyrics-offline": true,
    "mobile": true,
    "pick-and-shuffle": false
  };

  const ATTR_ADS = {
    "ads": false,
    "ab-ad-player-targeting": "0",
    "allow-advertising-id-transmission": false,
    "restrict-advertising-id-transmission": true
  };

  // macOS 桌面端只写展示 / 广告属性。播放授权（player-license、streaming-rules、
  // on-demand、high-bitrate …）由服务端判定；强行写会让客户端以为有 Premium
  // 播放权，几秒后拿不到音频密钥就跳歌。需要时由 unlock_playback 单独打开。
  //
  // 展示侧要和 iOS 对齐，否则「设置 → 账号」「你的方案」这些页面还是免费版的
  // 样子，看不出模块有没有生效：账单产品串、首次付费活动、以及到期 / 订阅结束
  // 日期都属于纯展示字段（不参与播放授权判定），这里一起写。
  const MAC_ATTR = {
    "ads": false,
    "name": "Spotify Premium",
    "is-eligible-premium-unboxing": true,
    "nft-disabled": "1",
    "type": "premium",
    "product": "premium",
    "catalogue": "premium",
    "financial-product": "pr:premium,tc:0",
    "payments-initial-campaign": "default",
    "product-expiry": yearOn,
    "subscription-enddate": yearOn,
    // 让桌面客户端优先采用 UCS 下发的 product state，这样才会相信改写的
    // product / catalogue，而不是回头再查账号状态。只影响展示与远程配置。
    "com.spotify.madprops.delivered.by.ucs": true,
    "com.spotify.madprops.use.ucs.product.state": true
  };

  // 真正的播放授权字段，只在 unlock_playback 打开时写。
  const MAC_PLAY_ATTR = {
    "player-license": "premium",
    "player-license-v2": "premium",
    "streaming-rules": "",
    "on-demand": true,
    "unrestricted": true,
    "high-bitrate": true
  };

  // 会让客户端重新向服务端确认状态或弹出试用提示的属性，删除后避免回退到免费版。
  const STRIPPED = [
    "payment-state",
    "last-premium-activation-date",
    "on-demand-trial",
    "on-demand-trial-in-progress",
    "smart-shuffle",
    "at-signal",
    "feature-set-id-masked",
    "strider-key",
    "is-eligible-for-trial",
    "is-eligible-for-upsell",
    "upsell-state",
    "ad-session-persistence",
    "ad-formats-preroll-video"
  ];

  const forced = desktop
    ? Object.assign(
        {},
        spoof ? MAC_ATTR : {},
        adsOn ? ATTR_ADS : {},
        spoof && playOn ? MAC_PLAY_ATTR : {}
      )
    : Object.assign({}, spoof ? ATTR_CORE : {}, adsOn ? ATTR_ADS : {});
  const has = (key) => Object.prototype.hasOwnProperty.call(forced, key);
  const stripped = (key) => {
    if (!spoof) return false;
    if (key.indexOf("is-premium-eligible") === 0) return true;
    if (!adsOn && key.indexOf("ad") === 0) return false;
    return STRIPPED.indexOf(key) >= 0;
  };

  const attributeEntry = (key, value) => {
    const inner = typeof value === "string" ? fieldString(4, value) : fieldVarint(2, value ? 1 : 0);
    return fieldBytes(1, serialize([fieldString(1, key), fieldBytes(2, serialize([inner]))]));
  };

  function patchAttributes(buffer, fields = parse(buffer)) {
    if (!fields || !allCanonical(fields)) return null;
    const out = [];
    const seen = Object.create(null);
    let regionSaved = false;
    for (const f of fields) {
      let key = null;
      let inner = null;
      if (f.no === 1 && f.w === 2) {
        inner = parse(f.p);
        if (inner) key = text(first(inner, 1));
      }
      // 顺手记下账号地区，避免再单独遍历一遍属性表；headers 脚本据此选择时区。
      if (!regionSaved && key && inner && rememberRegionEntry(key, inner)) {
        regionSaved = true;
      }
      if (!key || (!has(key) && !stripped(key))) {
        out.push(f);
        continue;
      }
      if (!has(key)) continue;
      seen[key] = true;
      out.push(attributeEntry(key, forced[key]));
    }
    for (const key in forced) if (!seen[key]) out.push(attributeEntry(key, forced[key]));
    return serialize(out);
  }

  // ------------------------------------------------------- JSON 账号属性
  //
  // 桌面端（1.3.9 起）`nebula/v1/configuration/attributes` 返回 JSON：
  //
  //   { "attributes": { "type": { "stringValue": "free" },
  //                     "ads": { "boolValue": false },
  //                     "estimated-age": { "longValue": 33 }, … } }
  //
  // protobuf 那套改写看不见它，桌面端的 type / catalogue / name /
  // financial-product 会一直停在 free，试听相关属性也删不掉。这里按同一份
  // forced / STRIPPED 表处理，值类型跟着原属性走（bool → boolValue、
  // string → stringValue、数字 → longValue）。

  const JSON_ATTR_KINDS = ["boolValue", "stringValue", "longValue", "intValue", "doubleValue"];

  function jsonAttributeValue(value) {
    if (typeof value === "string") return { stringValue: value };
    if (typeof value === "number") return { longValue: value };
    return { boolValue: !!value };
  }

  function jsonAttributeKind(entry) {
    if (!entry || "object" !== typeof entry || Array.isArray(entry)) return null;
    for (const kind of JSON_ATTR_KINDS) {
      if (Object.prototype.hasOwnProperty.call(entry, kind)) return kind;
    }
    return null;
  }

  // headers 脚本要用账号地区挑时区；JSON 里叫 country_code。
  function rememberRegionJson(attributes) {
    const store = cacheStore();
    if (!store) return;
    for (const key of Object.keys(attributes)) {
      const lower = key.toLowerCase();
      if (REGION_ATTR_KEYS.indexOf(lower) < 0 && lower !== "country_code") continue;
      const entry = attributes[key];
      const value = entry && typeof entry.stringValue === "string" ? entry.stringValue : "";
      if (!/^[A-Za-z]{2}$/.test(value)) continue;
      const next = value.toUpperCase();
      try {
        if (store.read(REGION_KEY) === next) return;
        store.write(next, REGION_KEY);
      } catch (e) {
        // 存储写失败不影响响应改写。
      }
      return;
    }
  }

  // 只改写认得出的属性集合；结构不对就整份放行，避免把别的 JSON 接口写坏。
  function patchAttributesJson(attributes) {
    if (!attributes || "object" !== typeof attributes || Array.isArray(attributes)) return null;
    const keys = Object.keys(attributes);
    for (const key of keys) {
      if (!jsonAttributeKind(attributes[key])) return null;
    }
    rememberRegionJson(attributes);
    let changed = false;
    const seen = Object.create(null);
    for (const key of keys) {
      if (has(key)) {
        attributes[key] = jsonAttributeValue(forced[key]);
        seen[key] = true;
        changed = true;
        continue;
      }
      if (stripped(key)) {
        delete attributes[key];
        changed = true;
      }
    }
    for (const key in forced) {
      if (seen[key]) continue;
      attributes[key] = jsonAttributeValue(forced[key]);
      changed = true;
    }
    return changed ? attributes : null;
  }

  // ------------------------------------------------------------ remote config

  const boolValue = (on) => (on ? serialize([fieldVarint(1, 1)]) : new Uint8Array(0));

  function setValue(value, replacement) {
    const kept = value.filter((f) => f.no < 3 || f.no > 5);
    kept.push(replacement);
    return kept;
  }

  let cachedRuleIndex = null;
  function getRuleIndex() {
    if (cachedRuleIndex) return cachedRuleIndex;
    const byName = new Map();
    const wildcard = [];
    for (let i = 0; i < RULES.length; i++) {
      const rule = RULES[i];
      if ((rule[5] === "ad" && !adsOn) || (rule[5] === "cap" && !playOn)) continue;
      if (!rule[1]) wildcard.push(i);
      else {
        if (!byName.has(rule[1])) byName.set(rule[1], []);
        byName.get(rule[1]).push(i);
      }
    }
    cachedRuleIndex = { byName, wildcard };
    return cachedRuleIndex;
  }

  function patchConfiguration(buffer, fields = parse(buffer), assigned = null) {
    if (!fields || !allCanonical(fields)) return null;
    const out = [];
    const present = Object.create(null);
    const scopes = Object.create(null);
    const { byName, wildcard } = getRuleIndex();
    const isDesktop = typeof desktop !== "undefined" && desktop;
    for (const f of fields) {
      let value = null;
      const described = assigned && assigned.get(f);
      if (f.no === 3 && f.w === 2) value = described ? described.value : parse(f.p);
      if (!value || !allCanonical(value)) {
        out.push(f);
        continue;
      }
      const identifier = first(value, 1);
      const parts = described ? described.parts : identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) {
        out.push(f);
        continue;
      }
      const scope = text(first(parts, 1)) || "";
      const name = text(first(parts, 2)) || "";
      let removed = false;
      let touched = false;
      const named = byName.get(name) || [];
      let ni = 0;
      let wi = 0;
      while (ni < named.length || wi < wildcard.length) {
        const index = wi >= wildcard.length || (ni < named.length && named[ni] < wildcard[wi]) ? named[ni++] : wildcard[wi++];
        const rule = RULES[index];
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
        touched = true;
        if (rule[2] === 0) {
          removed = true;
          break;
        }
        if (rule[2] === 1) {
          if (first(value, 3)) value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else if (rule[2] === 2) {
          value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else {
          value = setValue(value, fieldBytes(5, serialize([fieldString(1, rule[4])])));
        }
      }
      if (removed) continue;
      present[scope + "\u0000" + name] = true;
      if (scope) scopes[scope] = true;
      if (touched) f.p = serialize(value);
      out.push(f);
    }
    for (const rule of RULES) {
      if (rule[2] !== 2 || !rule[0] || !rule[1]) continue;
      if ((rule[5] === "ad" && !adsOn) || (rule[5] === "cap" && !playOn)) continue;
      // 移动端 protobuf 不塞入桌面端专属 desktop-ui 开关，避免冗余噪声。
      if (!isDesktop && rule[0] === "desktop-ui" && !scopes[rule[0]]) continue;
      if (present[rule[0] + "\u0000" + rule[1]]) continue;
      const identifier = serialize([fieldString(1, rule[0]), fieldString(2, rule[1])]);
      out.push(fieldBytes(3, serialize([fieldBytes(1, identifier), fieldBytes(3, boolValue(rule[3]))])));
    }
    return serialize(out);
  }

  // 新版 App 会在 bootstrap 之后重新拉取远程配置与账号属性；
  // 这里套用同一套规则 / 属性表，避免覆盖已写入的开关。

  function describeConfiguration(fields) {
    if (!fields || !fields.length) return null;
    const assigned = new Map();
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const value = parse(f.p);
      if (!value) return null;
      const identifier = first(value, 1);
      const parts = identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) return null;
      const scope = text(first(parts, 1));
      const name = text(first(parts, 2));
      if (!scope || !name) return null;
      assigned.set(f, { value, parts });
    }
    // 保留未知字段，只要求 AssignedValue 列表结构正确。
    return assigned.size ? assigned : null;
  }


  function looksLikeAttributes(buffer, fields = parse(buffer)) {
    if (!fields || !fields.length) return false;
    let entries = 0;
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2) continue;
      const inner = parse(f.p);
      if (!inner) return false;
      const key = text(first(inner, 1));
      const value = first(inner, 2);
      if (!key || key.length > 64 || !value || value.w !== 2) return false;
      const parts = parse(value.p);
      if (!parts) return false;
      for (const vf of parts) {
        if (vf.no === 2 && vf.w === 0) continue;
        if (vf.no === 3 && vf.w === 0) continue;
        if (vf.no === 4 && vf.w === 2) continue;
        return false;
      }
      entries++;
    }
    // 顶层其它字段原样保留；至少有一条合法属性才按属性表处理。
    return entries > 0;
  }

  // JSON 远程配置。规则语义与 protobuf 一一对应：
  //   0 -> 删掉这条 AssignedValue
  //   1 -> 只改已存在的 boolValue
  //   2 -> 强制 bool（没有就补一条）
  //   其它 -> 改成字符串枚举（enumValue）
  const JSON_CONFIG_SCALARS = ["boolValue", "enumValue", "stringValue", "intValue",
    "longValue", "doubleValue", "floatValue"];

  function jsonAssignedList(data) {
    if (!data || "object" !== typeof data) return null;
    const configuration = data.configuration;
    if (configuration && "object" === typeof configuration && Array.isArray(configuration.assignedValues)) {
      return { owner: configuration, list: configuration.assignedValues };
    }
    if (Array.isArray(data.assignedValues)) return { owner: data, list: data.assignedValues };
    return null;
  }

  function setJsonBool(entry, on) {
    for (const key of JSON_CONFIG_SCALARS) {
      if (key !== "boolValue") delete entry[key];
    }
    entry.boolValue = { value: !!on };
  }

  function setJsonEnum(entry, value) {
    for (const key of JSON_CONFIG_SCALARS) {
      if (key !== "enumValue") delete entry[key];
    }
    entry.enumValue = { value: value };
  }

  function patchConfigurationJson(data) {
    const target = jsonAssignedList(data);
    if (!target) return null;
    const { byName, wildcard } = getRuleIndex();
    const present = Object.create(null);
    const scopes = Object.create(null);
    const kept = [];
    let changed = false;
    for (const entry of target.list) {
      const propertyId = entry && "object" === typeof entry ? entry.propertyId : null;
      const scope = propertyId && "string" === typeof propertyId.scope ? propertyId.scope : "";
      const name = propertyId && "string" === typeof propertyId.name ? propertyId.name : "";
      if (!name) {
        kept.push(entry);
        continue;
      }
      let removed = false;
      let touched = false;
      const named = byName.get(name) || [];
      let ni = 0;
      let wi = 0;
      while (ni < named.length || wi < wildcard.length) {
        const index = wi >= wildcard.length || (ni < named.length && named[ni] < wildcard[wi]) ? named[ni++] : wildcard[wi++];
        const rule = RULES[index];
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
        if (rule[2] === 0) {
          removed = true;
          break;
        }
        if (rule[2] === 1) {
          if (!entry.boolValue) continue;
          setJsonBool(entry, rule[3]);
          touched = true;
        } else if (rule[2] === 2) {
          setJsonBool(entry, rule[3]);
          touched = true;
        } else {
          setJsonEnum(entry, rule[4]);
          touched = true;
        }
      }
      if (removed) {
        changed = true;
        continue;
      }
      present[scope + "\u0000" + name] = true;
      scopes[scope] = true;
      if (touched) changed = true;
      kept.push(entry);
    }
    for (const rule of RULES) {
      if (rule[2] !== 2 || !rule[0] || !rule[1]) continue;
      if ((rule[5] === "ad" && !adsOn) || (rule[5] === "cap" && !playOn)) continue;
      // JSON 这条只补「响应里本来就有的 scope」，避免把 iOS 那批 scope 的开关
      // 塞进桌面端响应里（客户端不认，纯噪声）。
      if (!scopes[rule[0]]) continue;
      if (present[rule[0] + "\u0000" + rule[1]]) continue;
      kept.push({ propertyId: { scope: rule[0], name: rule[1] }, boolValue: { value: !!rule[3] } });
      changed = true;
    }
    if (!changed) return null;
    target.owner.assignedValues = kept;
    return data;
  }

  function patchConfigurationJsonText(text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    const patched = patchConfigurationJson(data);
    return patched ? JSON.stringify(patched) : null;
  }

  function patchAttributesJsonResponse(text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!data || "object" !== typeof data) return null;
    const attributes = data.attributes;
    if (!attributes || "object" !== typeof attributes) return null;
    const patched = patchAttributesJson(attributes);
    return patched ? JSON.stringify(data) : null;
  }

  function patchAttributesResponse(buffer) {
    const text = asJsonText(buffer);
    if (text) {
      const out = patchAttributesJsonResponse(text);
      return out ? WIRE_TEXT.encode(out) : null;
    }
    const fields = parse(buffer);
    if (!fields || !allCanonical(fields)) return null;
    if (!looksLikeAttributes(buffer, fields)) return null;
    const patched = patchAttributes(buffer, fields);
    if (!patched || same(patched, buffer)) return null;
    return patched;
  }

  // ------------------------------------------------- JSON 远程配置 / 属性
  //
  // 新版桌面客户端把两个接口都改成了 JSON：
  //   remote-config-resolver/v3/configuration  -> {"configuration":{"assignedValues":[…]}}
  //   nebula/v1/configuration/attributes       -> {"attributes":{…}}
  // 这里按内容嗅探分流：以 { 开头的按 JSON 处理，其余仍走 protobuf，
  // iOS 的响应格式没变，走的还是原来那条路径。

  function asJsonText(buffer) {
    if (!buffer || !buffer.length) return null;
    let i = 0;
    while (i < buffer.length) {
      const b = buffer[i];
      if (b !== 32 && b !== 9 && b !== 10 && b !== 13) break;
      i++;
    }
    if (buffer[i] !== 123) return null;
    try {
      return WIRE_UTF8.decode(buffer);
    } catch (e) {
      return null;
    }
  }

  function patchConfigurationResponse(buffer) {
    const text = asJsonText(buffer);
    if (text) {
      const data = patchConfigurationJsonText(text);
      return data ? WIRE_TEXT.encode(data) : null;
    }
    const fields = parse(buffer);
    if (!fields || !allCanonical(fields)) return null;
    let target = buffer;
    let wrapper = null;
    let targetFields = fields;
    let assigned = null;
    if (fields.length === 1 && fields[0].no === 1 && fields[0].w === 2) {
      const inner = parse(fields[0].p);
      const description = inner && describeConfiguration(inner);
      if (description && allCanonical(inner)) {
        wrapper = fields;
        target = fields[0].p;
        targetFields = inner;
        assigned = description;
      }
    }
    assigned = assigned || describeConfiguration(targetFields);
    if (!assigned) return null;
    const patched = patchConfiguration(target, targetFields, assigned);
    if (!patched || same(patched, target)) return null;
    if (wrapper) {
      wrapper[0].p = patched;
      return serialize(wrapper);
    }
    return patched;
  }

  // ---------------------------------------------------------------- response

  function patchUcs(buffer, fields = parse(buffer)) {
    if (!fields || !allCanonical(fields)) return null;
    const resolve = first(fields, 1);
    let attributes = first(fields, 3);
    let attrFields = null;
    // 字段 3 也可能是 ResolveConfiguration 的 AssignedValue，需先确认结构。
    if (attributes) {
      if (attributes.w !== 2) return null;
      if (attributes.p.length) {
        attrFields = parse(attributes.p);
        if (!looksLikeAttributes(attributes.p, attrFields)) return null;
      } else {
        attrFields = [];
      }
    }
    // 没有 resolve 也没有 attributes 时，不按 UCS 处理。
    if (!attributes) {
      const inner = resolve && resolve.w === 2 ? parse(resolve.p) : null;
      const configuration = inner ? first(inner, 1) : null;
      if (!configuration || configuration.w !== 2) return null;
      attributes = fieldBytes(3, new Uint8Array(0));
      attrFields = [];
      fields.push(attributes);
    }
    if (resolve && resolve.w === 2) {
      const edited = edit(resolve.p, [1], patchConfiguration);
      if (edited) resolve.p = edited;
    }
    if (attributes.w === 2) {
      const edited = patchAttributes(attributes.p, attrFields);
      if (edited) attributes.p = edited;
    }
    return serialize(fields);
  }

  const patchCustomize = (b, fields = parse(b)) => edit(b, [1], patchUcs, fields);
  const patchBootstrap = (b, fields = parse(b)) => edit(b, [2, 1, 1, 1], patchUcs, fields);

  // 桌面端的 BootstrapMessage / UcsResponseWrapper 外层可能和 iOS 不一样。
  // 这里先确认目标确实像 UcsResponse（有 AccountAttributesResponse 的 map entry），
  // 再调用 patchUcs，避免把 ResolveResponse 之类结构误当成 UCS 写坏。
  function looksLikeUcs(buffer, fields = parse(buffer)) {
    if (!fields) return false;
    const attributes = first(fields, 3);
    if (!attributes || attributes.w !== 2) return false;
    const entries = parse(attributes.p);
    if (!entries) return false;
    for (const f of entries) {
      if (f.no !== 1 || f.w !== 2) continue;
      const entry = parse(f.p);
      if (!entry) continue;
      const key = text(first(entry, 1));
      const value = first(entry, 2);
      if (!key || key.length > 64 || !value || value.w !== 2) continue;
      // AccountAttribute 的 value 是 { 2: bool | 3: long | 4: string }。
      // ResolveConfiguration 的 AssignedValue 也是「1: identifier, 2: ...」结构，
      // 但 identifier 的字段 2 是 name 字符串，不是 value message，必须排除。
      const valueFields = parse(value.p);
      if (!valueFields) continue;
      // 空 message 也是合法的 AccountAttribute（bool = false 时就是空）。
      let valid = true;
      for (const vf of valueFields) {
        if (vf.no === 2 && vf.w === 0) continue;
        if (vf.no === 3 && vf.w === 0) continue;
        if (vf.no === 4 && vf.w === 2) continue;
        valid = false;
        break;
      }
      if (valid) return true;
    }
    return false;
  }

  function editUcs(message, path, fields = parse(message)) {
    if (!path.length) return looksLikeUcs(message, fields) ? patchUcs(message, fields) : null;
    if (!fields || !allCanonical(fields)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = editUcs(f.p, path.slice(1));
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  function patchUcsIfChanged(buffer, fields = parse(buffer)) {
    const out = patchUcs(buffer, fields);
    return out && !same(out, buffer) ? out : null;
  }

  function patchNested(buffer, fields = parse(buffer)) {
    if (!fields || !allCanonical(fields)) return null;
    const walk = (fields, depth) => {
      let changed = false;
      for (const f of fields) {
        if (f.w !== 2) continue;
        const sub = parse(f.p);
        if (!sub || !allCanonical(sub)) continue;
        if (looksLikeUcs(f.p, sub)) {
          const patched = patchUcsIfChanged(f.p, sub);
          if (patched) {
            f.p = patched;
            changed = true;
            continue;
          }
        }
        if (depth < 8 && walk(sub, depth + 1)) {
          f.p = serialize(sub);
          changed = true;
        }
      }
      return changed;
    };
    return walk(fields, 0) ? serialize(fields) : null;
  }

  function patchCustomizeDesktop(buffer, topFields = parse(buffer)) {
    if (!topFields) return null;
    if (looksLikeUcs(buffer, topFields)) {
      const direct = patchUcsIfChanged(buffer, topFields);
      if (direct) return direct;
    }
    const known = editUcs(buffer, [1], topFields);
    if (known && !same(known, buffer)) return known;
    return patchNested(buffer, topFields);
  }

  function patchBootstrapDesktop(buffer, topFields = parse(buffer)) {
    if (!topFields) return null;
    if (looksLikeUcs(buffer, topFields)) {
      const direct = patchUcsIfChanged(buffer, topFields);
      if (direct) return direct;
    }
    const known = editUcs(buffer, [2, 1, 1, 1], topFields);
    if (known && !same(known, buffer)) return known;
    return patchNested(buffer, topFields);
  }

  // ------------------------------------------------------------------ 歌词

  // Track 的 has_lyrics = 18（metadata.proto）。缺省时补一条。
  function patchTrack(fields) {
    const f = first(fields, 18);
    if (f) {
      if (f.w !== 0 || f.v === 1n) return false;
      f.v = 1n;
      return true;
    }
    fields.push({ no: 18, w: 0, v: 1n });
    return true;
  }

  // map entry 就是一条 { 1: key, 2: value } 的小消息。
  function asEntry(fields) {
    if (!fields || fields.length < 2 || fields.length > 4) return null;
    const k = first(fields, 1);
    const v = first(fields, 2);
    if (!k || k.w !== 2 || !v || v.w !== 2) return null;
    const key = text(k);
    const value = text(v);
    if (key === null || value === null || key.length > 64) return null;
    return { key: key, value: value };
  }

  const encodeEntry = (key, value) => serialize([fieldString(1, key), fieldString(2, value)]);

  // EntityExtensionDataArray：field 2 = extension_kind，field 3 = EntityExtensionData[]
  // 不按 extension_kind 过滤：只要数组里有 spotify:track: 的实体就当成 Track 数组，
  // 这样客户端换用别的 extension kind 取 Track 时也能命中。
  function isTrackArray(fields) {
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const ed = parse(f.p);
      if (!ed) continue;
      const uri = text(first(ed, 2));
      if (uri && uri.indexOf("spotify:track:") === 0) return true;
    }
    return false;
  }

  function patchTrackArray(fields) {
    let changed = false;
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const ed = parse(f.p);
      if (!ed || !allCanonical(ed)) continue;
      const uri = text(first(ed, 2));
      if (!uri || uri.indexOf("spotify:track:") !== 0) continue;

      // EntityExtensionData.extension_data = 3 (Any)，Any.value = 2
      const anyField = first(ed, 3);
      if (!anyField || anyField.w !== 2) continue;
      const any = parse(anyField.p);
      if (!any || !allCanonical(any)) continue;
      const value = first(any, 2);
      if (!value || value.w !== 2) continue;

      // 只认 type_url 以 .Track 结尾的 Any，别把 Album / Artist / TrackDescriptor
      // 当成 Track 改（字段 18 在别的消息里可能是别的东西）。
      const typeUrl = text(first(any, 1));
      if (!typeUrl || !/\.Track$/.test(typeUrl)) continue;

      const track = parse(value.p);
      if (!track) continue;
      // 仅在可逐字节重建时改写，避免客户端解析出不同的值。
      if (!allCanonical(track)) continue;
      if (!patchTrack(track)) continue;
      value.p = serialize(track);
      anyField.p = serialize(any);
      f.p = serialize(ed);
      changed = true;
    }
    return changed;
  }

  const KNOWN = [
    "artist_name", "artist_uri", "album_title", "album_uri",
    "track_title", "track_uri", "duration", "image_url", "is_explicit", "track_player"
  ];

  const TRACK_URI_RE = /^spotify:track:[A-Za-z0-9]{22}$/;
  const MARK = "has_lyrics";
  // 大响应里只对可能包含曲目 URI 的子消息做解析；图片 / Credits / Canvas 等
  // 扩展数据没有这个标记，直接跳过，避免 12MB 级响应整树 parse。
  const TRACK_URI_MARKER = TE.encode("spotify:track:");
  function containsTrackUri(bytes) {
    const last = bytes.length - TRACK_URI_MARKER.length;
    for (let start = bytes.indexOf(TRACK_URI_MARKER[0]); start >= 0 && start <= last; start = bytes.indexOf(TRACK_URI_MARKER[0], start + 1)) {
      let hit = true;
      for (let i = 1; i < TRACK_URI_MARKER.length; i += 1) {
        if (bytes[start + i] !== TRACK_URI_MARKER[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  // 合并 has_lyrics 改写、曲目元数据收集与播放队列扫描到单趟遍历：
  // 此前 connect-state / context-resolve 要整树递归 3-4 遍，每条 metadata entry
  // 也要重复 parse 3 遍；单趟遍历 + 非曲目大块剪枝可大幅降低耗时和堆内存峰值。
  function walkMeta(fields, depth, canEdit, ctx) {
    let changed = false;

    // 队列扫描（仅 connect-state）：在已解析的字段上顺手识别 PlayerState
    // （track = 7，prev_tracks = 19，next_tracks = 20），不再单独整树递归。
    if (ctx.wantQueue && depth <= 8 && !ctx.queue.current) {
      const current = first(fields, 7);
      if (current && current.w === 2) {
        let hasOrder = false;
        for (const f of fields) {
          if ((f.no === 20 || f.no === 19) && f.w === 2) { hasOrder = true; break; }
        }
        if (hasOrder) {
          const head = parse(current.p);
          const id = head ? queueTrackId(head) : "";
          if (id) {
            ctx.queue.current = id;
            const ids = [];
            for (const f of fields) {
              if (f.no !== 20 || f.w !== 2) continue;
              const sub = parse(f.p);
              const nextId = sub ? queueTrackId(sub) : "";
              if (nextId && ids.indexOf(nextId) < 0) ids.push(nextId);
              if (ids.length >= QUEUE_MAX) break;
            }
            ctx.queue.next = ids;
          }
        }
      }
    }

    // 识别 ContextTrack（field 1 = spotify:track:...），对 field 3/4 的 metadata entry
    // 只 parse 一次，同时完成 metadataField 判定、元数据收集与 has_lyrics 改写。
    const f1 = first(fields, 1);
    let uri = "";
    if (f1 && f1.w === 2 && f1.p.length === 36) {
      const value = text(f1);
      if (value && TRACK_URI_RE.test(value)) uri = value;
    }

    let metadataField = 0;
    if (uri) {
      let meta3Count = 0;
      let meta3Valid = true;
      let meta3Known = false;
      let meta4Count = 0;
      let meta4Valid = true;
      let meta4Known = false;
      const entries3 = [];
      const entries4 = [];
      for (const f of fields) {
        if (f.no === 3) {
          meta3Count += 1;
          if (f.w !== 2) { meta3Valid = false; continue; }
          const sub = parse(f.p);
          const entry = asEntry(sub);
          if (!entry) { meta3Valid = false; continue; }
          if (entry.key === MARK || KNOWN.indexOf(entry.key) >= 0) meta3Known = true;
          entries3.push({ f: f, sub: sub, entry: entry });
        } else if (f.no === 4) {
          meta4Count += 1;
          if (f.w !== 2) { meta4Valid = false; continue; }
          const sub = parse(f.p);
          const entry = asEntry(sub);
          if (!entry) { meta4Valid = false; continue; }
          if (entry.key === MARK || KNOWN.indexOf(entry.key) >= 0) meta4Known = true;
          entries4.push({ f: f, sub: sub, entry: entry });
        }
      }
      if (meta4Count && meta4Valid && meta4Known) metadataField = 4;
      else if (meta3Count && meta3Valid && meta3Known) metadataField = 3;

      if (metadataField) {
        const entries = metadataField === 4 ? entries4 : entries3;
        const collectHere = ctx.wantMeta && depth <= 8;
        const meta = collectHere ? Object.create(null) : null;
        let present = false;
        for (const item of entries) {
          if (collectHere && !(item.entry.key in meta) && item.entry.value && item.entry.value.length <= 128) {
            meta[item.entry.key] = item.entry.value;
          }
          if (canEdit && item.entry.key === MARK) {
            present = true;
            if (item.entry.value !== "true") {
              // 保留 map entry 上的未知字段。
              const value = first(item.sub, 2);
              value.p = TE.encode("true");
              item.f.p = serialize(item.sub);
              changed = true;
            }
          }
        }
        if (collectHere) {
          const title = pickMeta(meta, TITLE_KEYS);
          if (title) ctx.found[uri.slice(14)] = [title, pickMeta(meta, ARTIST_KEYS), Number(meta.duration) || 0];
        }
        if (canEdit && !present) {
          fields.push({ no: metadataField, w: 2, p: encodeEntry(MARK, "true") });
          changed = true;
        }
      }
    }

    const collectLoose = ctx.wantMeta && !metadataField && depth <= 8;
    let looseUri = uri;
    const looseMeta = collectLoose ? Object.create(null) : null;

    for (const f of fields) {
      if (f.w !== 2) continue;
      // ContextTrack 的 URI / GID / metadata entry 已在上面处理完且均为叶子节点。
      if (metadataField && (f.no === 1 || f.no === 3 || f.no === metadataField)) continue;

      if (collectLoose && !looseUri && f.p.length === 36) {
        const value = text(f);
        if (value && TRACK_URI_RE.test(value)) looseUri = value;
      }

      // 非曲目扩展数据（图片 / Credits / Canvas / 设备信息等）不含 spotify:track:，
      // 长度 > 256 也不可能是曲目 metadata entry（key<=64, value<=128），直接跳过。
      if (f.p.length > 256 && !containsTrackUri(f.p)) continue;

      const sub = parse(f.p);
      if (!sub) continue;

      if (collectLoose) {
        const entry = asEntry(sub);
        if (entry) {
          if (!(entry.key in looseMeta) && entry.value && entry.value.length <= 128) looseMeta[entry.key] = entry.value;
          continue;
        }
      }

      if (canEdit && isTrackArray(sub)) {
        if (allCanonical(sub) && patchTrackArray(sub)) {
          f.p = serialize(sub);
          changed = true;
        }
        continue;
      }

      const maxDepth = canEdit ? 16 : 8;
      if (depth < maxDepth) {
        const subCanEdit = canEdit && allCanonical(sub);
        if (subCanEdit || (ctx.wantMeta && depth < 8)) {
          if (walkMeta(sub, depth + 1, subCanEdit, ctx)) {
            f.p = serialize(sub);
            changed = true;
          }
        }
      }
    }

    if (collectLoose && looseUri) {
      const title = pickMeta(looseMeta, TITLE_KEYS);
      if (title) ctx.found[looseUri.slice(14)] = [title, pickMeta(looseMeta, ARTIST_KEYS), Number(looseMeta.duration) || 0];
    }

    // 服务端 bundle 会额外注入 isContextTrack，处理只带 uri + uid 的当前曲目。
    if (canEdit && !metadataField && typeof isContextTrack === "function" && isContextTrack(fields)) {
      let has = false;
      for (const f of fields) {
        if (f.no !== 3 || f.w !== 2) continue;
        const entry = asEntry(parse(f.p));
        if (entry && entry.key === MARK) {
          has = true;
          break;
        }
      }
      if (!has) {
        fields.push({ no: 3, w: 2, p: encodeEntry(MARK, "true") });
        changed = true;
      }
    }

    return changed;
  }

  // 删除 extended-metadata 请求体里的 etag（ExtensionQuery.etag，字段 2），
  // 避免服务端返回「未变化」的空数组。
  //
  //   BatchedEntityRequest { header = 1; repeated EntityRequest = 2 }
  //   EntityRequest       { string entity_uri = 1; repeated ExtensionQuery = 2 }
  //   ExtensionQuery      { ExtensionKind extension_kind = 1; string etag = 2 }
  //
  // 客户端与服务端共用这段逻辑：客户端拿到 body 后交给 $done，服务端直接返回字节。
  function stripRequestEtagsBytes(payload) {
    if (!payload || !payload.length) return null;
    const top = parse(payload);
    if (!top || !allCanonical(top)) return null;

    let dropped = 0;
    for (const f of top) {
      if (f.no !== 2 || f.w !== 2) continue;
      const entity = parse(f.p);
      if (!entity || !allCanonical(entity)) continue;
      let touched = false;
      for (const q of entity) {
        if (q.no !== 2 || q.w !== 2) continue;
        const query = parse(q.p);
        if (!query || !allCanonical(query)) continue;
        const kept = [];
        let hit = false;
        for (const k of query) {
          if (k.no === 2 && k.w === 2) {
            hit = true;
            dropped++;
            continue;
          }
          kept.push(k);
        }
        if (hit) {
          q.p = serialize(kept);
          touched = true;
        }
      }
      if (touched) f.p = serialize(entity);
    }

    return dropped ? serialize(top) : null;
  }

  function stripRequestEtags(request, url) {
    if (url.indexOf("/extended-metadata/") < 0) {
      $done({});
      return;
    }
    let payload = request.body;
    if (payload instanceof ArrayBuffer) payload = new Uint8Array(payload);
    if (!payload || !ArrayBuffer.isView(payload) || !payload.length) {
      $done({});
      return;
    }
    const out = stripRequestEtagsBytes(payload);
    $done(out ? { body: out } : {});
  }

  // ---- 曲目元数据缓存 ---------------------------------------------------
  //
  // 客户端播放时本来就会拉 connect-state / context-resolve / metadata/4/track，
  // 里面带当前曲目的曲名、歌手与时长。这里顺手抄一份存进 $persistentStore，
  // spotify_lyrics.js 直接读，省掉再向 open.spotify.com 要一次元数据
  // （该域名在部分出口会直接回 400，白等一轮超时）。
  //
  // 存储值：{ "<track id>": [title, artist, durationMs, savedAt] }，最多 24 首。
  const TRACK_CACHE_KEY = "spotify.track.meta.v2";
  const TRACK_CACHE_MAX = 64;
  const TITLE_KEYS = ["track_title", "title", "track_name"];
  const ARTIST_KEYS = ["artist_name", "artist"];

  // 服务端 patcher 里没有 $persistentStore，读不到就直接跳过。
  const cacheStore = () =>
    typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;

  // 账号地区：bootstrap / UCS 的账号属性里通常带 country / current-country。
  // 记下来供 headers 脚本按地区选时区；只在变化时写一次。
  const REGION_KEY = "spotify.account.region";
  const REGION_ATTR_KEYS = ["country", "current-country", "preferred-country", "account-country", "billing-country"];
  function rememberRegionEntry(key, entry) {
    if (!key || REGION_ATTR_KEYS.indexOf(key.toLowerCase()) < 0) return false;
    const store = cacheStore();
    if (!store) return true;
    const value = first(entry, 2);
    const valueFields = value && value.w === 2 ? parse(value.p) : null;
    const region = valueFields ? text(first(valueFields, 4)) : null;
    if (!region || !/^[A-Za-z]{2}$/.test(region)) return false;
    const next = region.toUpperCase();
    try {
      if (store.read(REGION_KEY) === next) return true;
      store.write(next, REGION_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
    return true;
  }

  function rememberRegion(fields) {
    if (!cacheStore()) return;
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2) continue;
      const entry = parse(f.p);
      if (!entry) continue;
      const key = text(first(entry, 1));
      if (rememberRegionEntry(key, entry)) return;
    }
  }

  // Spotify /metadata/4/track/{gid} 的路径是 32 位十六进制 GID（16 字节 128-bit 整数），
  // 而 color-lyrics/v2/track/{id} 用的是同一数值的 22 位 Base62 编码。
  // 直接截取前 22 位 hex 当缓存 key 永远对不上 color-lyrics 的曲目 ID。
  const BASE62 = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
  function bigIntToBase62(value) {
    let n = value;
    let out = "";
    for (let i = 0; i < 22; i += 1) {
      out = BASE62.charAt(Number(n % 62n)) + out;
      n /= 62n;
    }
    return out;
  }
  function gidHexToBase62(hex) {
    if (typeof hex !== "string" || !/^[0-9a-fA-F]{32}$/.test(hex)) return "";
    return bigIntToBase62(BigInt("0x" + hex));
  }
  function gidBytesToBase62(bytes) {
    if (!bytes || bytes.length !== 16) return "";
    let value = 0n;
    for (let i = 0; i < 16; i += 1) value = (value << 8n) | BigInt(bytes[i]);
    return bigIntToBase62(value);
  }
  function trackIdFromUrl(target) {
    const match = /\/metadata\/4\/track\/([A-Za-z0-9]+)(?:[/?#]|$)/.exec(target);
    if (!match) return "";
    const raw = match[1];
    if (raw.length === 22) return raw;
    if (raw.length === 32) return gidHexToBase62(raw);
    return "";
  }

  function pickMeta(meta, keys) {
    for (const key of keys) if (meta[key]) return meta[key];
    return "";
  }

  // /metadata/4/track/<id> 的顶层就是 metadata.proto 的 Track：
  // gid = 1（16 字节），name = 2，artist = 4 { name = 2 }，duration = 7（毫秒）。
  function collectTrackEntity(fields, id, out) {
    const gid = first(fields, 1);
    const resolvedId = id || (gid && gid.w === 2 ? gidBytesToBase62(gid.p) : "");
    if (!resolvedId) return;
    const name = text(first(fields, 2));
    if (!name || name.length > 200 || /[\u0000-\u001f]/.test(name)) return;
    const artists = [];
    for (const f of fields) {
      if (f.no !== 4 || f.w !== 2) continue;
      const artist = parse(f.p);
      const artistName = artist && text(first(artist, 2));
      if (artistName && artistName.length <= 120) artists.push(artistName);
    }
    const duration = first(fields, 7);
    out[resolvedId] = [name, artists.join(", "), duration && duration.w === 0 ? Number(duration.v) : 0];
  }

  function rememberTracks(found) {
    const store = cacheStore();
    const ids = found ? Object.keys(found) : [];
    if (!store || !ids.length) return;
    let map = null;
    try {
      const raw = store.read(TRACK_CACHE_KEY);
      map = raw ? JSON.parse(raw) : {};
    } catch (e) {
      map = {};
    }
    if (!map || "object" != typeof map) map = {};
    let changed = false;
    const now = Date.now();
    for (const id of ids) {
      const next = found[id];
      const old = map[id];
      if (old && old[0] === next[0] && old[1] === next[1] && Number(old[2]) === next[2]) continue;
      map[id] = [next[0], next[1], next[2], now];
      changed = true;
    }
    if (!changed) return;
    const ordered = Object.keys(map).sort((a, b) => Number(map[b][3] || 0) - Number(map[a][3] || 0));
    for (const id of ordered.slice(TRACK_CACHE_MAX)) delete map[id];
    try {
      store.write(JSON.stringify(map), TRACK_CACHE_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
  }

  // ---- 播放队列（预取下一首歌词用）---------------------------------------
  //
  // connect-state 的 PlayerState 字段号：track = 7，prev_tracks = 19，
  // next_tracks = 20。不能按「当前曲目后面第一首」的遍历顺序取 —— prev_tracks
  // 也排在后面，会把手上一首当成下一首。
  //
  // 这里只记「当前曲目 + 接下来几首」，写进 spotify.queue；真正的歌词查询在
  // 歌词脚本里做（喂给它的曲目 id 来自这份队列）。connect-state 是热路径，
  // 客户端每次状态变化、以及前台轮询都会打，所以这里只做一次去重写入，
  // 不发任何请求。
  const QUEUE_KEY = "spotify.queue";
  const QUEUE_MAX = 8;
  const QUEUE_TTL_MS = 30 * 60 * 1000;

  function queueTrackId(entry) {
    for (const f of entry) {
      if (f.no !== 1 || f.w !== 2 || f.p.length !== 36) continue;
      const value = text(f);
      if (value && TRACK_URI_RE.test(value)) return value.slice(14);
    }
    return "";
  }

  function persistQueue(queue) {
    const store = cacheStore();
    if (!store || !queue || !queue.current) return;
    const next = queue.next.slice(0, QUEUE_MAX);
    try {
      const raw = store.read(QUEUE_KEY);
      const old = raw ? JSON.parse(raw) : null;
      const same = old && old.current === queue.current &&
        Array.isArray(old.next) && old.next.length === next.length &&
        old.next.every((id, i) => id === next[i]);
      // 队列没变就不重复写：connect-state 轮询很频繁，写存储本身也有成本。
      if (same && Number(old.at) && Date.now() - Number(old.at) < QUEUE_TTL_MS) return;
      store.write(JSON.stringify({ current: queue.current, next: next, at: Date.now() }), QUEUE_KEY);
    } catch (e) {
      // 存储写失败不影响响应改写。
    }
  }

  // 桌面端（CEF）拉 track 元数据时要的是 JSON：accept: application/json，
  // 响应是 { gid, name, has_lyrics, ... }。只按 protobuf 改的话 has_lyrics 永远是
  // 服务端给的原值（false），客户端就认为这首歌没有歌词、连 color-lyrics 都不请求。
  function patchMetaJson(text, target) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!data || "object" !== typeof data || Array.isArray(data)) return null;
    if (typeof data.gid !== "string" && typeof data.uri !== "string") return null;
    let changed = false;
    if (data.has_lyrics !== true) {
      data.has_lyrics = true;
      changed = true;
    }
    // 顺手把曲名 / 歌手 / 时长写进缓存，歌词脚本查源时零请求。
    const store = cacheStore();
    const id = trackIdFromUrl(target) || gidHexToBase62(data.gid);
    if (store && id && typeof data.name === "string" && data.name) {
      const artist = Array.isArray(data.artist)
        ? data.artist.map((item) => item && item.name).filter(Boolean).join(", ")
        : "";
      const found = Object.create(null);
      found[id] = [data.name, artist, Number(data.duration) || 0];
      rememberTracks(found);
    }
    return changed ? JSON.stringify(data) : null;
  }

  function patchMeta(buffer, target) {
    const json = asJsonText(buffer);
    if (json) {
      const patched = patchMetaJson(json, target);
      return patched ? WIRE_TEXT.encode(patched) : null;
    }
    const fields = parse(buffer);
    if (!fields) return null;
    const canonical = allCanonical(fields);
    if (/\/metadata\/4\/track\//.test(target)) {
      if (cacheStore()) {
        const found = Object.create(null);
        collectTrackEntity(fields, trackIdFromUrl(target), found);
        rememberTracks(found);
      }
      if (!canonical) return null;
      return patchTrack(fields) ? serialize(fields) : null;
    }
    const wantMeta = !!cacheStore() && target.indexOf("/extended-metadata/") < 0;
    if (!canonical && !wantMeta) return null;
    const wantQueue = wantMeta && target.indexOf("/connect-state/") >= 0;
    const ctx = {
      wantMeta: wantMeta,
      found: wantMeta ? Object.create(null) : null,
      wantQueue: wantQueue,
      queue: wantQueue ? { current: "", next: [] } : null,
    };
    const changed = walkMeta(fields, 0, canonical, ctx);
    if (wantMeta) rememberTracks(ctx.found);
    if (wantQueue && ctx.queue.current) persistQueue(ctx.queue);
    return changed ? serialize(fields) : null;
  }

  // 入口：bootstrap / UCS / 元数据 / 远程配置 / 账号属性。
  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || null;
  const url = (res && res.url) || req.url || "";

  // 请求阶段只做一件事：抹掉 extended-metadata 请求体里的 etag。
  if (!res) {
    if (lyricsOn) stripRequestEtags(req, url);
    else $done({});
    return;
  }

  const status = Number(res.status || res.statusCode);
  if (status >= 300) {
    $done({});
    return;
  }

  const META_URL = /\/extended-metadata\/|\/context-resolve\/|\/connect-state\/|\/metadata\/4\/track\//;
  const CONFIG_URL = /\/remote-config-resolver\//;
  const ATTR_URL = /\/nebula\//;

  const isMeta = META_URL.test(url);
  const isConfig = CONFIG_URL.test(url);
  const isAttr = ATTR_URL.test(url);

  // 桌面版允许「只去广告、不伪装 Premium」：spoof 关掉时仍然处理广告属性。
  // iOS / Egern / Shadowrocket 保持原行为：spoof 关掉就整个放行。
  // 远程配置 / 账号属性在 spoof 或 block_ads 任一打开时都要改写，否则 App
  // 重新拉一次配置就会把 bootstrap 里关掉的开关重新打开。
  let enabled;
  if (isMeta) enabled = lyricsOn;
  else if (isConfig || isAttr) enabled = spoof || adsOn;
  else enabled = desktop ? spoof || adsOn : spoof;
  if (!enabled) {
    $done({});
    return;
  }

  let body = res.body;
  if (body instanceof ArrayBuffer) body = new Uint8Array(body);
  // JSON 响应（桌面端 nebula 属性 / 远程配置）有些客户端直接把字符串交过来，
  // 这里统一转成字节，后面的 JSON / protobuf 分流都按字节处理。
  else if (typeof body === "string") body = WIRE_TEXT.encode(body);
  if (!body || !ArrayBuffer.isView(body) || !body.length) {
    $done({});
    return;
  }
  const maxBytes = isMeta
    ? /\/(?:context-resolve|connect-state)\//.test(url) ? MAX_CONTEXT_BYTES : MAX_META_BYTES
    : isConfig || isAttr ? MAX_FEED_BYTES : MAX_BOOTSTRAP_BYTES;
  if (body.length > maxBytes) {
    $done({});
    return;
  }

  let out = null;
  if (isMeta) {
    out = patchMeta(body, url);
  } else if (isConfig) {
    out = patchConfigurationResponse(body);
  } else if (isAttr) {
    out = patchAttributesResponse(body);
  } else if (desktop) {
    const topFields = parse(body);
    out =
      url.indexOf("bootstrap") >= 0
        ? patchBootstrapDesktop(body, topFields) || editUcs(body, [1], topFields)
        : patchCustomizeDesktop(body, topFields) || editUcs(body, [2, 1, 1, 1], topFields);
  } else {
    const topFields = parse(body);
    out =
      url.indexOf("bootstrap") >= 0
        ? patchBootstrap(body, topFields) || patchCustomize(body, topFields)
        : patchCustomize(body, topFields) || patchBootstrap(body, topFields);
  }

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

  const finish = () => {
    if (!out || same(out, body)) {
      $done({});
      return;
    }
    // 只换 body 时必须把原响应头带上：桌面端（CEF）对这些接口是跨域 fetch，
    // 丢掉 Access-Control-Allow-Origin 整条请求会被浏览器拦掉。has_lyrics 查询
    // 就是这么废的——元数据改写成功、客户端却以为这首歌没有歌词。
    const headers = {};
    const source = res && res.headers;
    if (source && "object" == typeof source) {
      for (const key in source) {
        const lower = String(key).toLowerCase();
        if (lower === "content-length" || lower === "content-encoding"
          || lower === "transfer-encoding") continue;
        headers[key] = source[key];
      }
    }
    let hasOrigin = false;
    for (const key in headers) {
      if (String(key).toLowerCase() === "access-control-allow-origin") hasOrigin = true;
    }
    if (!hasOrigin) {
      const origin = headerValue(req && req.headers, "origin");
      headers["Access-Control-Allow-Origin"] = origin || "*";
      if (origin) {
        headers["Access-Control-Allow-Credentials"] = "true";
        headers["Vary"] = "Origin";
      }
    }
    headers["Content-Length"] = String(out.length);
    $done({ status: status || 200, headers: headers, body: out });
  };

  finish();

})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
