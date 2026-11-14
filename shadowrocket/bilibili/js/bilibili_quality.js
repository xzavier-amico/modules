//=======================================================================================
// BiliBili Clean — 播放请求画质（REST + gRPC）
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

// BiliBili Clean — 画质请求改写（Loon / Egern）。
//
// 客户端请求播放地址时带 qn（清晰度编号），这里统一改成 120（4K），补上
// fourk=1 和 fnval 的 4K 位。服务端会按账号权限返回「实际能给的最高档」：
// 大会员给 4K，普通账号自动落到 1080P，不会因为要不到 4K 就报错。
//
// 两条路径都改：
//   REST  api/app.bilibili.com 的 */playurl —— 改 query 里的 qn / fourk
//   gRPC  bilibili.app.playurl.v1.PlayURL/PlayView
//         bilibili.pgc.gateway.player.v2.PlayURL/PlayView
//         bilibili.app.playerunite.v1.Player/PlayViewUnite
//         改请求体里的 qn(3) / fourk(8)；playerunite 的字段在 vod(1) 里面
//
// gRPC 请求体改之前会先确认 qn 字段的值是已知清晰度，字段号对不上就整条放行，
// 不会把播放请求改坏。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const url = req.url || "";

  // Loon 传位置数组或对象，Egern 传 JSON 字符串，三种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { auto_quality: raw[0] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  if (!flag(opt.auto_quality, true)) {
    $done({});
    return;
  }

  const QN = 120;
  const QN_VALUES = [6, 16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127];
  // fnval 的 4K 位。客户端没要 4K 时补上，大会员账号才能真正拿到 4K 档。
  const FNVAL_4K = 128;

  // ---- 字节工具 ---------------------------------------------------------

  function toBytes(b) {
    if (!b) return null;
    if (b instanceof Uint8Array) return b;
    if (typeof ArrayBuffer !== "undefined" && b instanceof ArrayBuffer) return new Uint8Array(b);
    if (typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView && ArrayBuffer.isView(b)) {
      return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    }
    if (typeof b === "string") {
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
    let n = 0;
    for (let i = 0; i < parts.length; i++) n += parts[i].length;
    const out = new Uint8Array(n);
    let o = 0;
    for (let i = 0; i < parts.length; i++) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  function encodeVarint(value) {
    const out = [];
    let v = value;
    while (v > 0x7f) {
      out.push((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(v);
    return Uint8Array.from(out);
  }

  function encodeField(no, wt, payload) {
    const tag = encodeVarint(no * 8 + wt);
    if (wt !== 2) return concat([tag, payload]);
    return concat([tag, encodeVarint(payload.length), payload]);
  }

  // ---- protobuf ---------------------------------------------------------

  function readVarint(b, p, end) {
    let v = 0;
    let mul = 1;
    while (p < end) {
      const c = b[p++];
      v += (c & 0x7f) * mul;
      if (!(c & 0x80)) return [v, p];
      mul *= 128;
      if (mul > 0x10000000000000) return null;
    }
    return null;
  }

  function parseFields(b, start, end) {
    const out = [];
    let p = start;
    while (p < end) {
      const s = p;
      const t = readVarint(b, p, end);
      if (!t) return null;
      const key = t[0];
      p = t[1];
      const no = Math.floor(key / 8);
      const wt = key & 7;
      if (no <= 0) return null;

      let ds = p;
      let de;
      if (wt === 0) {
        const r = readVarint(b, p, end);
        if (!r) return null;
        p = r[1];
        de = p;
      } else if (wt === 1) {
        if (p + 8 > end) return null;
        p += 8;
        de = p;
      } else if (wt === 2) {
        const r = readVarint(b, p, end);
        if (!r) return null;
        const len = r[0];
        const d0 = r[1];
        if (d0 + len > end) return null;
        ds = d0;
        p = d0 + len;
        de = p;
      } else if (wt === 5) {
        if (p + 4 > end) return null;
        p += 4;
        de = p;
      } else {
        return null;
      }
      out.push({ no: no, wt: wt, s: s, e: p, ds: ds, de: de });
    }
    return out;
  }

  // 对 no 字段的每个 length-delimited 载荷调用 fn；fn 返回 null 表示不改。
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
        if (next) {
          parts.push(encodeField(no, 2, next));
          changed = true;
          continue;
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    return changed ? concat(parts) : null;
  }

  // 把 qn(3) 改成 120、fourk(8) 置 1、fnval(5) 补 4K 位；qn 不像清晰度就放弃。
  function patchVod(msg) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    let qn = null;
    let fnval = null;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.wt !== 0) continue;
      const r = readVarint(msg, f.ds, f.de);
      if (!r) continue;
      if (f.no === 3) qn = r[0];
      else if (f.no === 5) fnval = r[0];
    }
    if (qn === null || QN_VALUES.indexOf(qn) < 0) return null;

    const parts = [];
    let sawFourk = false;
    let changed = qn !== QN;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 3 && f.wt === 0) {
        parts.push(encodeField(3, 0, encodeVarint(QN)));
        continue;
      }
      if (f.no === 5 && f.wt === 0 && fnval !== null && !(fnval & FNVAL_4K)) {
        parts.push(encodeField(5, 0, encodeVarint(fnval | FNVAL_4K)));
        changed = true;
        continue;
      }
      if (f.no === 8 && f.wt === 0) {
        sawFourk = true;
        const r = readVarint(msg, f.ds, f.de);
        if (r && r[0] !== 1) {
          parts.push(encodeField(8, 0, encodeVarint(1)));
          changed = true;
          continue;
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    if (!sawFourk) {
      parts.push(encodeField(8, 0, encodeVarint(1)));
      changed = true;
    }
    return changed ? concat(parts) : null;
  }

  // ---- gRPC -------------------------------------------------------------

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

  function frame(msg) {
    const out = new Uint8Array(5 + msg.length);
    out[1] = (msg.length >>> 24) & 0xff;
    out[2] = (msg.length >>> 16) & 0xff;
    out[3] = (msg.length >>> 8) & 0xff;
    out[4] = msg.length & 0xff;
    out.set(msg, 5);
    return out;
  }

  const GRPC = /\/bilibili\.(?:app\.playurl\.v1\.PlayURL|pgc\.gateway\.player\.v2\.PlayURL|app\.playerunite\.v1\.Player)\/(?:PlayView|PlayViewUnite)$/;

  function patchGrpc() {
    const headers = req.headers || {};
    const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
    if (ct.indexOf("grpc") < 0) return null;
    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") return null;

    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    if (!GRPC.test(path)) return null;
    const nested = path.indexOf("playerunite") >= 0;

    const bytes = toBytes(req.body);
    if (!bytes || !bytes.length) return null;
    const frames = parseFrames(bytes);
    if (!frames) return null;

    const out = [];
    let changed = false;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      // 压缩帧和 trailer 帧一律不动。
      if (f.flag !== 0) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      const msg = bytes.subarray(f.start, f.end);
      const next = nested ? mapSub(msg, 1, patchVod) : patchVod(msg);
      if (!next) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      changed = true;
      out.push(frame(next));
    }
    return changed ? concat(out) : null;
  }

  const grpcBody = patchGrpc();
  if (grpcBody) {
    $done({ body: grpcBody });
    return;
  }

  // gRPC 请求没改成（不是目标方法 / 已是最优 / 格式不认识）就原样放行，
  // 不能落到下面的 REST 分支去拼 query。
  const ct = String((req.headers || {})["content-type"] || (req.headers || {})["Content-Type"] || "");
  if (ct.toLowerCase().indexOf("grpc") >= 0) {
    $done({});
    return;
  }

  // ---- REST -------------------------------------------------------------

  if (!/^https?:\/\/(?:api|app)\.bilibili\.com\//i.test(url)) {
    $done({});
    return;
  }
  if (url.indexOf("/playurl") < 0) {
    $done({});
    return;
  }

  let out = url.replace(/([?&])qn=\d+/i, "$1qn=120");
  if (!/[?&]qn=/i.test(out)) {
    out += (out.indexOf("?") < 0 ? "?" : "&") + "qn=120";
  }
  if (!/[?&]fourk=/i.test(out)) {
    out += "&fourk=1";
  }
  // fnval 补 4K 位，否则服务端不会给 4K 档。
  const fn = /([?&])fnval=(\d+)/i.exec(out);
  if (fn) {
    const v = Number(fn[2]) | FNVAL_4K;
    if (String(v) !== fn[2]) out = out.replace(fn[0], fn[1] + "fnval=" + v);
  }

  if (out === url) {
    $done({});
    return;
  }
  $done({ url: out });
})();
