//=======================================================================================
// NetEase Music Clean — 网易云音乐 EAPI 解密 / 首页 / 侧栏 / 搜索 / 评论清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


//=======================================================================================
// NetEase Music Clean — 网易云音乐 EAPI AES 解密、开屏、首页、发现、左滑侧边栏与评论区清理
//
// 同时支持：
//   1) 客户端 EAPI 二进制密文响应（AES-128-ECB + PKCS7，密钥 e82ckenh8dichen8；
//      当响应解密后带 gzip 头 1f 8b / 请求头 x-aeapi=true 时自动解压；改写后重新 AES 加密返回）；
//   2) 明文 JSON 响应（网页 / 未加密子接口 / 本地单测）。
//
// 覆盖接口：
//   /batch                                       聚合接口（广告、评论提示、插入推广、子响应）
//   /homepage/block/page                         旧版首页发现流（BANNER 商业图、直播/播客模块）
//   /link/page/rcmd/resource/show                新版推荐首页（过滤广告/直播/播客/商城等模块）
//   /link/page/rcmd/block/resource/multi/refresh 新版推荐首页刷新流
//   /link/page/discovery/resource/show           新版发现页（移除顶部广告横幅与娱乐推广块）
//   /link/home/framework/tab                     底部与顶部导航框架（发现页去掉「直播」子栏等）
//   /link/position/show/resource                 我的页顶部横幅广告 (MyPageBar) 与资源位广告
//   /vipnewcenter/app/resource/newaccountpage    左滑侧栏顶部 VIP 轮播推广横幅
//   /side-bar/* / /sidebar/* / /entrance/*       左滑抽屉侧边栏（商城/云村有票/云推歌/彩铃/游戏）
//   /v2/resource/comment/floor/get & comments    评论区（推广评论、顶部横幅、挂件）
//   /search/(hot|default|suggest)                搜索热词与买榜词
//
// 保护字符串外的 16+ 位歌曲/评论 ID 整数，避免 JSON.parse 丢精度。
//=======================================================================================

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || null;
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = (res && res.url) || req.url || "";
  if (!res) {
    $done({});
    return;
  }

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0], clean_ui: raw[1] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const blockAds = flag(opt.block_ads, true);
  const cleanUi = flag(opt.clean_ui, true);
  if (!blockAds && !cleanUi) {
    $done({});
    return;
  }

  const status = Number(res.status || res.statusCode || 200);
  if (status >= 300 || res.body === undefined || res.body === null) {
    $done({});
    return;
  }

  // ---------- 纯 JS AES-128-ECB + PKCS7（用于网易云 EAPI 响应加解密） ----------
  const EAPI_KEY = new Uint8Array([
    0x65, 0x38, 0x32, 0x63, 0x6b, 0x65, 0x6e, 0x68,
    0x38, 0x64, 0x69, 0x63, 0x68, 0x65, 0x6e, 0x38,
  ]); // "e82ckenh8dichen8"

  const aesTables = (() => {
    const sbox = new Uint8Array(256);
    const invSbox = new Uint8Array(256);
    const rcon = new Uint8Array([0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36]);
    const rotl = (x, s) => ((x << s) | (x >>> (8 - s))) & 0xff;
    let p = 1;
    let q = 1;
    sbox[0] = 0x63;
    invSbox[0x63] = 0;
    do {
      p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff;
      q ^= (q << 1) & 0xff;
      q ^= (q << 2) & 0xff;
      q ^= (q << 4) & 0xff;
      q ^= q & 0x80 ? 0x09 : 0;
      q &= 0xff;
      const xformed = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63;
      sbox[p] = xformed;
      invSbox[xformed] = p;
    } while (p !== 1);

    const xtime = (x) => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
    const gmul = (a, b) => {
      let r = 0;
      let aa = a;
      let bb = b;
      for (let i = 0; i < 8; i++) {
        if (bb & 1) r ^= aa;
        aa = xtime(aa);
        bb >>>= 1;
      }
      return r;
    };

    const m2 = new Uint8Array(256);
    const m3 = new Uint8Array(256);
    const m9 = new Uint8Array(256);
    const m11 = new Uint8Array(256);
    const m13 = new Uint8Array(256);
    const m14 = new Uint8Array(256);
    for (let i = 0; i < 256; i++) {
      m2[i] = gmul(i, 2);
      m3[i] = gmul(i, 3);
      m9[i] = gmul(i, 9);
      m11[i] = gmul(i, 11);
      m13[i] = gmul(i, 13);
      m14[i] = gmul(i, 14);
    }

    // AES-128 key expansion -> 176 bytes (11 * 16)
    const rk = new Uint8Array(176);
    rk.set(EAPI_KEY, 0);
    let rci = 1;
    for (let i = 16; i < 176; i += 4) {
      let t0 = rk[i - 4];
      let t1 = rk[i - 3];
      let t2 = rk[i - 2];
      let t3 = rk[i - 1];
      if ((i & 15) === 0) {
        const tmp = t0;
        t0 = sbox[t1] ^ rcon[rci++];
        t1 = sbox[t2];
        t2 = sbox[t3];
        t3 = sbox[tmp];
      }
      rk[i] = rk[i - 16] ^ t0;
      rk[i + 1] = rk[i - 15] ^ t1;
      rk[i + 2] = rk[i - 14] ^ t2;
      rk[i + 3] = rk[i - 13] ^ t3;
    }

    return { sbox, invSbox, m2, m3, m9, m11, m13, m14, rk };
  })();

  const aesEncryptEcb = (plain) => {
    const { sbox, m2, m3, rk } = aesTables;
    const pad = 16 - (plain.length & 15);
    const out = new Uint8Array(plain.length + pad);
    out.set(plain, 0);
    out.fill(pad, plain.length);
    const s = new Uint8Array(16);

    for (let off = 0; off < out.length; off += 16) {
      for (let i = 0; i < 16; i++) s[i] = out[off + i] ^ rk[i];
      for (let r = 1; r <= 10; r++) {
        // SubBytes + ShiftRows
        const b0 = sbox[s[0]], b1 = sbox[s[5]], b2 = sbox[s[10]], b3 = sbox[s[15]];
        const b4 = sbox[s[4]], b5 = sbox[s[9]], b6 = sbox[s[14]], b7 = sbox[s[3]];
        const b8 = sbox[s[8]], b9 = sbox[s[13]], b10 = sbox[s[2]], b11 = sbox[s[7]];
        const b12 = sbox[s[12]], b13 = sbox[s[1]], b14 = sbox[s[6]], b15 = sbox[s[11]];
        const ro = r * 16;
        if (r < 10) {
          s[0] = m2[b0] ^ m3[b1] ^ b2 ^ b3 ^ rk[ro];
          s[1] = b0 ^ m2[b1] ^ m3[b2] ^ b3 ^ rk[ro + 1];
          s[2] = b0 ^ b1 ^ m2[b2] ^ m3[b3] ^ rk[ro + 2];
          s[3] = m3[b0] ^ b1 ^ b2 ^ m2[b3] ^ rk[ro + 3];

          s[4] = m2[b4] ^ m3[b5] ^ b6 ^ b7 ^ rk[ro + 4];
          s[5] = b4 ^ m2[b5] ^ m3[b6] ^ b7 ^ rk[ro + 5];
          s[6] = b4 ^ b5 ^ m2[b6] ^ m3[b7] ^ rk[ro + 6];
          s[7] = m3[b4] ^ b5 ^ b6 ^ m2[b7] ^ rk[ro + 7];

          s[8] = m2[b8] ^ m3[b9] ^ b10 ^ b11 ^ rk[ro + 8];
          s[9] = b8 ^ m2[b9] ^ m3[b10] ^ b11 ^ rk[ro + 9];
          s[10] = b8 ^ b9 ^ m2[b10] ^ m3[b11] ^ rk[ro + 10];
          s[11] = m3[b8] ^ b9 ^ b10 ^ m2[b11] ^ rk[ro + 11];

          s[12] = m2[b12] ^ m3[b13] ^ b14 ^ b15 ^ rk[ro + 12];
          s[13] = b12 ^ m2[b13] ^ m3[b14] ^ b15 ^ rk[ro + 13];
          s[14] = b12 ^ b13 ^ m2[b14] ^ m3[b15] ^ rk[ro + 14];
          s[15] = m3[b12] ^ b13 ^ b14 ^ m2[b15] ^ rk[ro + 15];
        } else {
          s[0] = b0 ^ rk[ro]; s[1] = b1 ^ rk[ro + 1]; s[2] = b2 ^ rk[ro + 2]; s[3] = b3 ^ rk[ro + 3];
          s[4] = b4 ^ rk[ro + 4]; s[5] = b5 ^ rk[ro + 5]; s[6] = b6 ^ rk[ro + 6]; s[7] = b7 ^ rk[ro + 7];
          s[8] = b8 ^ rk[ro + 8]; s[9] = b9 ^ rk[ro + 9]; s[10] = b10 ^ rk[ro + 10]; s[11] = b11 ^ rk[ro + 11];
          s[12] = b12 ^ rk[ro + 12]; s[13] = b13 ^ rk[ro + 13]; s[14] = b14 ^ rk[ro + 14]; s[15] = b15 ^ rk[ro + 15];
        }
      }
      out.set(s, off);
    }
    return out;
  };

  const aesDecryptEcb = (cipher) => {
    if (!cipher || cipher.length < 16 || (cipher.length & 15) !== 0) return null;
    const { invSbox, m9, m11, m13, m14, rk } = aesTables;
    const out = new Uint8Array(cipher.length);
    const s = new Uint8Array(16);

    for (let off = 0; off < cipher.length; off += 16) {
      for (let i = 0; i < 16; i++) s[i] = cipher[off + i] ^ rk[160 + i];
      for (let r = 9; r >= 0; r--) {
        // InvShiftRows + InvSubBytes + AddRoundKey
        const ro = r * 16;
        const b0 = invSbox[s[0]] ^ rk[ro], b1 = invSbox[s[13]] ^ rk[ro + 1], b2 = invSbox[s[10]] ^ rk[ro + 2], b3 = invSbox[s[7]] ^ rk[ro + 3];
        const b4 = invSbox[s[4]] ^ rk[ro + 4], b5 = invSbox[s[1]] ^ rk[ro + 5], b6 = invSbox[s[14]] ^ rk[ro + 6], b7 = invSbox[s[11]] ^ rk[ro + 7];
        const b8 = invSbox[s[8]] ^ rk[ro + 8], b9 = invSbox[s[5]] ^ rk[ro + 9], b10 = invSbox[s[2]] ^ rk[ro + 10], b11 = invSbox[s[15]] ^ rk[ro + 11];
        const b12 = invSbox[s[12]] ^ rk[ro + 12], b13 = invSbox[s[9]] ^ rk[ro + 13], b14 = invSbox[s[6]] ^ rk[ro + 14], b15 = invSbox[s[3]] ^ rk[ro + 15];
        if (r > 0) {
          s[0] = m14[b0] ^ m11[b1] ^ m13[b2] ^ m9[b3];
          s[1] = m9[b0] ^ m14[b1] ^ m11[b2] ^ m13[b3];
          s[2] = m13[b0] ^ m9[b1] ^ m14[b2] ^ m11[b3];
          s[3] = m11[b0] ^ m13[b1] ^ m9[b2] ^ m14[b3];

          s[4] = m14[b4] ^ m11[b5] ^ m13[b6] ^ m9[b7];
          s[5] = m9[b4] ^ m14[b5] ^ m11[b6] ^ m13[b7];
          s[6] = m13[b4] ^ m9[b5] ^ m14[b6] ^ m11[b7];
          s[7] = m11[b4] ^ m13[b5] ^ m9[b6] ^ m14[b7];

          s[8] = m14[b8] ^ m11[b9] ^ m13[b10] ^ m9[b11];
          s[9] = m9[b8] ^ m14[b9] ^ m11[b10] ^ m13[b11];
          s[10] = m13[b8] ^ m9[b9] ^ m14[b10] ^ m11[b11];
          s[11] = m11[b8] ^ m13[b9] ^ m9[b10] ^ m14[b11];

          s[12] = m14[b12] ^ m11[b13] ^ m13[b14] ^ m9[b15];
          s[13] = m9[b12] ^ m14[b13] ^ m11[b14] ^ m13[b15];
          s[14] = m13[b12] ^ m9[b13] ^ m14[b14] ^ m11[b15];
          s[15] = m11[b12] ^ m13[b13] ^ m9[b14] ^ m14[b15];
        } else {
          s[0] = b0; s[1] = b1; s[2] = b2; s[3] = b3;
          s[4] = b4; s[5] = b5; s[6] = b6; s[7] = b7;
          s[8] = b8; s[9] = b9; s[10] = b10; s[11] = b11;
          s[12] = b12; s[13] = b13; s[14] = b14; s[15] = b15;
        }
      }
      out.set(s, off);
    }

    const pad = out[out.length - 1];
    if (pad < 1 || pad > 16) return null;
    for (let i = out.length - pad; i < out.length; i++) {
      if (out[i] !== pad) return null;
    }
    return out.subarray(0, out.length - pad);
  };

  // ---------- 纯 JS Gunzip (RFC 1952 + RFC 1951 DEFLATE) 兜底 ----------
  const gunzipJs = (buf) => {
    if (!buf || buf.length < 18 || buf[0] !== 0x1f || buf[1] !== 0x8b || buf[2] !== 8) return null;
    const flg = buf[3];
    let pos = 10;
    if (flg & 4) {
      if (pos + 2 > buf.length) return null;
      pos += 2 + (buf[pos] | (buf[pos + 1] << 8));
    }
    if (flg & 8) {
      while (pos < buf.length && buf[pos++] !== 0) {}
    }
    if (flg & 16) {
      while (pos < buf.length && buf[pos++] !== 0) {}
    }
    if (flg & 2) pos += 2;
    if (pos >= buf.length - 8) return null;

    let bitBuf = 0;
    let bitCnt = 0;
    const end = buf.length - 8;
    const readBits = (n) => {
      while (bitCnt < n) {
        if (pos >= end) throw new Error("EOF");
        bitBuf |= buf[pos++] << bitCnt;
        bitCnt += 8;
      }
      const val = bitBuf & ((1 << n) - 1);
      bitBuf >>>= n;
      bitCnt -= n;
      return val;
    };

    const buildTree = (lengths) => {
      let maxLen = 0;
      const counts = new Uint16Array(16);
      for (let i = 0; i < lengths.length; i++) {
        const l = lengths[i];
        if (l) {
          counts[l]++;
          if (l > maxLen) maxLen = l;
        }
      }
      if (!maxLen) return { maxLen: 0, table: new Int32Array(0) };
      const offsets = new Uint16Array(16);
      let code = 0;
      const nextCode = new Uint16Array(16);
      for (let b = 1; b <= maxLen; b++) {
        code = (code + counts[b - 1]) << 1;
        nextCode[b] = code;
        offsets[b] = offsets[b - 1] + counts[b - 1];
      }
      const size = 1 << maxLen;
      const table = new Int32Array(size);
      table.fill(-1);
      for (let sym = 0; sym < lengths.length; sym++) {
        const len = lengths[sym];
        if (!len) continue;
        let c = nextCode[len]++;
        let rev = 0;
        for (let j = 0; j < len; j++) {
          rev = (rev << 1) | (c & 1);
          c >>>= 1;
        }
        const entry = (sym << 5) | len;
        const step = 1 << len;
        for (let idx = rev; idx < size; idx += step) table[idx] = entry;
      }
      return { maxLen, table, mask: size - 1 };
    };

    const decodeSym = (tree) => {
      while (bitCnt < tree.maxLen && pos < end) {
        bitBuf |= buf[pos++] << bitCnt;
        bitCnt += 8;
      }
      const entry = tree.table[bitBuf & tree.mask];
      if (entry < 0) throw new Error("BAD_HUF");
      const len = entry & 31;
      if (len > bitCnt) throw new Error("EOF");
      bitBuf >>>= len;
      bitCnt -= len;
      return entry >>> 5;
    };

    const fixedLitLengths = new Uint8Array(288);
    fixedLitLengths.fill(8, 0, 144);
    fixedLitLengths.fill(9, 144, 256);
    fixedLitLengths.fill(7, 256, 280);
    fixedLitLengths.fill(8, 280, 288);
    const fixedDistLengths = new Uint8Array(32);
    fixedDistLengths.fill(5);
    let fixedLitTree = null;
    let fixedDistTree = null;

    const LEN_BASE = [
      3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
      35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
    ];
    const LEN_EXTRA = [
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
      3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
    ];
    const DIST_BASE = [
      1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
      257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
    ];
    const DIST_EXTRA = [
      0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
      7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
    ];
    const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

    let out = new Uint8Array(Math.max(buf.length * 3, 1024));
    let outLen = 0;
    const ensure = (extra) => {
      if (outLen + extra <= out.length) return;
      const nextLen = Math.max(out.length * 2, outLen + extra);
      if (nextLen > 16777216) throw new Error("GZIP_TOO_LARGE");
      const grown = new Uint8Array(nextLen);
      grown.set(out.subarray(0, outLen));
      out = grown;
    };

    try {
      let bfinal = 0;
      while (!bfinal) {
        bfinal = readBits(1);
        const btype = readBits(2);
        if (btype === 0) {
          bitBuf = 0;
          bitCnt = 0;
          if (pos + 4 > end) return null;
          const len = buf[pos] | (buf[pos + 1] << 8);
          const nlen = buf[pos + 2] | (buf[pos + 3] << 8);
          pos += 4;
          if ((len ^ 0xffff) !== nlen || pos + len > end) return null;
          ensure(len);
          out.set(buf.subarray(pos, pos + len), outLen);
          outLen += len;
          pos += len;
        } else if (btype === 1 || btype === 2) {
          let litTree;
          let distTree;
          if (btype === 1) {
            litTree = fixedLitTree || (fixedLitTree = buildTree(fixedLitLengths));
            distTree = fixedDistTree || (fixedDistTree = buildTree(fixedDistLengths));
          } else {
            const hlit = readBits(5) + 257;
            const hdist = readBits(5) + 1;
            const hclen = readBits(4) + 4;
            const clLens = new Uint8Array(19);
            for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
            const clTree = buildTree(clLens);
            const total = hlit + hdist;
            const lens = new Uint8Array(total);
            let idx = 0;
            while (idx < total) {
              const sym = decodeSym(clTree);
              if (sym < 16) {
                lens[idx++] = sym;
              } else {
                let rep = 0;
                let val = 0;
                if (sym === 16) {
                  if (!idx) return null;
                  val = lens[idx - 1];
                  rep = readBits(2) + 3;
                } else if (sym === 17) {
                  rep = readBits(3) + 3;
                } else {
                  rep = readBits(7) + 11;
                }
                if (idx + rep > total) return null;
                lens.fill(val, idx, idx + rep);
                idx += rep;
              }
            }
            litTree = buildTree(lens.subarray(0, hlit));
            distTree = buildTree(lens.subarray(hlit));
          }
          for (;;) {
            const sym = decodeSym(litTree);
            if (sym < 256) {
              ensure(1);
              out[outLen++] = sym;
            } else if (sym === 256) {
              break;
            } else {
              const li = sym - 257;
              if (li >= LEN_BASE.length) return null;
              const length = LEN_BASE[li] + (LEN_EXTRA[li] ? readBits(LEN_EXTRA[li]) : 0);
              const di = decodeSym(distTree);
              if (di >= DIST_BASE.length) return null;
              const dist = DIST_BASE[di] + (DIST_EXTRA[di] ? readBits(DIST_EXTRA[di]) : 0);
              if (dist > outLen) return null;
              ensure(length);
              let src = outLen - dist;
              for (let k = 0; k < length; k++) out[outLen++] = out[src++];
            }
          }
        } else {
          return null;
        }
      }
      return out.subarray(0, outLen);
    } catch (e) {
      return null;
    }
  };

  const toUint8 = (v) => {
    if (!v) return null;
    if (v instanceof Uint8Array) return v;
    if (v instanceof ArrayBuffer) return new Uint8Array(v);
    if (ArrayBuffer.isView(v)) return new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
    return null;
  };

  const gunzipStreamAsync = async (bytes) => {
    const stream = new DecompressionStream("gzip");
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();
    const collected = (async () => {
      const chunks = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 16777216) throw new Error("too large");
        chunks.push(value);
      }
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      return merged;
    })();
    const written = (async () => {
      await writer.write(bytes);
      await writer.close();
    })();
    return (await Promise.all([collected, written]))[0];
  };

  const decodeUtf8 = (bytes) => new TextDecoder("utf-8").decode(bytes);
  const encodeUtf8 = (str) => new TextEncoder().encode(str);

  const getHeaderCI = (headers, lowerName) => {
    if (!isObj(headers)) return "";
    if (headers[lowerName] !== undefined) return String(headers[lowerName]);
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lowerName) return String(headers[k]);
    }
    return "";
  };

  // ---------- 业务清洗逻辑 ----------
  const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
  const nonEmptyObj = (v) => isObj(v) && Object.keys(v).length > 0;
  const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

  const isBannerAd = (b) => {
    if (!isObj(b)) return false;
    if (truthy(b.isAd) || truthy(b.is_ad)) return true;
    if (b.adid || b.adId || nonEmptyObj(b.adInfo) || nonEmptyStr(b.adSource) || nonEmptyStr(b.adurlV2)) return true;
    if (b.targetType === 3000 && (b.adid || b.typeTitle === "广告" || b.typeTitle === "推广")) return true;
    if (/^(?:广告|推广|商业|赞助|活动)$/.test(String(b.typeTitle || "").trim())) return true;
    return false;
  };

  const AD_BLOCK_CODE_RE = /(?:^|_)(?:AD|ADVERT|COMMERCIAL|PROMOTION|DISCOVERY_BANNER)(?:_|$)/i;
  const UI_CLUTTER_BLOCK_RE = /(?:LIVE|VOICE|PODCAST|LOOK|KTV|MALL|GAME|YUNBEI|VIP_GUIDE|TICKET|PUSH_SONG|OPERATION_CARD)/i;

  const isAdBlock = (block) => {
    if (!isObj(block)) return false;
    const code = String(block.blockCode || block.bizCode || block.showType || "");
    if (blockAds) {
      if (AD_BLOCK_CODE_RE.test(code)) return true;
      if (truthy(block.isAd) || nonEmptyObj(block.adInfo) || block.adid) return true;
    }
    if (cleanUi && UI_CLUTTER_BLOCK_RE.test(code)) return true;
    return false;
  };

  const SIDEBAR_CLUTTER_TITLE_RE =
    /商城|有票|演出|云推歌|推歌|音乐推|热歌助推|火前留名|云贝|游戏|直播|语音房|K歌|歌房|相亲|交友|彩铃|免费听|领会员|赚云贝|做任务|福利|抽奖|借钱|贷款|白条|信用卡|王卡|免流量|优惠券|礼品卡|周边|黑胶时光机|听歌识曲推广|多多|特惠|音乐收藏家|Beat专区|今日运势/;
  const SIDEBAR_CLUTTER_CODE_RE =
    /(?:^|_|-)(?:mall|store|shop|ticket|show|yuntuige|push_song|song_push|yunbei|game|live|look|voice|ktv|ringtone|cailing|free_listen|task|welfare|loan|finance|free_flow|coupon|order|ad|banner|promo)(?:$|_|-)/i;

  const isSidebarClutterItem = (item) => {
    if (!isObj(item)) return false;
    if (blockAds && (truthy(item.isAd) || truthy(item.is_ad) || nonEmptyObj(item.adInfo) || item.adid)) {
      return true;
    }
    if (!cleanUi) return false;
    const title = String(
      item.title || item.name || item.text || item.mainTitle || item.label || item.showName || item.desc || ""
    ).trim();
    const code = String(
      item.id || item.code || item.itemType || item.bizType || item.type || item.actionType || item.key || ""
    ).trim();
    const urlStr = String(item.url || item.actionUrl || item.scheme || item.orpheus || item.targetUrl || "");

    if (title && SIDEBAR_CLUTTER_TITLE_RE.test(title)) return true;
    if (code && SIDEBAR_CLUTTER_CODE_RE.test(code)) return true;
    if (
      urlStr &&
      /(?:store\/product|music\.163\.com\/store|show\/detail|ticket|yuntuige|pushsong|yunbei|look\.163\.com|game\.163)/i.test(
        urlStr
      )
    ) {
      return true;
    }
    return false;
  };

  const cleanCommentItem = (c) => {
    if (!isObj(c)) return false;
    let mod = false;
    for (const k of ["pendantData", "userBizLevels"]) {
      if (c[k] !== undefined && c[k] !== null) {
        c[k] = null;
        mod = true;
      }
    }
    if (isObj(c.tag) && Array.isArray(c.tag.extDatas) && c.tag.extDatas.length) {
      c.tag.extDatas = [];
      mod = true;
    }
    return mod;
  };

  const processJson = (rawJson) => {
    const BIGINT_MARK = "__ne_bigint_";
    let hasBigInt = false;
    const safeBody = rawJson.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
      if (!num) return m;
      hasBigInt = true;
      return '"' + BIGINT_MARK + num + '"';
    });

    let root;
    try {
      root = JSON.parse(safeBody);
    } catch (e) {
      return null;
    }
    if (!isObj(root)) return null;

    let changed = false;
    const path = url.split("?")[0];

    const cleanSidebarArray = (holder, key) => {
      if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
      const list = holder[key];
      const kept = [];
      let modified = false;

      for (const item of list) {
        if (!isObj(item)) {
          kept.push(item);
          continue;
        }
        if (isSidebarClutterItem(item)) {
          modified = true;
          continue;
        }
        for (const subKey of ["items", "list", "children", "entrances", "entranceList", "menus", "cells", "services"]) {
          if (Array.isArray(item[subKey]) && item[subKey].length) {
            const subKept = item[subKey].filter((sub) => !isObj(sub) || !isSidebarClutterItem(sub));
            if (subKept.length !== item[subKey].length) {
              modified = true;
              item[subKey] = subKept;
            }
          }
        }
        const hasEmptySubList = ["items", "list", "children", "entrances", "entranceList", "menus", "cells", "services"].some(
          (k) => Array.isArray(item[k]) && item[k].length === 0
        );
        if (hasEmptySubList) {
          modified = true;
          continue;
        }
        kept.push(item);
      }

      if (modified) {
        holder[key] = kept;
        changed = true;
      }
    };

    const cleanNode = (node) => {
      if (!isObj(node)) return;

      // 1. 纯广告字段清理
      if (blockAds) {
        for (const k of [
          "ads",
          "adInfo",
          "adList",
          "loadingAd",
          "splashAd",
          "pendantData",
          "topAd",
          "floatAd",
          "vipPro",
          "redPacket",
        ]) {
          if (Array.isArray(node[k]) && node[k].length) {
            node[k] = [];
            changed = true;
          } else if (nonEmptyObj(node[k])) {
            node[k] = {};
            changed = true;
          }
        }
      }

      // 2. 首页 banners 数组过滤
      if (blockAds && Array.isArray(node.banners) && node.banners.length) {
        const kept = node.banners.filter((b) => !isBannerAd(b));
        if (kept.length && kept.length !== node.banners.length) {
          node.banners = kept;
          changed = true;
        }
      }

      // 3. 首页 / 发现 / 推荐 blocks 数组（兼容 blockCode & bizCode & blockCodeOrderList）
      const d = isObj(node.data) ? node.data : node;
      if (Array.isArray(d.blocks) && d.blocks.length) {
        const keptBlocks = [];
        const droppedCodes = new Set();
        let blockModified = false;
        for (const block of d.blocks) {
          if (!isObj(block)) {
            keptBlocks.push(block);
            continue;
          }
          if (isAdBlock(block)) {
            if (block.blockCode) droppedCodes.add(block.blockCode);
            if (block.bizCode) droppedCodes.add(block.bizCode);
            blockModified = true;
            continue;
          }
          if (blockAds && isObj(block.extInfo) && Array.isArray(block.extInfo.banners)) {
            const bList = block.extInfo.banners;
            const bKept = bList.filter((b) => !isBannerAd(b));
            if (bKept.length !== bList.length) {
              if (!bKept.length) {
                if (block.blockCode) droppedCodes.add(block.blockCode);
                if (block.bizCode) droppedCodes.add(block.bizCode);
                blockModified = true;
                continue;
              }
              block.extInfo.banners = bKept;
              blockModified = true;
            }
          }
          if (blockAds && Array.isArray(block.creatives) && block.creatives.length) {
            const cKept = block.creatives.filter(
              (c) => !isObj(c) || (!c.adInfo && !c.adid && !truthy(c.isAd) && c.creativeType !== "AD")
            );
            if (cKept.length !== block.creatives.length) {
              if (!cKept.length) {
                blockModified = true;
                continue;
              }
              block.creatives = cKept;
              blockModified = true;
            }
          }
          keptBlocks.push(block);
        }
        if (blockModified && keptBlocks.length) {
          d.blocks = keptBlocks;
          changed = true;
        }
        if (typeof d.blockCodeOrderList === "string" && droppedCodes.size > 0) {
          try {
            const order = JSON.parse(d.blockCodeOrderList);
            if (Array.isArray(order)) {
              const nextOrder = order.filter((code) => !droppedCodes.has(code));
              if (nextOrder.length !== order.length) {
                d.blockCodeOrderList = JSON.stringify(nextOrder);
                changed = true;
              }
            }
          } catch (e) {}
        }
      }

      // 4. 左滑抽屉侧边栏 (Sidebar / Drawer)
      for (const sHolder of [node, d, isObj(d.data) ? d.data : null]) {
        if (!isObj(sHolder)) continue;
        for (const sKey of [
          "sidebar",
          "sideBar",
          "sidebarList",
          "menus",
          "menuList",
          "sections",
          "sectionList",
          "entranceList",
          "entrances",
          "modules",
          "moduleList",
          "services",
          "cells",
          "items",
        ]) {
          cleanSidebarArray(sHolder, sKey);
        }
        if (blockAds || cleanUi) {
          for (const bannerKey of ["topBanner", "bannerInfo", "adBanner", "vipBanner", "activityBanner"]) {
            if (sHolder[bannerKey] !== undefined && sHolder[bannerKey] !== null) {
              delete sHolder[bannerKey];
              changed = true;
            }
          }
        }
      }

      // 5. 搜索热词与默认搜索词
      if (blockAds && Array.isArray(d.trendingList || d.hot)) {
        const key = Array.isArray(d.trendingList) ? "trendingList" : "hot";
        const list = d[key];
        const kept = list.filter(
          (w) => !isObj(w) || (!w.adInfo && !truthy(w.isAd) && w.alg !== "ad" && w.iconType !== 5)
        );
        if (kept.length && kept.length !== list.length) {
          d[key] = kept;
          changed = true;
        }
      }
      if (blockAds && Array.isArray(node.data) && node.data.length && /\/search\/hot/.test(url)) {
        const kept = node.data.filter(
          (w) => !isObj(w) || (!w.adInfo && !truthy(w.isAd) && w.alg !== "ad" && w.iconType !== 5)
        );
        if (kept.length && kept.length !== node.data.length) {
          node.data = kept;
          changed = true;
        }
      }

      // 6. 评论区推广条目与顶部横幅
      for (const cHolder of [node, d]) {
        if (!isObj(cHolder)) continue;
        if (blockAds) {
          for (const k of ["banner", "adInfo", "topAd", "activityInfo"]) {
            if (cHolder[k] !== undefined && cHolder[k] !== null) {
              delete cHolder[k];
              changed = true;
            }
          }
          for (const listKey of ["comments", "hotComments", "topComments"]) {
            if (Array.isArray(cHolder[listKey]) && cHolder[listKey].length) {
              const kept = cHolder[listKey].filter(
                (c) => !isObj(c) || (!truthy(c.isAd) && !c.adInfo && !c.adMark)
              );
              if (kept.length && kept.length !== cHolder[listKey].length) {
                cHolder[listKey] = kept;
                changed = true;
              }
              if (cleanUi) {
                for (const c of cHolder[listKey]) {
                  if (cleanCommentItem(c)) changed = true;
                }
              }
            }
          }
        }
      }
    };

    try {
      // A. 新版框架底栏 / 发现子栏 (/link/home/framework/tab)
      if (/\/link\/home\/framework\/tab\b/.test(path) && isObj(root.data) && Array.isArray(root.data.commonResourceList)) {
        if (cleanUi) {
          const origLen = root.data.commonResourceList.length;
          root.data.commonResourceList = root.data.commonResourceList.filter(
            (t) => !isObj(t) || !/^(?:直播|云村直播|商城|K歌)$/.test(String(t.title || "").trim())
          );
          if (root.data.commonResourceList.length !== origLen) changed = true;
          for (const tab of root.data.commonResourceList) {
            if (isObj(tab) && Array.isArray(tab.subCommonResourceList)) {
              const subKept = tab.subCommonResourceList.filter(
                (s) => !isObj(s) || !/^(?:直播|播客直播|语聊|K歌)$/.test(String(s.title || "").trim())
              );
              if (subKept.length !== tab.subCommonResourceList.length) {
                tab.subCommonResourceList = subKept;
                changed = true;
              }
            }
          }
        }
      }

      // B. 新版发现页 (/link/page/discovery/resource/show)
      if (/\/link\/page\/discovery\/resource\/show\b/.test(path) && isObj(root.data)) {
        const dropSet = new Set(["PAGE_DISCOVERY_BANNER"]);
        if (Array.isArray(root.data.blocks)) {
          const kept = root.data.blocks.filter((b) => !isObj(b) || (!dropSet.has(b.bizCode) && !isAdBlock(b)));
          if (kept.length !== root.data.blocks.length) {
            root.data.blocks = kept;
            changed = true;
          }
        }
        if (typeof root.data.blockCodeOrderList === "string") {
          try {
            const arr = JSON.parse(root.data.blockCodeOrderList);
            if (Array.isArray(arr)) {
              const next = arr.filter((c) => !dropSet.has(c) && !AD_BLOCK_CODE_RE.test(c) && !(cleanUi && UI_CLUTTER_BLOCK_RE.test(c)));
              if (next.length !== arr.length) {
                root.data.blockCodeOrderList = JSON.stringify(next);
                changed = true;
              }
            }
          } catch (e) {}
        }
      }

      // C. 新版推荐页刷新 (/link/page/rcmd/block/resource/multi/refresh)
      if (/\/link\/page\/rcmd\/block\/resource\/multi\/refresh\b/.test(path) && Array.isArray(root.data)) {
        const kept = root.data.filter((b) => !isAdBlock(b));
        if (kept.length && kept.length !== root.data.length) {
          root.data = kept;
          changed = true;
        }
      }

      // D. 我的页顶部横幅广告位 (/link/position/show/resource)
      if (/\/link\/position\/show\/resource\b/.test(path) && isObj(root.data) && isObj(root.data.crossPlatformResource)) {
        const posCode = String(root.data.crossPlatformResource.positionCode || "");
        if (blockAds && (posCode === "MyPageBar" || /ad|banner|promo|vip/i.test(posCode))) {
          root.data.crossPlatformResource = {};
          changed = true;
        }
      }

      // E. 左滑侧栏顶部 VIP 轮播推广 (/vipnewcenter/app/resource/newaccountpage)
      if (/\/vipnewcenter\/app\/resource\/newaccountpage\b/.test(path) && isObj(root.data)) {
        if (cleanUi) {
          if (isObj(root.data.subTitle) && Array.isArray(root.data.subTitle.carousels) && root.data.subTitle.carousels.length) {
            root.data.subTitle.carousels = [];
            changed = true;
          }
          if (nonEmptyObj(root.data.buttonTitle)) {
            root.data.buttonTitle = {};
            changed = true;
          }
        }
      }

      // F. 楼层评论 (/v2/resource/comment/floor/get)
      if (/\/v\d+\/resource\/comment\/floor\/get\b/.test(path) && isObj(root.data)) {
        if (cleanUi && isObj(root.data.ownerComment) && cleanCommentItem(root.data.ownerComment)) {
          changed = true;
        }
      }

      // G. 开屏/纯广告接口清空 data / ads
      if (blockAds && /\/(?:[xw]?e?api\/)?(?:ad|sp\/loading)\b/i.test(path)) {
        for (const k of ["data", "ads", "adInfo", "adList"]) {
          if (Array.isArray(root[k]) && root[k].length) {
            root[k] = [];
            changed = true;
          } else if (nonEmptyObj(root[k])) {
            root[k] = {};
            changed = true;
          }
        }
      }

      cleanNode(root);

      // H. /batch 聚合接口子路径专项清理
      if (blockAds) {
        const zeroBatchData = (subPath, replacement) => {
          if (isObj(root[subPath]) && root[subPath].data !== undefined) {
            root[subPath].data = replacement;
            changed = true;
          }
        };
        zeroBatchData("/api/comment/tips/v2/get", { count: 0, offset: 0, records: [] });
        zeroBatchData("/api/social/event/bff/ad/resources", {});
        zeroBatchData("/api/comment/feed/inserted/resources", {});
        if (isObj(root["/api/comment/feed/inserted/resources"]) && isObj(root["/api/comment/feed/inserted/resources"].trp)) {
          root["/api/comment/feed/inserted/resources"].trp.rules = [];
          changed = true;
        }
        if (isObj(root["/api/event/rcmd/topic/list"]) && isObj(root["/api/event/rcmd/topic/list"].data)) {
          if (Array.isArray(root["/api/event/rcmd/topic/list"].data.topicList) && root["/api/event/rcmd/topic/list"].data.topicList.length) {
            root["/api/event/rcmd/topic/list"].data.topicList = [];
            changed = true;
          }
        }
        if (isObj(root["/api/platform/song/bff/grading/song/order/entrance"]) && isObj(root["/api/platform/song/bff/grading/song/order/entrance"].data)) {
          if (nonEmptyObj(root["/api/platform/song/bff/grading/song/order/entrance"].data.songOrderEntrance)) {
            root["/api/platform/song/bff/grading/song/order/entrance"].data.songOrderEntrance = {};
            changed = true;
          }
        }
      }

      for (const key of Object.keys(root)) {
        if (key.indexOf("/api/") === 0 || key.indexOf("/eapi/") === 0) {
          if (blockAds && /\/(?:ad|sp\/loading)\b/i.test(key) && isObj(root[key])) {
            for (const k of ["data", "ads", "adInfo", "banners"]) {
              if (Array.isArray(root[key][k]) && root[key][k].length) {
                root[key][k] = [];
                changed = true;
              } else if (nonEmptyObj(root[key][k])) {
                root[key][k] = {};
                changed = true;
              }
            }
          }
          cleanNode(root[key]);
        }
      }
    } catch (e) {
      return null;
    }

    if (!changed) return null;

    let out = JSON.stringify(root);
    if (hasBigInt) {
      out = out.replace(new RegExp('"' + BIGINT_MARK + '(-?\\d+)"', "g"), "$1");
    }
    return out;
  };

  // ---------- 入口：兼容二进制密文 (EAPI) 与明文 JSON ----------
  const finishEncrypted = (plainBytes) => {
    if (!plainBytes || !plainBytes.length || (plainBytes[0] !== 0x7b && plainBytes[0] !== 0x5b)) {
      $done({});
      return;
    }
    const outJson = processJson(decodeUtf8(plainBytes));
    if (outJson === null) {
      $done({});
      return;
    }
    $done({ body: aesEncryptEcb(encodeUtf8(outJson)) });
  };

  const rawBody = res.body;

  // 1. 字符串体（明文 JSON）
  if (typeof rawBody === "string") {
    if (!rawBody || rawBody.length > 8388608) {
      $done({});
      return;
    }
    const first = rawBody.charCodeAt(0);
    if (first !== 0x7b && first !== 0x5b) {
      $done({});
      return;
    }
    const out = processJson(rawBody);
    $done(out === null ? {} : { body: out });
    return;
  }

  // 2. 二进制体（Uint8Array / ArrayBuffer）
  const bytes = toUint8(rawBody);
  if (!bytes || !bytes.length || bytes.length > 8388608) {
    $done({});
    return;
  }

  // 二进制模式下的明文 JSON（首字节 '{' 或 '['）
  if (bytes[0] === 0x7b || bytes[0] === 0x5b) {
    const out = processJson(decodeUtf8(bytes));
    $done(out === null ? {} : { body: encodeUtf8(out) });
    return;
  }

  // EAPI AES-128-ECB 密文
  const decrypted = aesDecryptEcb(bytes);
  if (!decrypted || !decrypted.length) {
    $done({});
    return;
  }

  const isAeapi = getHeaderCI(req.headers, "x-aeapi").toLowerCase() === "true";
  const isGzipMagic = decrypted.length >= 2 && decrypted[0] === 0x1f && decrypted[1] === 0x8b;
  if (!isGzipMagic && !(isAeapi && decrypted[0] !== 0x7b && decrypted[0] !== 0x5b)) {
    finishEncrypted(decrypted);
    return;
  }

  // 优先原生同步/异步解压（Loon $utils.ungzip -> Egern ctx.compress.gunzip -> DecompressionStream -> 纯 JS DEFLATE 兜底）
  try {
    if (typeof $utils !== "undefined" && $utils && typeof $utils.ungzip === "function") {
      const r = $utils.ungzip(decrypted);
      if (r && typeof r.then === "function") {
        r.then((u) => finishEncrypted(toUint8(u) || gunzipJs(decrypted)), () => finishEncrypted(gunzipJs(decrypted)));
        return;
      }
      const u = toUint8(r);
      if (u && u.length) {
        finishEncrypted(u);
        return;
      }
    }
  } catch (e) {}

  try {
    if (typeof ctx !== "undefined" && ctx && ctx.compress && typeof ctx.compress.gunzip === "function") {
      ctx.compress.gunzip(decrypted).then(
        (u) => finishEncrypted(toUint8(u) || gunzipJs(decrypted)),
        () => finishEncrypted(gunzipJs(decrypted))
      );
      return;
    }
  } catch (e) {}

  if (typeof DecompressionStream !== "undefined") {
    gunzipStreamAsync(decrypted).then(
      (u) => finishEncrypted(u && u.length ? u : gunzipJs(decrypted)),
      () => finishEncrypted(gunzipJs(decrypted))
    );
    return;
  }

  finishEncrypted(gunzipJs(decrypted));
})();
