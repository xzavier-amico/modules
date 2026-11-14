//=======================================================================================
// Delivery Clean — 美团 / 京东 / 饿了么 JSON 清理
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

// Delivery Clean — 保守地删掉 JSON 数组里「明确标了广告」的条目。
//
// 只认三种标记，其余一律不动：
//   is_ad / isAd 为 true
//   ad_type / adType 有值，并且同时带 ad_id / adId
//   card_type / cardType 以 ad_ / ad- 开头
//
// 只删数组元素，不删对象字段；解析失败、结构对不上、没有命中，都原样放行。
// JSON 往返会截断超过 2^53 的数字，body 里出现 18 位以上连续数字时直接放弃改写。

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || {};
  const body = res.body;
  if (typeof body !== "string" || !body) {
    $done({});
    return;
  }

  // 只处理 JSON 对象/数组；HTML、gzip、protobuf 之类直接放行。
  const first = body.charCodeAt(0);
  if (first !== 123 && first !== 91) {
    $done({});
    return;
  }

  // 超过 2^53 的数字在 JSON 往返时会丢精度（16 位起），这类响应直接放行。
  if (/\d{16,}/.test(body)) {
    $done({});
    return;
  }

  let data;
  try {
    data = JSON.parse(body);
  } catch (e) {
    $done({});
    return;
  }
  if (!data || "object" != typeof data) {
    $done({});
    return;
  }

  const isObj = (v) => v && "object" == typeof v && !Array.isArray(v);
  const truthy = (v) => v === true || v === 1 || v === "1";

  const isAdItem = (o) => {
    if (!isObj(o)) return false;
    if (truthy(o.is_ad) || truthy(o.isAd)) return true;

    const card = o.card_type !== undefined ? o.card_type : o.cardType;
    if ("string" == typeof card && /^ad[_-]/i.test(card)) return true;

    const type = o.ad_type !== undefined ? o.ad_type : o.adType;
    const id = o.ad_id !== undefined ? o.ad_id : o.adId;
    if (
      type !== undefined && type !== null && type !== "" && type !== 0 &&
      id !== undefined && id !== null && id !== ""
    ) {
      return true;
    }
    return false;
  };

  let removed = 0;
  const walk = (node, depth) => {
    if (depth > 5 || !node || "object" != typeof node) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        if (isAdItem(node[i])) {
          node.splice(i, 1);
          removed += 1;
        } else {
          walk(node[i], depth + 1);
        }
      }
      return;
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (value && "object" == typeof value) walk(value, depth + 1);
    }
  };

  walk(data, 0);
  if (!removed) {
    $done({});
    return;
  }

  $done({ body: JSON.stringify(data) });
})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
