//=======================================================================================
// pluto — pluto_manifest.js
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

// Pluto TV 字幕轨改名 — Loon / Egern / Shadowrocket.
//
// 主清单里的字幕轨声明长这样：
//
//   #EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="English",
//     DEFAULT=NO,FORCED=NO,URI="subtitle/subs/en/playlist.m3u8?...",LANGUAGE="en"
//
// 字幕内容由 pluto_subtitle.js 翻译成中文（默认双语）。这里不改原轨道，而是复制
// 一条 NAME="Chinese"、LANGUAGE="zh" 的字幕轨指向同一个 URI：播放器支持中文标签
// 就能在菜单里看到「Chinese」，不支持也不会影响原来那条英文轨。
// URI / GROUP-ID 保持原样，避免播放器找不到字幕播放列表。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const res = (typeof $response !== "undefined" && $response) || {};
  const url = req.url || "";

  // Loon 传位置数组，Egern / Shadowrocket 传 JSON 字符串，两种都兼容。
  // 位置：block_ads, caption_lang, bilingual, translate_key, translate_provider
  // 后三个这里用不到，保留位置只是为了和插件里的参数顺序对齐。
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
  if (!normalizeLang(opt.caption_lang ?? opt.captionLang ?? "zh-Hans")) {
    $done({});
    return;
  }

  // 只改主清单，媒体清单和字幕播放列表原样放行。
  if (!/\/master\.m3u8(?:[?#]|$)/i.test(url)) {
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
  if (!body || body.length > 1024 * 1024 || body.indexOf("#EXTM3U") < 0 || !/TYPE=SUBTITLES/i.test(body)) {
    $done({});
    return;
  }

  const newline = /\r\n/.test(body) ? "\r\n" : "\n";
  const lines = body.split(/\r?\n/);

  // 已经有中文字幕轨就不重复加。
  let hasZh = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line)) continue;
    if (
      /(?:^|,)\s*LANGUAGE="zh(?:[-_][A-Za-z0-9]+)?"/i.test(line) ||
      /(?:^|,)\s*NAME="(?:Chinese|中文)/i.test(line)
    ) {
      hasZh = true;
      break;
    }
  }

  const out = [];
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out.push(line);
    if (hasZh) continue;
    if (!/^#EXT-X-MEDIA:/i.test(line) || !/TYPE=SUBTITLES/i.test(line)) continue;
    // 只复制英文字幕轨；多语言点播里别的语种保持原样。
    if (!/(?:^|,)\s*LANGUAGE="en(?:[-_][A-Za-z0-9]+)?"/i.test(line) && !/(?:^|,)\s*NAME="English/i.test(line)) {
      continue;
    }
    let zh = line.replace(/((?:^|,)\s*NAME=")[^"]*(")/i, "$1Chinese$2");
    zh = zh.replace(/((?:^|,)\s*LANGUAGE=")[^"]*(")/i, "$1zh$2");
    zh = zh.replace(/((?:^|,)\s*DEFAULT=)[A-Z]+/i, "$1NO");
    zh = zh.replace(/((?:^|,)\s*AUTOSELECT=)[A-Z]+/i, "$1NO");
    zh = zh.replace(/((?:^|,)\s*FORCED=)[A-Z]+/i, "$1NO");
    if (zh !== line) {
      out.push(zh);
      changed = true;
    }
  }

  if (!changed) {
    $done({});
    return;
  }
  $done({ body: out.join(newline) });
})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
