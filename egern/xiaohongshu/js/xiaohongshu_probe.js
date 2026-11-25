//=======================================================================================
// Xiaohongshu Probe — 只记录接口与响应结构，不改写
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
  const rawTrailers =
    ctx.response && (ctx.response.trailers !== undefined ? ctx.response.trailers : ctx.response.h2_trailers);
  const responseTrailers = rawTrailers !== undefined ? plainHeaders(rawTrailers) : undefined;
  const response = ctx.response
    ? Object.assign(
        {
          url: ctx.request && ctx.request.url,
          status: ctx.response.status,
          statusCode: ctx.response.status,
          headers: plainHeaders(ctx.response.headers),
          body: responseBody,
        },
        responseTrailers !== undefined ? { trailers: responseTrailers, h2_trailers: responseTrailers } : {},
      )
    : undefined;

  // $httpClient 的 callback 形式（error, response, data）。
  const httpOptions = (options) => ("string" == typeof options ? { url: options } : options || {});
  const httpCall = (method, options, callback) => {
    const opt = httpOptions(options);
    const isBinary = !!(opt["binary-mode"] || opt.binaryMode);
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
        const body = isBinary ? new Uint8Array(await res.arrayBuffer()) : await res.text();
        callback(null, { status: res.status, statusCode: res.status, headers }, body);
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
      if (next.h2_trailers !== undefined && next.trailers === undefined) next.trailers = next.h2_trailers;
      resolve(next);
    };

    function $done(value) {
      finish(value);
    }

    try {

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

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
