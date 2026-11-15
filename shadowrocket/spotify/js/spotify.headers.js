//=======================================================================================
// Spotify Enhance — 请求头 / 时区
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

// Spotify 请求头 / 时区伪装。
//
// 只处理请求阶段：
//   * force_zh_hans：把 Accept-Language 改成简体中文，避免曲名、歌词与元数据
//     按账号或出口地区回繁体；
//   * spoof_timezone：按账号地区选择时区（识别不到时用 Asia/Hong_Kong），
//     避免设备时区与账号地区不一致。
//
// 账号地区由 spotify.js 从 bootstrap / UCS 的账号属性里抄到
// spotify.account.region；两个开关默认开启，在模块参数里单独关闭。
(() => {
  "use strict";

  const req = typeof $request !== "undefined" && $request ? $request : null;
  if (!req || !req.url) {
    $done({});
    return;
  }

  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：强制简体中文, 伪装时区。
      opt = { force_zh_hans: raw[0], spoof_timezone: raw[1] };
    } else if (typeof raw === "string") {
      opt = JSON.parse(raw || "{}") || {};
    } else if (raw && "object" == typeof raw) {
      opt = raw;
    }
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

  const REGION_KEY = "spotify.account.region";
  const DEFAULT_TIMEZONE = "Asia/Hong_Kong";
  // 账号地区 -> 代表时区。一个国家可能有多个时区，这里取最常用的一个；
  // 识别不到地区时退回 Asia/Hong_Kong。
  const REGION_TIMEZONES = {
    HK: "Asia/Hong_Kong", MO: "Asia/Macau", TW: "Asia/Taipei", CN: "Asia/Shanghai",
    SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh",
    ID: "Asia/Jakarta", PH: "Asia/Manila", JP: "Asia/Tokyo", KR: "Asia/Seoul",
    IN: "Asia/Kolkata", AE: "Asia/Dubai", SA: "Asia/Riyadh", IL: "Asia/Jerusalem",
    TR: "Europe/Istanbul", RU: "Europe/Moscow", AU: "Australia/Sydney", NZ: "Pacific/Auckland",
    US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City",
    BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
    GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin",
    IT: "Europe/Rome", ES: "Europe/Madrid", PT: "Europe/Lisbon", NL: "Europe/Amsterdam",
    BE: "Europe/Brussels", CH: "Europe/Zurich", AT: "Europe/Vienna", SE: "Europe/Stockholm",
    NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw",
    CZ: "Europe/Prague", ZA: "Africa/Johannesburg", EG: "Africa/Cairo",
  };

  const accountRegion = () => {
    try {
      const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
      const saved = store && String(store.read(REGION_KEY) || "").trim().toUpperCase();
      if (saved && /^[A-Z]{2}$/.test(saved)) return saved;
    } catch (e) {
      // 存储读取失败时继续看请求参数。
    }
    // 部分接口带 market=XX；from_token 只有两个字母时也不会命中这个正则。
    const market = /[?&]market=([A-Za-z]{2})(?:&|$)/.exec(String(req.url));
    return market ? market[1].toUpperCase() : "";
  };

  const forceZhHans = flag(opt.force_zh_hans, true);
  const spoofTimezone = flag(opt.spoof_timezone, true);
  let nextUrl = req.url;
  if (spoofTimezone) {
    const region = accountRegion();
    const timezone = REGION_TIMEZONES[region] || DEFAULT_TIMEZONE;
    nextUrl = String(req.url).replace(/([?&]timezone=)[^&]*/i, "$1" + timezone);
  }

  let headers = null;
  // 拿不到原始请求头时不要返回 headers：客户端会把返回的 headers 当成完整替换，
  // 只带 Accept-Language 会把 Authorization 等头丢掉。
  const source = req.headers && "object" == typeof req.headers ? req.headers : null;
  if (forceZhHans && source) {
    headers = {};
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key) && String(key).toLowerCase() !== "accept-language") {
        headers[key] = source[key];
      }
    }
    headers["Accept-Language"] = "zh-CN,zh-Hans;q=0.9,zh;q=0.8";
  }

  if (!headers && nextUrl === req.url) {
    $done({});
    return;
  }
  const out = {};
  if (nextUrl !== req.url) out.url = nextUrl;
  if (headers) out.headers = headers;
  $done(out);
})();
