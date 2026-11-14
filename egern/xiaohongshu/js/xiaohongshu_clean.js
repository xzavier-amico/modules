//=======================================================================================
// Xiaohongshu Clean — 首页 / 搜索 / 评论广告清理
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

//=======================================================================================
// Xiaohongshu Clean — 小红书首页 / 搜索 / 评论广告清理
//
// 只改 JSON 响应，按结构删数组元素或字段，不做全量重编码：
//
//   /api/sns/v<n>/homefeed            首页瀑布流：删 data[] 里 is_ads 为 true 的卡片
//   /api/sns/v<n>/search/notes        搜索结果：删 data.items[] 里 ads 为 true 的笔记
//   /api/sns/v<n>/note/comment/list   评论区：删带 is_ads 标记的评论与子评论
//   /api/sns/v<n>/note/widgets        视频播放页商品推广位：清空 data
//   /api/sns/v<n>/note/feed           笔记详情相关推荐：删 is_ads 条目
//   /api/sns/v<n>/system_service/splash_config
//                                     开屏：把 ads_groups 的投放时间推到 2040 年
//   /api/sns/v<n>/system_service/config
//                                     启动配置：删 splash / loading_img / app_theme 等推广字段
//
// 界面精简（clean_ui，默认关闭）：
//   /api/sns/v<n>/homefeed/categories 删「购物」「市集」「直播」三个 tab
//   /api/sns/v<n>/system_service/config 额外删 store（商城入口）
//
// 结构对不上、解析失败、响应过大、处理中抛异常都原样放行。
// 一页被删空时保留原样，客户端不会把它当成「没有内容」。
//=======================================================================================

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || null;
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = (res && res.url) || req.url || "";
  if (!res) {
    $done({});
    return;
  }

  const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);

  // Loon 传位置数组或对象，Egern 传 JSON 字符串，三种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0], clean_ui: raw[1] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const blockAds = flag(opt.block_ads, true);
  const cleanUi = flag(opt.clean_ui, false);
  if (!blockAds && !cleanUi) {
    $done({});
    return;
  }

  const status = Number((res && (res.status || res.statusCode)) || 200);
  const body = res.body;
  if (status >= 300 || typeof body !== "string" || !body || body.length > 8388608) {
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
  if (!isObj(data)) {
    $done({});
    return;
  }

  const path = url.split("?")[0];
  const payload = data.data;

  // ---------- 广告判定 ----------

  // 首页卡片：is_ads 是主标记；ads / ads_info 是不同版本的备选写法。
  const feedAd = (x) =>
    x.is_ads === true || x.ads === true || (isObj(x.ads_info) && Object.keys(x.ads_info).length > 0);

  // 搜索结果：ads 是主标记。
  const noteAd = (x) =>
    x.ads === true || x.is_ads === true || (isObj(x.ads_info) && Object.keys(x.ads_info).length > 0);

  // 评论广告：show_tags 里带 is_ads 是常见写法，另外兼容布尔标记。
  const commentAd = (c) => {
    if (c.is_ads === true || c.ads === true) return true;
    if (isObj(c.ads_info) && Object.keys(c.ads_info).length > 0) return true;
    if (Array.isArray(c.show_tags) && c.show_tags.indexOf("is_ads") >= 0) return true;
    return c.comment_type === "ads";
  };

  // 过滤数组；没删掉东西、或者会整页删空时都返回 null，调用方保持原样。
  const filterList = (list, isAd) => {
    if (!Array.isArray(list) || !list.length) return null;
    const kept = list.filter((x) => !isObj(x) || !isAd(x));
    if (kept.length === list.length) return null;
    return kept.length ? kept : null;
  };

  let changed = false;

  try {
    if (/\/api\/sns\/v\d+\/homefeed$/.test(path)) {
      if (blockAds && Array.isArray(payload)) {
        const kept = filterList(payload, feedAd);
        if (kept) {
          data.data = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/homefeed\/categories$/.test(path)) {
      if (cleanUi && isObj(payload) && Array.isArray(payload.categories)) {
        const drop = ["homefeed.shop", "homefeed.sketch", "homefeed.live"];
        const kept = payload.categories.filter((c) => !isObj(c) || drop.indexOf(c.oid) < 0);
        if (kept.length && kept.length !== payload.categories.length) {
          payload.categories = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/search\/notes$/.test(path)) {
      if (blockAds && isObj(payload)) {
        const list = Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.data)
            ? payload.data
            : null;
        const kept = filterList(list, noteAd);
        if (kept) {
          if (list === payload.items) payload.items = kept;
          else payload.data = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/note\/comment\/list$/.test(path)) {
      if (blockAds && isObj(payload) && Array.isArray(payload.comments)) {
        let hit = false;
        const kept = payload.comments.filter((c) => {
          if (!isObj(c)) return true;
          if (commentAd(c)) {
            hit = true;
            return false;
          }
          if (Array.isArray(c.sub_comments)) {
            const subs = c.sub_comments.filter((s) => !isObj(s) || !commentAd(s));
            if (subs.length !== c.sub_comments.length) {
              hit = true;
              c.sub_comments = subs;
            }
          }
          return true;
        });
        if (hit && kept.length) {
          payload.comments = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/note\/widgets$/.test(path)) {
      if (blockAds && isObj(payload) && Object.keys(payload).length) {
        data.data = {};
        changed = true;
      }
    } else if (/\/api\/sns\/v\d+\/note\/(?:feed|tabfeed|videofeed|imagefeed|redtube)$/.test(path)) {
      if (blockAds) {
        if (Array.isArray(payload)) {
          const kept = filterList(payload, feedAd);
          if (kept) {
            data.data = kept;
            changed = true;
          }
        } else if (isObj(payload)) {
          const list = Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.data)
              ? payload.data
              : null;
          const kept = filterList(list, feedAd);
          if (kept) {
            if (list === payload.items) payload.items = kept;
            else payload.data = kept;
            changed = true;
          }
        }
      }
    } else if (/\/api\/sns\/v\d+\/system_service\/splash_config$/.test(path)) {
      if (blockAds && isObj(payload) && Array.isArray(payload.ads_groups)) {
        // 把投放窗口推到 2040 年，开屏素材永远不到期展示。
        const START = "2208963661";
        const END = "2209050061";
        for (const group of payload.ads_groups) {
          if (!isObj(group)) continue;
          group.start_time = START;
          group.end_time = END;
          if (Array.isArray(group.ads)) {
            for (const ad of group.ads) {
              if (!isObj(ad)) continue;
              ad.start_time = START;
              ad.end_time = END;
            }
          }
        }
        changed = true;
      }
    } else if (/\/api\/sns\/v\d+\/system_service\/config$/.test(path)) {
      if (isObj(payload)) {
        const drop = blockAds
          ? ["splash", "loading_img", "app_theme", "cmt_words", "highlight_tab", "watermark_pic_path"]
          : [];
        if (cleanUi) drop.push("store");
        for (const key of drop) {
          if (payload[key] !== undefined && payload[key] !== null) {
            delete payload[key];
            changed = true;
          }
        }
      }
    }
  } catch (e) {
    $done({});
    return;
  }

  if (!changed) {
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
