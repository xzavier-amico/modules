// 共享 GZIP 解压（Loon $utils.ungzip / Egern ctx.compress / DecompressionStream / 纯 JS 兜底）

function gunzipJs(raw) {
  const src =
    raw instanceof Uint8Array
      ? raw
      : ArrayBuffer.isView(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : null;
  if (!src || src.length < 18 || src[0] !== 0x1f || src[1] !== 0x8b || src[2] !== 8) {
    throw new Error("not gzip");
  }
  const flg = src[3];
  if (flg & 0xe0) throw new Error("bad gzip flags");
  const end = src.length - 8;
  let p = 10;
  if (flg & 4) {
    if (p + 2 > end) throw new Error("truncated gzip fextra");
    p += 2 + (src[p] | (src[p + 1] << 8));
  }
  if (flg & 8) {
    while (p < end && src[p] !== 0) p++;
    if (p >= end) throw new Error("truncated gzip fname");
    p++;
  }
  if (flg & 16) {
    while (p < end && src[p] !== 0) p++;
    if (p >= end) throw new Error("truncated gzip fcomment");
    p++;
  }
  if (flg & 2) p += 2;
  if (p > end) throw new Error("truncated gzip header");

  const MAX_OUT = 16777216;
  let bitBuf = 0;
  let bitLen = 0;
  function readBits(n) {
    while (bitLen < n) {
      if (p >= end) throw new Error("unexpected end of deflate stream");
      bitBuf |= src[p++] << bitLen;
      bitLen += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitLen -= n;
    return val;
  }

  function buildTree(lengths) {
    const counts = new Uint16Array(16);
    let maxBits = 0;
    for (let i = 0; i < lengths.length; i++) {
      const len = lengths[i];
      if (len) {
        counts[len]++;
        if (len > maxBits) maxBits = len;
      }
    }
    if (!maxBits) return { counts, syms: new Uint16Array(0), maxBits: 0 };
    const offs = new Uint16Array(16);
    let left = 1;
    for (let b = 1; b <= 15; b++) {
      left <<= 1;
      left -= counts[b];
      if (left < 0) throw new Error("oversubscribed huffman tree");
      if (b < 15) offs[b + 1] = offs[b] + counts[b];
    }
    const syms = new Uint16Array(lengths.length);
    for (let sym = 0; sym < lengths.length; sym++) {
      const len = lengths[sym];
      if (len) syms[offs[len]++] = sym;
    }
    return { counts, syms, maxBits };
  }

  function decodeSym(tree) {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= tree.maxBits; len++) {
      code |= readBits(1);
      const count = tree.counts[len];
      if (code - count < first) return tree.syms[index + (code - first)];
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error("invalid huffman symbol");
  }

  const fixedLitLens = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) fixedLitLens[i] = 8;
  for (let i = 144; i <= 255; i++) fixedLitLens[i] = 9;
  for (let i = 256; i <= 279; i++) fixedLitLens[i] = 7;
  for (let i = 280; i <= 287; i++) fixedLitLens[i] = 8;
  const fixedLit = buildTree(fixedLitLens);
  const fixedDistLens = new Uint8Array(32);
  fixedDistLens.fill(5);
  const fixedDist = buildTree(fixedDistLens);

  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
  const LEN_BASE = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
    35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
  ];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
    257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
  ];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

  let out = new Uint8Array(Math.min(Math.max(end * 3, 256), MAX_OUT));
  let outLen = 0;
  function ensureOut(add) {
    const req = outLen + add;
    if (req > MAX_OUT) throw new Error("gunzip output exceeds 16 MiB");
    if (req <= out.length) return;
    let nextLen = out.length * 2;
    while (nextLen < req) nextLen *= 2;
    const next = new Uint8Array(Math.min(nextLen, MAX_OUT));
    next.set(out.subarray(0, outLen));
    out = next;
  }

  let bfinal = 0;
  do {
    bfinal = readBits(1);
    const btype = readBits(2);
    if (btype === 0) {
      bitBuf = 0;
      bitLen = 0;
      if (p + 4 > end) throw new Error("truncated stored block");
      const len = src[p] | (src[p + 1] << 8);
      const nlen = src[p + 2] | (src[p + 3] << 8);
      p += 4;
      if ((len ^ nlen) !== 0xffff || p + len > end) throw new Error("bad stored block");
      ensureOut(len);
      out.set(src.subarray(p, p + len), outLen);
      outLen += len;
      p += len;
      continue;
    }

    let litTree = fixedLit;
    let distTree = fixedDist;
    if (btype === 2) {
      const hlit = readBits(5) + 257;
      const hdist = readBits(5) + 1;
      const hclen = readBits(4) + 4;
      const clLens = new Uint8Array(19);
      for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
      const clTree = buildTree(clLens);
      const total = hlit + hdist;
      const allLens = new Uint8Array(total);
      let idx = 0;
      while (idx < total) {
        const sym = decodeSym(clTree);
        if (sym < 16) {
          allLens[idx++] = sym;
        } else {
          let rep = 0;
          let val = 0;
          if (sym === 16) {
            if (idx === 0) throw new Error("bad repeat length");
            val = allLens[idx - 1];
            rep = 3 + readBits(2);
          } else if (sym === 17) {
            rep = 3 + readBits(3);
          } else {
            rep = 11 + readBits(7);
          }
          if (idx + rep > total) throw new Error("huffman lengths overflow");
          while (rep-- > 0) allLens[idx++] = val;
        }
      }
      if (!allLens[256]) throw new Error("missing eob symbol");
      litTree = buildTree(allLens.subarray(0, hlit));
      distTree = buildTree(allLens.subarray(hlit));
    } else if (btype !== 1) {
      throw new Error("reserved deflate block");
    }

    for (;;) {
      const sym = decodeSym(litTree);
      if (sym < 256) {
        ensureOut(1);
        out[outLen++] = sym;
      } else if (sym === 256) {
        break;
      } else {
        const li = sym - 257;
        if (li >= LEN_BASE.length) throw new Error("invalid length symbol");
        const len = LEN_BASE[li] + (LEN_EXTRA[li] ? readBits(LEN_EXTRA[li]) : 0);
        const di = decodeSym(distTree);
        if (di >= DIST_BASE.length) throw new Error("invalid distance symbol");
        const dist = DIST_BASE[di] + (DIST_EXTRA[di] ? readBits(DIST_EXTRA[di]) : 0);
        if (dist <= 0 || dist > outLen) throw new Error("invalid back-reference distance");
        ensureOut(len);
        for (let i = 0; i < len; i++) {
          out[outLen] = out[outLen - dist];
          outLen++;
        }
      }
    }
  } while (!bfinal);

  const isize = (src[end + 4] | (src[end + 5] << 8) | (src[end + 6] << 16) | (src[end + 7] << 24)) >>> 0;
  if ((outLen >>> 0) !== isize) throw new Error("gzip isize mismatch");
  return out.subarray(0, outLen);
}

async function gunzipBytes(raw) {
  const bytes =
    raw instanceof Uint8Array
      ? raw
      : ArrayBuffer.isView(raw)
        ? new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength)
        : raw instanceof ArrayBuffer
          ? new Uint8Array(raw)
          : null;
  if (!bytes || bytes.length < 18 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
    return null;
  }
  const emptyExpected =
    (bytes[bytes.length - 4] | bytes[bytes.length - 3] | bytes[bytes.length - 2] | bytes[bytes.length - 1]) === 0;
  const coerce = (out) => {
    const u =
      out instanceof Uint8Array
        ? out
        : ArrayBuffer.isView(out)
          ? new Uint8Array(out.buffer, out.byteOffset, out.byteLength)
          : out instanceof ArrayBuffer
            ? new Uint8Array(out)
            : null;
    return u && (u.length > 0 || emptyExpected) ? u : null;
  };

  if ("undefined" != typeof $utils && $utils && "function" == typeof $utils.ungzip) {
    try {
      const u = coerce($utils.ungzip(bytes));
      if (u) return u;
    } catch {}
  }
  if ("undefined" != typeof ctx && ctx && ctx.compress && "function" == typeof ctx.compress.gunzip) {
    try {
      const u = coerce(await ctx.compress.gunzip(bytes));
      if (u) return u;
    } catch {}
  }
  if ("undefined" != typeof DecompressionStream) {
    let reader = null;
    let writer = null;
    try {
      const stream = new DecompressionStream("gzip");
      reader = stream.readable.getReader();
      writer = stream.writable.getWriter();
      const collected = (async () => {
        const chunks = [];
        let total = 0;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          total += value.length;
          if (total > 16777216) throw new Error("gunzip exceeds 16 MiB");
          chunks.push(value);
        }
        const out = new Uint8Array(total);
        let pos = 0;
        for (let i = 0; i < chunks.length; i++) {
          out.set(chunks[i], pos);
          pos += chunks[i].length;
        }
        return out;
      })();
      const written = (async () => {
        await writer.write(bytes);
        await writer.close();
      })();
      const u = coerce((await Promise.all([collected, written]))[0]);
      if (u) return u;
    } catch (e) {
      if (reader || writer) {
        try {
          await Promise.allSettled([reader && reader.cancel(e), writer && writer.abort(e)]);
        } catch {}
      }
    } finally {
      try {
        if (reader) reader.releaseLock();
      } catch {}
      try {
        if (writer) writer.releaseLock();
      } catch {}
    }
  }
  try {
    return coerce(gunzipJs(bytes));
  } catch {
    return null;
  }
}
