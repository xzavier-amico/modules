//=======================================================================================
// tubi — tubi_caption.js
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

// Tubi 字幕翻译 — Loon / Egern / Shadowrocket.
//
// 内容元数据里的 subtitles 会被 tubi_adfree.js 复制出一条 URL 带 tlang=... 的中文轨。
// 播放器请求这条 SRT 时，本脚本把字幕文本批量送去翻译接口，保留原序号 / 时间轴后返回。
//
// 翻译接口优先级：
//   translate_provider=auto（默认）：
//     - translate_key 为空            → Edge 免费接口
//     - translate_key 以 AIza 开头    → Google Cloud Translation
//     - 其他 key                      → DeepL（:fx 结尾走 free 端点）
//   显式指定 edge / deepl / google 时按指定值。
//   KEY 接口失败会自动回退到 Edge；全部失败时原样放行，不影响播放。
//
// 默认双语：英文原句在上、中文翻译在下；bilingual=false 时中文轨只显示翻译。
// 只处理带 tlang 参数的 SRT，原始英文字幕轨不受影响。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern / Shadowrocket 传 JSON 字符串，两种都兼容。
  // 位置：block_ads, caption_lang, bilingual, translate_key, translate_provider
  // block_ads 这里用不到，保留位置只是为了和插件里的参数顺序对齐。
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

  const normalizeLang = (v) => {
    if (v === undefined || v === null) return "";
    const s = String(v).trim();
    if (!s || /^off$/i.test(s)) return "";
    if (/^zh(?:[-_]?hans)?$/i.test(s)) return "zh-Hans";
    if (/^zh[-_]?hant$/i.test(s)) return "zh-Hant";
    return "";
  };

  const captionLang = normalizeLang(opt.caption_lang ?? opt.captionLang ?? "zh-Hans");
  if (!captionLang) {
    $done({});
    return;
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");
  // 中文轨默认「英文原句 + 中文翻译」；关掉后只显示中文。
  // URL 里的 bl 是字幕缓存键的一部分（由 tubi_adfree.js 写入），有 bl 时以它为准：
  // App 可能还在用旧元数据里的 URL，按 URL 输出才能保证缓存内容与键一致。
  const blParam = (/[?&]bl=([^&#]*)/i.exec(url) || [])[1];
  const bilingual = blParam === undefined ? flag(opt.bilingual, true) : !/^(?:0|false)$/i.test(blParam);

  // 只有元数据里加了 tlang 标记的中文轨才翻译，英文原轨原样放行。
  const mark = /[?&]tlang=([^&#]*)/i.exec(url);
  if (!mark) {
    $done({});
    return;
  }
  let targetLang = captionLang;
  try {
    const fromUrl = normalizeLang(decodeURIComponent(mark[1]));
    if (fromUrl) targetLang = fromUrl;
  } catch (e) {
    // 保留参数里的语言
  }

  const host = (((url.match(/^https?:\/\/([^/?#]+)/i) || [])[1] || "").split(":")[0] || "").toLowerCase();
  if (!/(^|\.)(?:adrise\.tv|tubitv\.com|tubi\.io)$/.test(host)) {
    $done({});
    return;
  }
  if (!/\.srt(?:[?#]|$)/i.test(url)) {
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
  if (!body || body.length > 2 * 1024 * 1024 || body.indexOf("-->") < 0) {
    $done({});
    return;
  }

  // ---- SRT 解析 / 重建 ----

  const parseSrt = (text) => {
    const bom = text.charCodeAt(0) === 0xfeff ? "\ufeff" : "";
    if (bom) text = text.slice(1);
    const newline = /\r\n/.test(text) ? "\r\n" : "\n";
    const normalized = text.replace(/\r\n?/g, "\n");
    const trailing = /\n$/.test(normalized);
    const blocks = normalized.replace(/\n+$/, "").split(/\n{2,}/);
    const cues = [];

    for (let i = 0; i < blocks.length; i++) {
      const lines = blocks[i].split("\n");
      let timeIndex = -1;
      for (let j = 0; j < lines.length; j++) {
        if (/^\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->\s*/.test(lines[j])) {
          timeIndex = j;
          break;
        }
      }
      if (timeIndex < 0) continue;
      cues.push({
        prefix: lines.slice(0, timeIndex + 1),
        text: lines.slice(timeIndex + 1).join("\n"),
      });
    }

    return { bom: bom, newline: newline, trailing: trailing, cues: cues };
  };

  const srt = parseSrt(body);
  if (!srt.cues.length) {
    $done({});
    return;
  }

  const texts = [];
  for (let i = 0; i < srt.cues.length; i++) {
    if (srt.cues[i].text) {
      texts.push(srt.cues[i].text);
    }
  }
  if (!texts.length) {
    $done({});
    return;
  }

  // ---- 翻译接口 ----

  const providerArg = String(opt.translate_provider ?? opt.translateProvider ?? "auto").trim().toLowerCase();
  // Shadowrocket 的模块参数默认值不能为空，用 none 占位；这里统一当成「没有密钥」。
  const keyText = String(opt.translate_key ?? opt.translateKey ?? "").trim();
  const apiKey = /^(?:none|null|nil|-|off)$/i.test(keyText) ? "" : keyText;
  const pickProvider = () => {
    if ("edge" === providerArg) return "edge";
    if ("deepl" === providerArg || "google" === providerArg) return apiKey ? providerArg : "edge";
    if (!apiKey) return "edge";
    if (/^AIza[0-9A-Za-z_-]+$/.test(apiKey)) return "google";
    return "deepl";
  };
  let activeProvider = pickProvider();

  const target = (() => {
    if ("zh-Hant" === targetLang) return { edge: "zh-Hant", deepl: "ZH-HANT", google: "zh-TW" };
    if ("zh-Hans" === targetLang) return { edge: "zh-Hans", deepl: "ZH-HANS", google: "zh-CN" };
    return { edge: targetLang, deepl: targetLang.toUpperCase(), google: targetLang };
  })();

  const plan = {
    edge: { items: 800, chars: 28000 },
    deepl: { items: 45, chars: 100000 },
    google: { items: 100, chars: 4000 },
  }[activeProvider] || { items: 800, chars: 28000 };

  const post = (options, callback) => {
    let done = false;
    const reply = (value) => {
      if (done) return;
      done = true;
      callback(value);
    };
    try {
      $httpClient.post(options, (error, response, data) => {
        if (error || !response || Number(response.status) >= 400) {
          reply(null);
          return;
        }
        reply(data);
      });
    } catch (e) {
      reply(null);
    }
  };

  // 不同客户端可能把 JSON 响应直接给成对象，也可能给字符串，两种都接受。
  const parseJson = (data) => {
    if ("string" == typeof data) {
      try {
        return JSON.parse(data);
      } catch (e) {
        return null;
      }
    }
    return data && "object" == typeof data ? data : null;
  };

  // 微软 Edge 的免费翻译接口：一次可以传字符串数组，返回顺序一致。
  const translateEdge = (items, callback) => {
    post(
      {
        url: "https://edge.microsoft.com/translate/translatetext?from=&to=" + encodeURIComponent(target.edge) + "&isEnterpriseClient=false",
        headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0" },
        body: JSON.stringify(items),
        timeout: 15000,
      },
      (data) => {
        const arr = parseJson(data);
        if (!Array.isArray(arr) || arr.length !== items.length) {
          callback(null);
          return;
        }
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          const text = arr[i] && arr[i].translations && arr[i].translations[0] && arr[i].translations[0].text;
          if ("string" != typeof text) {
            callback(null);
            return;
          }
          out.push(text);
        }
        callback(out);
      },
    );
  };

  // DeepL：一次最多 50 条 text，:fx 结尾的 key 走 free 端点。
  const translateDeepL = (items, callback) => {
    post(
      {
        url: /:fx$/i.test(apiKey) ? "https://api-free.deepl.com/v2/translate" : "https://api.deepl.com/v2/translate",
        headers: {
          "Content-Type": "application/json",
          Authorization: "DeepL-Auth-Key " + apiKey,
        },
        body: JSON.stringify({ text: items, target_lang: target.deepl }),
        timeout: 15000,
      },
      (data) => {
        const json = parseJson(data);
        const arr = json && json.translations;
        if (!Array.isArray(arr) || arr.length !== items.length) {
          callback(null);
          return;
        }
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i] || "string" != typeof arr[i].text) {
            callback(null);
            return;
          }
          out.push(arr[i].text);
        }
        callback(out);
      },
    );
  };

  const decodeEntities = (s) =>
    String(s)
      .replace(/&amp;/gi, "&")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;|&#x0*27;/gi, "'")
      .replace(/&nbsp;/gi, " ")
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(parseInt(n, 10)))
      .replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCharCode(parseInt(n, 16)));

  // Google Cloud Translation v2：q 数组，返回 data.translations。
  const translateGoogle = (items, callback) => {
    post(
      {
        url: "https://translation.googleapis.com/language/translate/v2?key=" + encodeURIComponent(apiKey),
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: items, target: target.google, format: "text" }),
        timeout: 15000,
      },
      (data) => {
        const json = parseJson(data);
        const arr = json && json.data && json.data.translations;
        if (!Array.isArray(arr) || arr.length !== items.length) {
          callback(null);
          return;
        }
        const out = [];
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i] || "string" != typeof arr[i].translatedText) {
            callback(null);
            return;
          }
          out.push(decodeEntities(arr[i].translatedText));
        }
        callback(out);
      },
    );
  };

  const translateWith = (provider, items, callback) => {
    if ("deepl" === provider && apiKey) {
      translateDeepL(items, callback);
      return;
    }
    if ("google" === provider && apiKey) {
      translateGoogle(items, callback);
      return;
    }
    translateEdge(items, callback);
  };

  const makeBatches = (items, maxItems, maxChars) => {
    const batches = [];
    let i = 0;
    while (i < items.length) {
      const start = i;
      let chars = 0;
      while (i < items.length && i - start < maxItems) {
        const len = items[i].length;
        if (i > start && chars + len > maxChars) break;
        chars += len;
        i++;
      }
      batches.push({ start: start, items: items.slice(start, i) });
    }
    return batches;
  };

  const translateAll = (items, callback) => {
    const batches = makeBatches(items, plan.items, plan.chars);
    const results = new Array(items.length);
    if (!batches.length) {
      callback(results);
      return;
    }

    let next = 0;
    let running = 0;
    let finished = 0;
    const limit = 4;

    const finish = (batch, out) => {
      if (out) {
        for (let i = 0; i < batch.items.length; i++) results[batch.start + i] = out[i];
      }
      running--;
      finished++;
      if (finished === batches.length) {
        callback(results);
        return;
      }
      launch();
    };

    const run = (batch) => {
      translateWith(activeProvider, batch.items, (out) => {
        if (out) {
          finish(batch, out);
          return;
        }
        // KEY 接口失败时整批回退到 Edge；之后所有批次也直接用 Edge。
        if ("edge" !== activeProvider) {
          activeProvider = "edge";
          translateEdge(batch.items, (fallback) => finish(batch, fallback));
          return;
        }
        finish(batch, null);
      });
    };

    const launch = () => {
      while (running < limit && next < batches.length) {
        const batch = batches[next++];
        running++;
        run(batch);
      }
    };

    launch();
  };

  // ---- 回写 ----

  translateAll(texts, (translations) => {
    let changed = false;
    const out = [];
    let pos = 0;

    for (let i = 0; i < srt.cues.length; i++) {
      const cue = srt.cues[i];
      let text = cue.text;
      if (cue.text && "string" == typeof translations[pos] && translations[pos]) {
        const translated = translations[pos]
          .replace(/\r\n?/g, "\n")
          .replace(/^\n+|\n+$/g, "")
          .replace(/\n{2,}/g, "\n");
        if (translated) {
          changed = true;
          // 双语：英文原句在上，中文翻译在下；相同时不重复。
          text = bilingual && cue.text && translated !== cue.text ? cue.text + "\n" + translated : translated;
        }
      }
      if (cue.text) pos++;
      const lines = text ? text.split("\n") : [""];
      out.push(cue.prefix.concat(lines).join(srt.newline));
    }

    if (!changed) {
      $done({});
      return;
    }
    $done({ body: srt.bom + out.join(srt.newline + srt.newline) + (srt.trailing ? srt.newline : "") });
  });
})();
