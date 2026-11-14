//=======================================================================================
// Emby Unlock — mb3admin 授权校验 mock
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

// Emby Unlock — Loon / Egern.
//
// Emby 官方 iOS 客户端的播放权限分两档：免费版只能试看一分钟，解锁（App 内购
// 的 App Unlock，或服务器带 Premiere）后才能完整播放。客户端判断这件事时，
// 会拿自己的购买凭据去 Emby 的授权服务器 mb3admin.com 做校验；服务器带 Premiere
// 时也是它去校验。也就是说这条链路是普通 HTTPS，可以在代理层接管。
//
// 这里把那几个校验接口的响应改成「已注册」：
//
//   /admin/service/appstore/register        App 内购凭据登记
//   /admin/service/registration/validate    按 feature 校验授权（premiere / MBSupporter …）
//   /admin/service/registration/validateDevice
//   /admin/service/registration/getStatus   订阅状态
//
// 接口按 Emby iOS 1.9.9 的实测结果维护。2026-11 实测这几个接口仍然在线：
// validate 返回的仍是
// {"featId":"…","registered":false,"expDate":"1900-01-01","key":""} 这个结构，
// appstore/register 对无效凭据返回 402。
//
// 边界：只能解客户端这一档（Full Playback）。服务器端的 Premiere 能力
// （硬件转码、离线下载、Live TV、并发数）由服务器自己的授权决定，手机上的
// 代理碰不到。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern 传 JSON 字符串，两种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = {unlock_playback: raw[0]};
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");


  if (!flag(opt.unlock_playback, true)) {
    $done({});
    return;
  }

  const host = ((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0].toLowerCase();
  if (!/(^|\.)mb3admin\.com$/.test(host)) {
    $done({});
    return;
  }
  const lower = url.toLowerCase();

  // 请求里带的 feature 名要原样回给客户端，客户端会拿它做匹配。
  let feature = "";
  const query = url.indexOf("?") >= 0 ? url.slice(url.indexOf("?") + 1) : "";
  const sources = [query, typeof req.body === "string" ? req.body : ""];
  for (const src of sources) {
    const m = src.match(/(?:^|[&?])(?:feature|featId)=([^&]*)/i);
    if (m) {
      try {
        feature = decodeURIComponent(m[1]);
      } catch (e) {
        feature = m[1];
      }
      break;
    }
  }

  let body = null;

  if (lower.indexOf("/admin/service/appstore/register") >= 0) {
    body = JSON.stringify({ featId: feature, registered: true, expDate: "2099-01-01", key: "" });
  } else if (lower.indexOf("/admin/service/registration/validatedevice") >= 0) {
    body = JSON.stringify({ cacheExpirationDays: 365, message: "Device Valid", resultCode: "GOOD" });
  } else if (lower.indexOf("/admin/service/registration/getstatus") >= 0) {
    body = JSON.stringify({ deviceStatus: "0", planType: "Lifetime", subscriptions: {} });
  } else if (lower.indexOf("/admin/service/registration/validate") >= 0) {
    body = JSON.stringify({ featId: feature, registered: true, expDate: "2099-01-01", key: "" });
  }

  if (!body) {
    $done({});
    return;
  }

  // 真实接口对无效凭据返回 400/402，这里统一改成 200，客户端才会当成校验通过。
  $done({ status: 200, body: body });
})();
