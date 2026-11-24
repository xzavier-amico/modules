//=======================================================================================
// Spotify Enhance — 请求头 / 时区
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

  // 响应阶段脚本不读请求体，跳过 ctx.request.arrayBuffer() 避免额外缓冲与内存占用。
  const requestBody = ctx.response ? undefined : await readBody(ctx.request);
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

// Spotify 请求头 / 时区伪装。
//
// 只处理请求阶段：按账号地区改写 URL 里的 timezone（识别不到时用
// Asia/Hong_Kong），避免设备时区与账号地区不一致。
//
// 不改 Accept-Language：Spotify 的歌词语言由账号 / 客户端配置决定，
// 改请求头只会影响接口的本地化文案，改不了歌词文本本身。
//
// 账号地区由 spotify.js 从 bootstrap / UCS 的账号属性里抄到
// spotify.account.region。
(() => {
  "use strict";

  const req = typeof $request !== "undefined" && $request ? $request : null;
  if (!req || !req.url || !/[?&]timezone=/i.test(req.url)) {
    $done({});
    return;
  }

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

  const region = accountRegion();
  const timezone = REGION_TIMEZONES[region] || DEFAULT_TIMEZONE;
  const nextUrl = String(req.url).replace(/([?&]timezone=)[^&]*/i, "$1" + timezone);
  if (nextUrl === req.url) {
    $done({});
    return;
  }
  $done({ url: nextUrl });
})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
