//=======================================================================================
// tubi — tubi_adfree.js
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


const ENV_BODY_BINARY = false;

//=====================================================================================
// Egern 原生模式适配层
//
// Egern 的脚本入口是 export default async function (ctx)，参数从 ctx.env 读；
// 而 Loon / Shadowrocket 用的仍是 Surge 兼容全局（$request / $response / $done /
// $persistentStore / $argument）。为了三端共用同一份脚本主体，这里把 ctx 适配成
// 那几个全局变量，脚本主体一行都不用改。
//
// 参数：env_schema 生成的设置项会以字符串写进 ctx.env，直接作为 $argument 交给脚本；
// 各脚本的 flag() / asBool() 已经能处理 "true" / "false" 字符串。
//=====================================================================================

export default async function (ctx) {
  const plainHeaders = (headers) => {
    const out = {};
    if (!headers) return out;
    if ("function" == typeof headers.forEach) {
      headers.forEach((value, key) => {
        out[key] = value;
      });
      return out;
    }
    for (const key of Object.keys(headers)) out[key] = headers[key];
    return out;
  };

  // ctx 的 body 是只能读一次的流，先整体读出来交给兼容代码按字符串 / 字节处理。
  // 文本脚本按字符串给 body，protobuf / 二进制脚本给字节。
  // 构建时按目标注入 ENV_BODY_BINARY。
  const binaryBody = "undefined" != typeof ENV_BODY_BINARY && ENV_BODY_BINARY;
  const readBody = async (message) => {
    if (!message || !message.body) return undefined;
    try {
      const bytes = new Uint8Array(await message.arrayBuffer());
      return binaryBody ? bytes : new TextDecoder("utf-8").decode(bytes);
    } catch (e) {
      return undefined;
    }
  };

  const requestBody = await readBody(ctx.request);
  const responseBody = await readBody(ctx.response);

  const request = ctx.request
    ? { url: ctx.request.url, method: ctx.request.method, headers: plainHeaders(ctx.request.headers), body: requestBody }
    : undefined;
  const response = ctx.response
    ? {
        url: ctx.request && ctx.request.url,
        status: ctx.response.status,
        statusCode: ctx.response.status,
        headers: plainHeaders(ctx.response.headers),
        body: responseBody,
      }
    : undefined;

  // $httpClient 的 callback 形式（error, response, data）。
  const httpOptions = (options) => ("string" == typeof options ? { url: options } : options || {});
  const httpCall = (method, options, callback) => {
    const opt = httpOptions(options);
    Promise.resolve()
      .then(() =>
        ctx.http[method](opt.url, {
          headers: opt.headers,
          body: opt.body,
          timeout: opt.timeout,
        }),
      )
      .then(async (res) => {
        const headers = plainHeaders(res.headers);
        callback(null, { status: res.status, statusCode: res.status, headers }, await res.text());
      })
      .catch((error) => callback(error || new Error("request failed"), null, null));
  };

  // 数组是 Loon 旧版的位置参数，原样透传，脚本自己按位置还原。
  const $argument = Array.isArray(ctx.env) ? ctx.env : Object.assign({}, ctx.env || {});
  const $request = request;
  const $response = response;
  const $persistentStore = {
    read: (key) => (ctx.storage ? ctx.storage.get(key) : null),
    write: (value, key) => {
      if (ctx.storage) ctx.storage.set(key, value);
      return true;
    },
  };
  const $httpClient = {
    get: (options, callback) => httpCall("get", options, callback),
    post: (options, callback) => httpCall("post", options, callback),
  };

  return await new Promise((resolve) => {
    let settled = false;

    // 把 $done 的返回值翻译成 ctx 的返回值。
    const finish = (value) => {
      if (settled) return;
      settled = true;

      // 请求阶段直接返回本地响应。
      if (value && value.response) {
        resolve(ctx.respond ? ctx.respond(value.response) : value.response);
        return;
      }

      const body = ctx.response ? responseBody : requestBody;

      // 原样放行：body 已经被读走，必须显式还回去，否则请求 / 响应体会变成空。
      if (!value || !Object.keys(value).length) {
        resolve(body === undefined ? undefined : { body });
        return;
      }

      const next = Object.assign({}, value);
      if (next.body === undefined && body !== undefined) next.body = body;
      resolve(next);
    };

    function $done(value) {
      finish(value);
    }

    try {

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
        web: raw[5],
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

  // 网页版读 tubitv.com/oz/...，App 读 api.tubitv.com/api/v2/mobile/...
  // 关闭网页版后只放行网页版内容接口；广告域名与空 VAST 仍共用同一套处理。
  const isWeb = /(^|\.)tubitv\.com$/.test(host) && /^\/oz\//i.test(url.replace(/^https?:\/\/[^/]+/i, ""));
  if (!flag(opt.web, true) && isWeb) {
    $done({});
    return;
  }

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

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
