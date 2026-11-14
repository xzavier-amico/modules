//=======================================================================================
// Emby Unlock — mb3admin 授权校验 mock
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

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
