//=======================================================================================
// Weibo Clean — 微博开屏 / 时间线 / 评论 / 热搜广告清理
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

//=======================================================================================
// Weibo Clean — 微博开屏、时间线、评论区与热搜广告清理
//
// 只改 JSON 响应，按结构删数组元素或字段，不碰图片与视频流：
//
//   /wbapplua/wbpullad.lua | /2/push/active
//     开屏与冷启动广告：清空 ads / cached_ad，把投放时间推到 2040 年
//   /2/statuses/(unread_hot_timeline|friends_timeline|container_timeline|bilateral_timeline|extend)
//   /2/groups/timeline | /2/video/tiny_stream_video_list
//     时间线与详情：过滤 statuses / items / trends 里带 promotion / ad_state / mblogtypename="广告"|"热推"
//     或 readtimetype="adMblog" 的推广微博，剥离正文下方的商业卡片
//   /2/comments/build_comments
//     评论区：过滤 datas / root_comments 里带 adType / is_ad / type=1(广告评论) 的推广条目與评论文案气泡广告
//   /2/search/(finder|container_timeline|container_discover) | /2/page | /2/cardlist
//     发现页与热搜：过滤 cards / card_group / items 里带 promotion / is_ad / "商"|"广告"|"热推" 角标的商业热搜与横幅
//   /2/profile/me (clean_ui=true 时)
//     我的页：隐藏会员中心横幅、钱包借钱、游戏推广等营销卡片
//
// 保护字符串外的 16+ 位微博 mid / uid 整数，避免 JSON.parse 丢精度。
// 一页被删空时保留原样，避免客户端把空页当成加载失败。
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

  const status = Number(res.status || res.statusCode || 200);
  const body = res.body;
  if (status >= 300 || typeof body !== "string" || !body || body.length > 8388608) {
    $done({});
    return;
  }

  // 预提取 JSON（兼容 wbpullad.lua 有时包在文本里或标准 JSON）
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    $done({});
    return;
  }

  // 微博 mid / id 都是 16~19 位整数，用占位符保护字符串外的长整数。
  const BIGINT_MARK = "__wb_bigint_";
  let hasBigInt = false;
  const safeBody = body.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
    if (!num) return m;
    hasBigInt = true;
    return '"' + BIGINT_MARK + num + '"';
  });

  let data;
  try {
    data = JSON.parse(safeBody);
  } catch (e) {
    $done({});
    return;
  }
  if (!isObj(data)) {
    $done({});
    return;
  }

  const path = url.split("?")[0];
  let changed = false;

  const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
  const nonEmptyObj = (v) => isObj(v) && Object.keys(v).length > 0;

  // ---------- 微博单条状态 (mblog) 广告判定 ----------
  const isAdMblog = (m) => {
    if (!isObj(m)) return false;
    if (truthy(m.is_ad) || truthy(m.ad_state) || truthy(m.isAd)) return true;
    if (nonEmptyObj(m.promotion) || nonEmptyObj(m.ad_info) || nonEmptyObj(m.ad_data)) return true;
    if (m.readtimetype === "adMblog") return true;
    const typeName = typeof m.mblogtypename === "string" ? m.mblogtypename : "";
    const mark = typeof m.mark === "string" ? m.mark : "";
    if (/广告|热推|推广|品牌/.test(typeName)) return true;
    if (mark && /(?:^|[_|-])ad(?:$|[_|-])/i.test(mark)) return true;
    if (isObj(m.title) && typeof m.title.text === "string" && /广告|热推|推荐/.test(m.title.text) && m.promotion_info) {
      return true;
    }
    if (isObj(m.content_auth_info) && /广告|热推/.test(String(m.content_auth_info.content_auth_title || ""))) {
      return true;
    }
    return false;
  };

  // 容器流条目（container_timeline / items）可能是 mblog，也可能是包裹了 data.mblog 的卡片
  const isAdTimelineItem = (item) => {
    if (!isObj(item)) return false;
    if (isAdMblog(item)) return true;
    if (isObj(item.data) && isAdMblog(item.data)) return true;
    if (isObj(item.mblog) && isAdMblog(item.mblog)) return true;
    if (isObj(item.data) && isObj(item.data.mblog) && isAdMblog(item.data.mblog)) return true;
    const cat = String(item.category || item.type || item.card_type_name || "");
    if (/^(?:ad|advert|feed_ad|trend_ad)$/i.test(cat)) return true;
    if (isObj(item.data) && (truthy(item.data.is_ad) || nonEmptyObj(item.data.promotion) || item.data.card_type === 22)) {
      return true;
    }
    return false;
  };

  // ---------- 发现页 / 热搜卡片 (card / card_group) 广告判定 ----------
  const isAdCard = (card) => {
    if (!isObj(card)) return false;
    if (truthy(card.is_ad) || truthy(card.ad_state) || nonEmptyObj(card.promotion) || nonEmptyObj(card.ad_data)) {
      return true;
    }
    if (card.card_type === 22 || card.card_type === 118 && card.is_ad) return true;
    if (isObj(card.mblog) && isAdMblog(card.mblog)) return true;
    // 热搜词条里的「商」「广告」「热推」角标
    const desc = String(card.small_icon_desc || card.icon_desc || card.flag_desc || card.card_type_name || "");
    if (/^(?:商|广告|热推|推广|品牌)$/.test(desc.trim())) return true;
    if (typeof card.pic === "string" && /(?:_ad_|\/ad_|commercial)/i.test(card.pic) && card.promotion) return true;
    if (typeof card.actionlog === "object" && card.actionlog && card.actionlog.source === "ad") return true;
    if (isObj(card.data) && isAdCard(card.data)) return true;
    return false;
  };

  // ---------- 评论区广告判定 ----------
  const isAdComment = (c) => {
    if (!isObj(c)) return false;
    if (truthy(c.is_ad) || truthy(c.ad_state) || nonEmptyObj(c.ad_info) || nonEmptyObj(c.promotion)) return true;
    if (typeof c.adType === "string" && c.adType.length > 0) return true;
    if (typeof c.adType === "number" && c.adType > 0) return true;
    // build_comments 里的 datas 元素：{ type: 1, data: ... } 或 adType="广告"
    if (c.type === 1 && (c.adType || (isObj(c.data) && (c.data.is_ad || c.data.adType || c.data.promotion)))) {
      return true;
    }
    if (isObj(c.data) && isAdComment(c.data)) return true;
    return false;
  };

  // 过滤数组；若删完为空且 allowEmpty=false 则保留原数组
  const filterList = (holder, key, predicate, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = list.filter((x) => !isObj(x) || !predicate(x));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
    }
  };

  // 递归清理 cards 及其内部的 card_group
  const cleanCardArray = (holder, key) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = [];
    let localChanged = false;
    for (const card of list) {
      if (!isObj(card)) {
        kept.push(card);
        continue;
      }
      if (isAdCard(card)) {
        localChanged = true;
        continue;
      }
      if (Array.isArray(card.card_group) && card.card_group.length) {
        const groupKept = card.card_group.filter((g) => !isObj(g) || !isAdCard(g));
        if (groupKept.length !== card.card_group.length) {
          localChanged = true;
          if (!groupKept.length) {
            continue;
          }
          card.card_group = groupKept;
        }
      }
      if (isObj(card.data) && Array.isArray(card.data.card_group) && card.data.card_group.length) {
        const groupKept = card.data.card_group.filter((g) => !isObj(g) || !isAdCard(g));
        if (groupKept.length !== card.data.card_group.length) {
          localChanged = true;
          if (!groupKept.length) {
            continue;
          }
          card.data.card_group = groupKept;
        }
      }
      kept.push(card);
    }
    if (localChanged && kept.length > 0) {
      holder[key] = kept;
      changed = true;
    }
  };

  try {
    // 1. 开屏与冷启动配置 (/wbapplua/wbpullad.lua, /2/push/active)
    if (/\/wbapplua\/wbpullad\.lua$|\/2\/push\/active$/.test(path)) {
      if (blockAds) {
        const FUTURE = 2208960000;
        const holders = [data, data.cached_ad, data.data];
        for (const h of holders) {
          if (!isObj(h)) continue;
          for (const k of ["ads", "ad_list", "ads_list", "feed_ads"]) {
            if (Array.isArray(h[k]) && h[k].length) {
              for (const ad of h[k]) {
                if (!isObj(ad)) continue;
                ad.start_date = FUTURE;
                ad.end_date = FUTURE + 86400;
                ad.display_duration = 0;
              }
              h[k] = [];
              changed = true;
            }
          }
        }
        if (data.need_ad) {
          data.need_ad = 0;
          changed = true;
        }
      }
    }

    // 2. 时间线与视频流 (/2/statuses/*, /2/groups/timeline, /2/video/tiny_stream_video_list)
    if (/\/2\/(?:statuses\/|groups\/timeline|video\/tiny_stream_video_list)/.test(path)) {
      if (blockAds) {
        filterList(data, "statuses", isAdTimelineItem);
        filterList(data, "items", isAdTimelineItem);
        filterList(data, "trends", isAdTimelineItem, true);
        if (Array.isArray(data.advertises) && data.advertises.length) {
          data.advertises = [];
          changed = true;
        }
        if (Array.isArray(data.ad) && data.ad.length) {
          data.ad = [];
          changed = true;
        }
        // 详情页 extend 接口里的推广横幅与商品卡
        if (/\/2\/statuses\/extend$/.test(path)) {
          for (const k of ["head_cards", "trend", "ad_info", "common_struct", "follow_data"]) {
            if (data[k] !== undefined && data[k] !== null) {
              delete data[k];
              changed = true;
            }
          }
        }
      }
    }

    // 3. 评论区 (/2/comments/build_comments)
    if (/\/2\/comments\/build_comments$/.test(path)) {
      if (blockAds) {
        filterList(data, "datas", isAdComment);
        filterList(data, "root_comments", isAdComment);
        filterList(data, "comments", isAdComment);
        for (const k of ["comment_bubble", "ad_info", "header_info"]) {
          if (isObj(data[k]) && (data[k].is_ad || data[k].ad_type || k === "comment_bubble")) {
            delete data[k];
            changed = true;
          }
        }
      }
    }

    // 4. 发现页、热搜与卡片流 (/2/search/*, /2/page, /2/cardlist)
    if (/\/2\/(?:search\/|page$|cardlist$)/.test(path)) {
      if (blockAds) {
        cleanCardArray(data, "cards");
        cleanCardArray(data, "items");
        if (isObj(data.data)) {
          cleanCardArray(data.data, "cards");
          cleanCardArray(data.data, "items");
        }
        if (isObj(data.channelInfo) && Array.isArray(data.channelInfo.channels)) {
          const kept = data.channelInfo.channels.filter(
            (ch) => !isObj(ch) || (!ch.is_ad && !/广告|推广/.test(String(ch.name || "")))
          );
          if (kept.length && kept.length !== data.channelInfo.channels.length) {
            data.channelInfo.channels = kept;
            changed = true;
          }
        }
      }
    }

    // 5. 我的页精简 (/2/profile/me)
    if (/\/2\/profile\/me$/.test(path)) {
      if (blockAds && data.vip_center) {
        delete data.vip_center;
        changed = true;
      }
      if (cleanUi && Array.isArray(data.items)) {
        const UI_CLUTTER_RE = /钱包|借钱|游戏|微贷|信用|商城|漫画|免流量|任务中心|红包/;
        const kept = data.items.filter((item) => {
          if (!isObj(item)) return true;
          if (isAdTimelineItem(item)) return false;
          const text = JSON.stringify(item.data || item);
          return !UI_CLUTTER_RE.test(text);
        });
        if (kept.length && kept.length !== data.items.length) {
          data.items = kept;
          changed = true;
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

  let out = JSON.stringify(data);
  if (hasBigInt) {
    out = out.replace(new RegExp('"' + BIGINT_MARK + '(-?\\d+)"', "g"), "$1");
  }
  $done({ body: out });
})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
