//=======================================================================================
// Xiaohongshu Probe — 只记录接口与响应结构，不改写
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
    const codes = [];
    let out = "";
    const flush = () => {
      if (codes.length) {
        out += String.fromCharCode.apply(null, codes);
        codes.length = 0;
      }
    };
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
        codes.push(0xfffd);
        if (codes.length >= 4096) flush();
        i = start + 1;
        continue;
      }
      i += need;
      if (cp > 0xffff) {
        cp -= 0x10000;
        codes.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        codes.push(cp);
      }
      if (codes.length >= 4096) flush();
    }
    flush();
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
let shadowrocketB64Dec = null;

function shadowrocketBase64From(text) {
  if (!shadowrocketB64Dec) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    shadowrocketB64Dec = new Int16Array(128).fill(-1);
    for (let i = 0; i < chars.length; i++) shadowrocketB64Dec[chars.charCodeAt(i)] = i;
    shadowrocketB64Dec[45] = 62;
    shadowrocketB64Dec[95] = 63;
  }
  const s = String(text);
  const out = new Uint8Array(((s.length + 3) >>> 2) * 3);
  let p = 0;
  let acc = 0;
  let bits = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (code >= 128) continue;
    const v = shadowrocketB64Dec[code];
    if (v < 0) continue;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (acc >>> bits) & 0xff;
    }
  }
  return p === out.length ? out : out.subarray(0, p);
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

//=======================================================================================
// Xiaohongshu Probe — 只记录，不改写（排障专用，抓完就关）
//
// 用来确认三件在文档里查不到、只能靠真机抓包确认的事：
//
//   1. 首页瀑布流、直播推荐、底栏 tab 分别由哪个接口下发
//   2. 广告卡 / 直播卡在 JSON 里用什么字段标记（is_ads？model_type？）
//   3. 底栏 tab 那个数组叫什么名字、键在哪个层级
//
// 日志一行一条，前缀 [XHS]，三端都输出到客户端的「脚本日志」：
//
//   Q POST /api/sns/v10/homefeed          请求阶段，只记路径，不读 body
//   R /api/sns/v10/homefeed 200 48213B    响应阶段，状态码与长度
//   R keys=success,code,data              顶层字段
//   R data=array[20]                      data 是数组时的长度
//   R [0] keys=id,model_type,note_card model_type=note
//   R count model_type → note:18 live:2   同一字段的取值分布
//   R ★ bottom_tab = [{"name":"购物"...  名字像 tab / 底栏 / 直播 / 广告的字段原样带出来
//
// 每个路径最多记 3 次，翻页不会把日志刷满；存储不可用时只在单次内去重。
//=======================================================================================

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || null;
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = (res && res.url) || req.url || "";
  if (!url) {
    $done({});
    return;
  }

  const say = (line) => {
    try {
      console.log("[XHS] " + line);
    } catch (e) {}
  };

  const host = (/^https?:\/\/([^/]+)/.exec(url) || ["", ""])[1];
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";

  const store = (typeof $persistentStore !== "undefined" && $persistentStore) || null;
  const SEEN = "xhs.probe.paths";
  const seen = (() => {
    try {
      const parsed = JSON.parse((store && store.read(SEEN)) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  })();

  const key = host + path;
  const hits = (Number(seen[key]) || 0) + 1;
  if (hits <= 3) {
    try {
      seen[key] = hits;
      const keys = Object.keys(seen);
      if (keys.length > 160) for (const k of keys.slice(0, keys.length - 160)) delete seen[k];
      if (store) store.write(JSON.stringify(seen), SEEN);
    } catch (e) {}
  }
  const quiet = hits > 3;

  // ---------- 请求阶段：只记路径 ----------

  if (!res) {
    if (!quiet) say("Q " + (req.method || "GET") + " " + path);
    $done({});
    return;
  }

  // ---------- 响应阶段：记结构，不改写 ----------

  const status = Number(res.status || res.statusCode || 200);
  const body = res.body;
  const size = typeof body === "string" ? body.length : (body && body.byteLength) || 0;

  let data = null;
  try {
    data = JSON.parse(body);
  } catch (e) {
    data = null;
  }

  if (!data || typeof data !== "object") {
    if (!quiet) say("R " + path + " " + status + " " + size + "B 非 JSON：" + String(body).slice(0, 80).replace(/\s+/g, " "));
    $done({});
    return;
  }

  if (quiet) {
    $done({});
    return;
  }

  const clip = (v, max) => {
    let s;
    try {
      s = typeof v === "string" ? v : JSON.stringify(v);
    } catch (e) {
      s = String(v);
    }
    if (s === undefined) s = "undefined";
    return s.length > max ? s.slice(0, max) + "…" : s;
  };

  const shape = (v) => {
    if (Array.isArray(v)) return "array[" + v.length + "]";
    if (v === null) return "null";
    if (typeof v === "object") return "obj{" + Object.keys(v).slice(0, 12).join(",") + "}";
    return typeof v === "string" ? '"' + clip(v, 40) + '"' : String(v);
  };

  // 单张卡片：键名 + 能区分广告 / 直播的那几个字段。
  const card = (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "非对象 " + clip(item, 40);
    const parts = ["keys=" + Object.keys(item).join(",")];
    for (const f of ["model_type", "type", "sub_type", "is_ads", "ads", "id", "track_id", "live_id", "room_id"]) {
      if (item[f] === undefined) continue;
      parts.push(f + "=" + clip(item[f], 24));
    }
    for (const f of ["ads_info", "live_info", "live_card"]) {
      const v = item[f];
      if (!v || typeof v !== "object") continue;
      parts.push(f + "{" + Object.keys(v).slice(0, 10).join(",") + "}");
    }
    const note = item.note_card;
    if (note && typeof note === "object") {
      parts.push("note_card{" + Object.keys(note).slice(0, 10).join(",") + "}" + (note.type ? " type=" + clip(note.type, 20) : ""));
    }
    return parts.join(" ");
  };

  const tally = (list, field) => {
    const map = {};
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const v = item[field];
      if (v === undefined) continue;
      const k = typeof v === "object" ? "obj" : String(v);
      map[k] = (map[k] || 0) + 1;
    }
    return Object.keys(map)
      .map((k) => k + ":" + map[k])
      .join(" ");
  };

  // 名字像底栏 / tab / 直播 / 广告的字段，整段带出来，方便直接看出结构。
  const INTEREST = /(?:^|[._-])(?:tab|tabs|tabbar|nav|bottom|store|shop|live|ad|ads|menu|entry|category)/i;

  say("R " + path + " " + status + " " + size + "B");
  say("R keys=" + Object.keys(data).join(","));

  const payload = data.data !== undefined ? data.data : data;

  if (Array.isArray(payload)) {
    say("R data=array[" + payload.length + "]");
    for (let i = 0; i < Math.min(payload.length, 8); i++) say("R [" + i + "] " + card(payload[i]));
    for (const f of ["model_type", "type", "is_ads", "ads"]) {
      const line = tally(payload, f);
      if (line) say("R count " + f + " → " + line);
    }
  } else if (payload && typeof payload === "object") {
    say("R data={" + Object.keys(payload).join(",") + "}");
    for (const k of Object.keys(payload)) {
      const v = payload[k];
      say("R " + k + " = " + shape(v));
      if (Array.isArray(v)) {
        for (let i = 0; i < Math.min(v.length, 3); i++) {
          if (v[i] && typeof v[i] === "object") say("R " + k + "[" + i + "] " + card(v[i]));
        }
      }
    }
    for (const k of Object.keys(payload)) {
      if (INTEREST.test(k)) say("R ★ " + k + " = " + clip(payload[k], 800));
    }
  }

  $done({});
})();
