  //=====================================================================================
  // §3 字节工具
  //
  // 拼接 / 比较 / varint 编码在 src/proto/wire.js，三端共用；
  // 这里保留 YouTube 专用的 base64、packed varint 与子串搜索。
  //=====================================================================================

  const concatBytes = wireConcat;
  const bytesEqual = wireEqual;
  const encodeVarint = wireEncodeVarint;

  // 解一个 varint 的数值（不带长度语义），溢出直接抛错。
  // 大多数值的长度不超过 4 字节，先走位运算快路径；超过后再用乘法累加。
  function readVarintValue(bytes) {
    let value = 0;
    let shift = 0;
    for (const byte of bytes) {
      if (shift < 28) value |= (127 & byte) << shift;
      else value += (127 & byte) * 2 ** shift;
      if (!(128 & byte)) {
        if (!Number.isSafeInteger(value)) throw new Error("Unsafe decoded integer");
        return value;
      }
      shift += 7;
      if (shift > 63) break;
    }
    throw new Error("Truncated varint");
  }

  // 解 packed repeated varint（proto3 默认把 repeated 数字字段打包成一个 bytes）。
  function decodePackedVarints(bytes) {
    const values = [];
    let offset = 0;
    while (offset < bytes.length) {
      let value = 0;
      let shift = 0;
      let byte;
      do {
        if (offset >= bytes.length) throw new Error("Truncated packed varint");
        byte = bytes[offset++];
        if (shift < 28) value |= (127 & byte) << shift;
        else value += (127 & byte) * 2 ** shift;
        shift += 7;
      } while (128 & byte);
      if (!Number.isSafeInteger(value)) throw new Error("Unsafe packed integer");
      values.push(value);
    }
    return values;
  }

  const BASE64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let base64DecodeTable;

  function decodeBase64Fallback(clean) {
    if (!base64DecodeTable) {
      base64DecodeTable = new Int16Array(128).fill(-1);
      for (let i = 0; i < BASE64_CHARS.length; i++) base64DecodeTable[BASE64_CHARS.charCodeAt(i)] = i;
    }
    const len = clean.length;
    const outLen = Math.floor((len * 3) / 4);
    const out = new Uint8Array(outLen);
    let pos = 0;
    for (let i = 0; i < len; i += 4) {
      const c0 = clean.charCodeAt(i);
      const c1 = i + 1 < len ? clean.charCodeAt(i + 1) : 65;
      const c2 = i + 2 < len ? clean.charCodeAt(i + 2) : 65;
      const c3 = i + 3 < len ? clean.charCodeAt(i + 3) : 65;
      const a = c0 < 128 ? base64DecodeTable[c0] : -1;
      const b = c1 < 128 ? base64DecodeTable[c1] : -1;
      const c = c2 < 128 ? base64DecodeTable[c2] : -1;
      const d = c3 < 128 ? base64DecodeTable[c3] : -1;
      if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Invalid base64");
      const n = (a << 18) | (b << 12) | (c << 6) | d;
      if (pos < outLen) out[pos++] = (n >> 16) & 255;
      if (pos < outLen) out[pos++] = (n >> 8) & 255;
      if (pos < outLen) out[pos++] = n & 255;
    }
    return out;
  }

  function bytesToBase64(bytes) {
    if ("function" == typeof bytes.toBase64) return bytes.toBase64();
    let out = "";
    for (let i = 0; i < bytes.length; i += 3) {
      const b0 = bytes[i];
      const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
      const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
      out += BASE64_CHARS[b0 >> 2];
      out += BASE64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
      out += i + 1 < bytes.length ? BASE64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : "=";
      out += i + 2 < bytes.length ? BASE64_CHARS[b2 & 63] : "=";
    }
    return out;
  }

  // YouTube 的 params 是 URL-safe base64，去掉填充后长度可能差一位；
  // 兼容缺少 Uint8Array.fromBase64 的旧版 JSC（iOS < 18.2 的 Loon / Egern）。
  function base64ToBytes(text) {
    const normalized = text.replace(/[-_\s=]/g, (ch) => (ch === "-" ? "+" : ch === "_" ? "/" : ""));
    const needsPad = normalized.length % 4 === 1;
    const input = needsPad ? normalized + "A" : normalized;
    const bytes = "function" == typeof Uint8Array.fromBase64 ? Uint8Array.fromBase64(input) : decodeBase64Fallback(input);
    return needsPad ? bytes.subarray(0, -1) : bytes;
  }

  // 在字节流里找一段子串：全程走原生 TypedArray.indexOf（C++/SIMD），
  // 先校验尾字节过滤掉绝大多数假命中，避免退化成纯 JS 逐字节循环。
  function containsBytes(haystack, needle = PAGEAD_MARKER) {
    const nLen = needle.length;
    if (!nLen) return true;
    const lastStart = haystack.length - nLen;
    if (lastStart < 0) return false;
    const first = needle[0];
    if (1 === nLen) return haystack.indexOf(first) >= 0;
    const lastIdx = nLen - 1;
    const last = needle[lastIdx];
    for (let start = haystack.indexOf(first); start >= 0 && start <= lastStart; start = haystack.indexOf(first, start + 1)) {
      if (haystack[start + lastIdx] !== last) continue;
      let hit = true;
      for (let i = 1; i < lastIdx; i++) {
        if (haystack[start + i] !== needle[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
    }
    return false;
  }

  function toBytes(value) {
    if (!value) return undefined;
    if (value instanceof Uint8Array) return value;
    if (typeof ArrayBuffer !== "undefined" && value instanceof ArrayBuffer) return new Uint8Array(value);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    if (typeof value === "string") {
      const out = new Uint8Array(value.length);
      for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i);
        if (code > 255) return undefined;
        out[i] = code;
      }
      return out;
    }
    return undefined;
  }
