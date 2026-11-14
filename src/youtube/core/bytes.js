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

  // YouTube 的 params 是 URL-safe base64，去掉填充后长度可能差一位。
  function base64ToBytes(text) {
    const normalized = text.replace(/[-_\s=]/g, (ch) => (ch === "-" ? "+" : ch === "_" ? "/" : ""));
    const needsPad = normalized.length % 4 === 1;
    const bytes = Uint8Array.fromBase64(needsPad ? normalized + "A" : normalized);
    return needsPad ? bytes.subarray(0, -1) : bytes;
  }

  // 在字节流里找一段子串。先顺序扫，命中太稀疏时切成两段再找，
  // 避免在超大响应上退化成 O(n*m)。
  function containsBytes(haystack, needle = PAGEAD_MARKER) {
    if (!needle.length) return true;
    const lastStart = haystack.length - needle.length;
    let probes = 0;
    let lastProbeAt = 0;
    for (let start = haystack.indexOf(needle[0]); start >= 0 && start <= lastStart; start = haystack.indexOf(needle[0], start + 1)) {
      let hit = true;
      for (let i = 1; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) {
          hit = false;
          break;
        }
      }
      if (hit) return true;
      if (8 === ++probes) {
        // 连续 8 次没中且都挤在 256 字节内，说明这段是噪声，直接往后跳。
        if (start - lastProbeAt < 256) return containsBytesSlow(haystack, needle, start + 1);
        lastProbeAt = start;
        probes = 0;
      }
    }
    return false;
  }

  function containsBytesSlow(haystack, needle, from) {
    outer: for (let start = from; start <= haystack.length - needle.length; start++) {
      for (let i = 0; i < needle.length; i++) {
        if (haystack[start + i] !== needle[i]) continue outer;
      }
      return true;
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
