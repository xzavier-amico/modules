//=======================================================================================
// tubi — tubi_adfree.js
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

// Tubi Ad-Free — Loon / Egern / Shadowrocket.
//
// Tubi 的广告是客户端插入（CSAI），不是把广告缝进视频流：内容清单是一份干净的
// VOD playlist，广告位来自内容元数据里的 monetization.cue_points，播放到该秒数时
// 播放器再单独向广告服务要一批广告，拿到 { ads: [...] } 后插在中间播。
//
// 所以这里分两道防线，第一道才是主路径：
//
//   1. 内容元数据 /oz/videos/<id>/content 里的 cue_points 直接清空。
//      播放器没有广告位，就不会在 50 分钟那种中途位置发广告请求，也不会走到
//      「广告服务没返回 → 播备用推广片」的兜底分支。
//
//   2. 广告接口一律回答「没有广告」：
//      rainmaker*.production-public.tubi.io/api/v2/rev/vod/... → {"ads":[],"metrics":{...}}
//      ads.adrise.tv / ads.tubi.io / ads.production-public.tubi.io → 空 VAST / 空 VMAP
//
// 为什么不直接 reject：Tubi 带反广告拦截。网页端会去拉
// https://mcdn.tubitv.com/js/ads.js 这个诱饵，播放器里还有
// MAX_AD_REQUEST_BLOCKED_CONTINUOUS_COUNT 计数，连续失败会走到
// AD_REQUEST_BLOCKED_ERROR。返回一个合法的空广告响应走的是「这次没广告」的
// 正常分支，不触发这些检测。
//
// 只清空确实是数组的字段、确实是 VAST/VMAP 的文档，其他响应原样放行。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern / Shadowrocket 传 JSON 字符串，两种都兼容。
  // 位置：block_ads, caption_lang, bilingual, translate_key, translate_provider
  // 后两个只有字幕脚本用得上，这里保留位置只是为了和插件里的参数顺序对齐。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      opt = {
        block_ads: raw[0],
        caption_lang: raw[1],
        bilingual: raw[2],
        translate_key: raw[3],
        translate_provider: raw[4],
      };
    } else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  const normalizeLang = (v) => {
    if (v === undefined || v === null) return "";
    const s = String(v).trim();
    if (!s || /^off$/i.test(s)) return "";
    if (/^zh(?:[-_]?hans)?$/i.test(s)) return "zh-Hans";
    if (/^zh[-_]?hant$/i.test(s)) return "zh-Hant";
    return "";
  };

  const blockAds = flag(opt.block_ads, true);
  const captionLang = normalizeLang(opt.caption_lang ?? opt.captionLang ?? "zh-Hans");
  const bilingual = flag(opt.bilingual, true);

  // 关广告和字幕翻译可以独立开关；两个都关时才直接放行。
  if (!blockAds && !captionLang) {
    $done({});
    return;
  }

  const status = Number(res.status || res.statusCode || 0);
  if (status >= 400) {
    $done({});
    return;
  }

  let body = res.body;
  if (body === null || body === undefined) {
    $done({});
    return;
  }
  if (typeof body !== "string") {
    if (body instanceof ArrayBuffer) body = new Uint8Array(body);
    if (!ArrayBuffer.isView(body)) {
      $done({});
      return;
    }
    try {
      body = new TextDecoder("utf-8").decode(body);
    } catch (e) {
      $done({});
      return;
    }
  }
  if (!body) {
    $done({});
    return;
  }
  // 内容元数据带 video_resources，偶尔会超过 1MB，放宽到 8MB。
  if (body.length > 8 * 1024 * 1024) {
    $done({});
    return;
  }

  const parts = url.match(/^https?:\/\/([^/?#]+)/i) || [];
  const host = (parts[1] || "").split(":")[0].toLowerCase();

  // 广告侧主机：ads.* / rainmaker* 以及 adrise.tv 自家域。
  const isAdHost =
    /(^|\.)(tubi\.io|tubitv\.com|tubi\.video|adrise\.tv)$/.test(host) &&
    (/^ads[.\-]/.test(host) || /^rainmaker/.test(host) || /(^|\.)adrise\.tv$/.test(host));

  // 这些字段是数组时，数组内容就是广告；清空即「这次没有广告」。
  const AD_KEYS = new Set([
    "ads",
    "cue_points",
    "cuePoints",
    "ad_breaks",
    "adBreaks",
    "ad_pods",
    "adPods",
    "ad_list",
    "adList",
  ]);

  const emptyVast = (s) => {
    if (/<vmap:VMAP[\s>]|<VMAP[\s>]/i.test(s)) {
      return (
        '<?xml version="1.0" encoding="UTF-8"?>' +
        '<vmap:VMAP xmlns:vmap="http://www.iab.net/videosuite/vmap" version="1.0"></vmap:VMAP>'
      );
    }
    const version = (s.match(/<VAST[^>]*\bversion\s*=\s*"([^"]+)"/i) || [])[1] || "3.0";
    return '<?xml version="1.0" encoding="UTF-8"?><VAST version="' + version + '"></VAST>';
  };

  const appendQuery = (u, key, value) => {
    const hashAt = u.indexOf("#");
    const hash = hashAt >= 0 ? u.slice(hashAt) : "";
    const main = hashAt >= 0 ? u.slice(0, hashAt) : u;
    const sep = main.indexOf("?") < 0 ? "?" : "&";
    return main + sep + encodeURIComponent(key) + "=" + encodeURIComponent(value) + hash;
  };

  // Tubi App 会把字幕文件写进全局缓存（TubiPlayerCacheInitializer.prepareSubtitle），
  // 缓存 key 就是字幕 URL。只改翻译脚本、不改 URL 的话，播放器会一直用旧的 SRT。
  // trv = 翻译版本，bl = 双语开关；两者都进 URL，既能破缓存也能区分模式。
  const TRACK_VERSION = "2";

  const stripQuery = (u, keys) => {
    const hashAt = u.indexOf("#");
    const hash = hashAt >= 0 ? u.slice(hashAt) : "";
    const main = hashAt >= 0 ? u.slice(0, hashAt) : u;
    const qAt = main.indexOf("?");
    if (qAt < 0) return main + hash;
    const kept = main
      .slice(qAt + 1)
      .split("&")
      .filter((pair) => {
        const name = pair.split("=")[0].toLowerCase();
        return pair && keys.indexOf(name) < 0;
      });
    return main.slice(0, qAt) + (kept.length ? "?" + kept.join("&") : "") + hash;
  };

  const queryValue = (u, key) => {
    const m = new RegExp("[?&]" + key + "=([^&#]*)", "i").exec(u);
    if (!m) return null;
    try {
      return decodeURIComponent(m[1]);
    } catch (e) {
      return m[1];
    }
  };

  const buildCaptionUrl = (u, lang, bilingual) => {
    let out = stripQuery(u, ["tlang", "trv", "bl"]);
    out = appendQuery(out, "tlang", lang);
    out = appendQuery(out, "trv", TRACK_VERSION);
    out = appendQuery(out, "bl", bilingual ? "1" : "0");
    return out;
  };

  // 内容元数据里的 subtitles 是整份 SRT。复制第一条字幕轨，URL 带 tlang 标记，
  // 由 tubi_caption.js 在响应阶段翻译；原英文轨保留。
  //
  // 网页端的内容接口是单个视频对象（subtitles 在根上）；App 走的是
  // /api/v2/mobile/contents，返回的是 { "<content_id>": { ...视频对象... } }，
  // 所以这里递归找所有带 subtitles 数组的对象，两种形状都能追加。
  const patchContent = (data, lang, bilingual) => {
    if (!data || typeof data !== "object") return false;
    let added = 0;

    const addToTracks = (tracks) => {
      let current = null;
      let source = null;
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const u = track && typeof track.url === "string" ? track.url : "";
        if (!u) continue;
        if (/[?&]tlang=/i.test(u)) {
          if (!current) current = track;
        } else if (!source) {
          source = track;
        }
      }

      // 元数据被 App 缓存过时，里面可能已经带着上一次追加的翻译轨：
      // 版本或模式变了就原地更新 URL，不重复追加。
      if (current) {
        const wantBl = bilingual ? "1" : "0";
        if (
          queryValue(current.url, "tlang") === lang &&
          queryValue(current.url, "trv") === TRACK_VERSION &&
          queryValue(current.url, "bl") === wantBl
        ) {
          return false;
        }
        current.url = buildCaptionUrl(current.url, lang, bilingual);
        current.lang = "Chinese";
        current.lang_alpha3 = "zho";
        current.lang_translation = "中文";
        return true;
      }

      if (!source) return false;
      // Tubi 的播放器只认语言名枚举（english / spanish / chinese…），
      // 这里必须是 "Chinese"；"Chinese (Simplified)" 会被客户端的字幕列表过滤掉。
      tracks.push(
        Object.assign({}, source, {
          url: buildCaptionUrl(source.url, lang, bilingual),
          lang: "Chinese",
          lang_alpha3: "zho",
          lang_translation: "中文",
        })
      );
      return true;
    };

    const visit = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 16) return;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) visit(node[i], depth + 1);
        return;
      }
      if (lang && Array.isArray(node.subtitles) && node.subtitles.length && addToTracks(node.subtitles)) added++;
      for (const k in node) {
        if (blockAds && AD_KEYS.has(k) && Array.isArray(node[k]) && node[k].length) {
          node[k] = [];
          added++;
          continue;
        }
        if (node[k] && typeof node[k] === "object") visit(node[k], depth + 1);
      }
    };

    visit(data, 0);
    return added > 0;
  };

  const text = body.trim();

  if (text.charAt(0) === "{") {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      data = null;
    }
    if (data && typeof data === "object") {
      const hadAds = blockAds && Array.isArray(data.ads) && data.ads.length > 0;
      const lang = captionLang && /\/(?:oz|api)\//i.test(url) ? captionLang : "";
      const changed = patchContent(data, lang, bilingual);
      if (hadAds) {
        // 播放器会无条件读 metrics.responseTime，缺了会抛错并被当成广告请求失败。
        if (!data.metrics || typeof data.metrics !== "object" || Array.isArray(data.metrics)) {
          data.metrics = { responseTime: 1 };
        } else if (typeof data.metrics.responseTime !== "number") {
          data.metrics.responseTime = 1;
        }
      }

      if (changed) {
        $done({ body: JSON.stringify(data) });
        return;
      }

      // JSON 里内嵌 VAST/VMAP 的情况：只替换那个字符串字段，别把 JSON 换成 XML。
      if (blockAds) {
        let embedded = 0;
        for (const k in data) {
          if (typeof data[k] === "string" && /<(VAST|VMAP|vmap:VMAP)[\s>]/i.test(data[k])) {
            data[k] = emptyVast(data[k]);
            embedded++;
          }
        }
        if (embedded > 0) {
          $done({ body: JSON.stringify(data) });
          return;
        }
      }
      $done({});
      return;
    }
  }

  if (blockAds && /<VAST[\s>]|<vmap:VMAP[\s>]|<VMAP[\s>]/i.test(text)) {
    if (!isAdHost) {
      $done({});
      return;
    }
    $done({ body: emptyVast(text) });
    return;
  }

  $done({});
})();
