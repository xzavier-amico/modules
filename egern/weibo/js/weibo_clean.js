//=======================================================================================
// Weibo Clean — 微博开屏 / 时间线 / 评论 / 热搜 / 我的页清理
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
// Weibo Clean — 微博开屏、时间线、详情/评论、发现/热搜/综合搜索与「我的」页净化
//
// 核心修复点：
//   1) 开屏覆盖本地缓存：
//      - sdkapp.uve.weibo.com/interface/sdk/sdkad.php（保留末尾 "OK" 标记，延迟时间推至 2040 年）
//      - wbapp.uve.weibo.com/wbapplua/wbpullad.lua & preload/get_ad（推迟 cached_ad.ads 有效期）
//      - bootpreload.uve.weibo.com/v[12]/ad/preload（推迟 ads & creatives 有效期）
//      - /2/push/active（推迟 feed_redpacket） & /2/checkin/show（show=0）
//   2) 「我的」页 (/2/profile/me) 按真实 itemId 白名单 + 嵌套标题对象解析：
//      - 真实响应使用 itemId 分块：profileme_mine、100505_-_top8、100505_-_manage、100505_-_manage2、
//        100505_-_chaohua、100505_-_recentlyuser；
//      - 剥离 vipHeaderBgImage、profileme_mine.header 的 vipView/vipCenter/vipIcon、
//        100505_-_manage2 的 body/footer 推广卡；
//      - 100505_-_top8 只保留核心白名单项（相册/赞/收藏/浏览记录/草稿箱/创作中心），其余 100505_-_
//        推广/任务中心/钱包/借钱/游戏/活动块一律删除（不再因为 title 为空或对象而漏放！）。
//   3) 发现页 / 热搜 / 综合搜索 / 评论区补齐真实路径：
//      - /2/search/finder（channelInfo.channels[].payload.items & loadedInfo）
//      - /2/search/container_timeline、/2/searchall、/2/flowpage、/2/flowlist
//      - /2/comments/build_comments、/2/comments/mix_comments、/2/statuses/container_detail_*
//      - /2/groups/allgroups/v2、/2/statuses/container_timeline(_hot|_unread|_topic)?
//
// 保护字符串外的 16+ 位微博 mid / uid 整数，避免 JSON.parse 丢精度。
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
  const cleanUi = flag(opt.clean_ui, true);
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

  const path = url.split("?")[0];

  // sdkad.php 响应末尾带 "OK"，需截掉解析再拼回 "OK"；wbpullad.lua 可能带前导文本
  let rawJson = body;
  let trailingSuffix = "";
  const isSdkAd = /\/interface\/sdk\/sdkad\.php$/.test(path);
  if (isSdkAd && body.endsWith("OK")) {
    rawJson = body.slice(0, -2);
    trailingSuffix = "OK";
  } else {
    const first = body.charCodeAt(0);
    if (first !== 0x7b && first !== 0x5b) {
      const idx = body.indexOf("{");
      const lastIdx = body.lastIndexOf("}");
      if (idx >= 0 && lastIdx > idx && /wbpullad\.lua|sdkad\.php/.test(path)) {
        rawJson = body.slice(idx, lastIdx + 1);
      } else {
        $done({});
        return;
      }
    }
  }

  // 保护字符串外的 16+ 位整数（mid / uid），避免 JSON.parse 丢精度。
  const BIGINT_MARK = "__wb_bigint_";
  let hasBigInt = false;
  const safeBody = rawJson.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
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

  let changed = false;

  const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
  const nonEmptyObj = (v) => isObj(v) && Object.keys(v).length > 0;
  const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

  // ---------- 1. 单条微博 (mblog) 广告判定 ----------
  const isAdMblog = (m) => {
    if (!isObj(m)) return false;
    if (truthy(m.is_ad) || truthy(m.ad_state) || truthy(m.isAd) || truthy(m.is_ads)) return true;
    if (m.ads_material_info && m.ads_material_info.is_ads === true) return true;
    if (
      nonEmptyObj(m.promotion) ||
      nonEmptyObj(m.ad_info) ||
      nonEmptyObj(m.ad_data) ||
      nonEmptyObj(m.promotion_info) ||
      nonEmptyObj(m.ad_tag) ||
      nonEmptyStr(m.promotion_url)
    ) {
      return true;
    }
    if (m.readtimetype === "adMblog") return true;
    const typeName = typeof m.mblogtypename === "string" ? m.mblogtypename : "";
    const mark = typeof m.mark === "string" ? m.mark : "";
    const titleText = isObj(m.title) && typeof m.title.text === "string" ? m.title.text : "";
    if (/广告|热推|推广|品牌|赞助|商业|精选推荐/.test(typeName)) return true;
    if (mark && /(?:^|[_|-])ad(?:$|[_|-])|^\d+_ad/i.test(mark)) return true;
    if (/广告|热推|商业推广|品牌推荐/.test(titleText)) return true;
    if (isObj(m.content_auth_info) && /广告|热推|推广|商业/.test(String(m.content_auth_info.content_auth_title || ""))) {
      return true;
    }
    if (Array.isArray(m.mblog_menus_new)) {
      for (const menu of m.mblog_menus_new) {
        if (isObj(menu) && (menu.type === "ad" || menu.type === "mblog_menus_ad" || /广告/.test(String(menu.name || "")))) {
          return true;
        }
      }
    }
    if (isObj(m.actionlog) && (m.actionlog.source === "ad" || /(?:^|&)adid=/.test(String(m.actionlog.ext || "")))) {
      return true;
    }
    // 顺手剥离正常微博里的商业挂件与橱窗
    for (const k of ["common_struct", "ad_struct", "semantic_brand_params", "follow_data"]) {
      if (isObj(m[k]) || (Array.isArray(m[k]) && m[k].length)) {
        delete m[k];
        changed = true;
      }
    }
    return false;
  };

  const isAdTimelineItem = (item) => {
    if (!isObj(item)) return false;
    if (isAdMblog(item)) return true;
    if (isObj(item.data) && isAdMblog(item.data)) return true;
    if (isObj(item.mblog) && isAdMblog(item.mblog)) return true;
    if (isObj(item.data) && isObj(item.data.mblog) && isAdMblog(item.data.mblog)) return true;

    const cat = String(item.category || item.type || item.card_type_name || "");
    if (/^(?:ad|advert|feed_ad|trend_ad|hot_ad|banner_ad|recommend_ad|group_ad)$/i.test(cat)) return true;

    const d = isObj(item.data) ? item.data : item;
    if (truthy(d.is_ad) || truthy(d.is_ads) || nonEmptyObj(d.promotion) || nonEmptyObj(d.ad_data) || nonEmptyObj(d.ad_info)) {
      return true;
    }
    const itemId = String(item.itemId || item.itemid || d.itemid || d.card_id || "");
    if (/^(?:ad_|advert_|trend_ad|feed_ad|ym_ad|insert_ad|commercial)/i.test(itemId)) return true;
    if (/ad_mblog|ad_card|search_ad|banner_ad/i.test(itemId)) return true;

    if (d.card_type === 22 || d.card_type === 118 || d.card_type === 208 || d.card_type === 89 || d.card_type === 196) {
      if (
        d.is_ad ||
        d.promotion ||
        /广告|热推|推荐|赞助|活动|游戏|商城|借钱/.test(String(d.title || d.card_type_name || itemId))
      ) {
        return true;
      }
    }
    return false;
  };

  // ---------- 2. 发现页 / 热搜 / 通用卡片广告判定 ----------
  const isAdCard = (card) => {
    if (!isObj(card)) return false;
    if (truthy(card.is_ad) || truthy(card.is_ads) || truthy(card.ad_state) || nonEmptyObj(card.promotion) || nonEmptyObj(card.ad_data)) {
      return true;
    }
    if (card.card_type === 22 || (card.card_type === 118 && (card.is_ad || card.promotion))) return true;
    if (card.card_type === 42 && (card.title_extra_text === "广告" || card.is_ads === true)) return true;
    if (isObj(card.mblog) && isAdMblog(card.mblog)) return true;
    const desc = String(card.small_icon_desc || card.icon_desc || card.flag_desc || card.card_type_name || "");
    if (/^(?:商|广告|热推|推广|品牌|买)$/.test(desc.trim())) return true;
    if (typeof card.pic === "string" && /(?:_ad_|\/ad_|commercial)/i.test(card.pic) && card.promotion) return true;
    if (isObj(card.actionlog) && (card.actionlog.source === "ad" || /ad_id|is_ad|adid/.test(String(card.actionlog.ext || "")))) {
      return true;
    }
    const itemid = String(card.itemid || card.itemId || "");
    if (/ad_channel|finder_banner_ad|hotsearch_ad|commercial|trend_ad|search_band_ad/i.test(itemid)) return true;
    if (isObj(card.data) && isAdCard(card.data)) return true;
    return false;
  };

  // ---------- 3. 评论区广告判定 ----------
  const isAdComment = (c) => {
    if (!isObj(c)) return false;
    if (truthy(c.is_ad) || truthy(c.ad_state) || nonEmptyObj(c.ad_info) || nonEmptyObj(c.promotion)) return true;
    if (typeof c.adType === "string" && c.adType.length > 0) return true;
    if (typeof c.adType === "number" && c.adType > 0) return true;
    if (c.type === 6 || c.type === 15) return true;
    if (c.type === 1 && (c.adType || (isObj(c.data) && (c.data.is_ad || c.data.adType || c.data.promotion)))) {
      return true;
    }
    if (c.comment_type === "ad" || c.type === "ad") return true;
    const uname = String(c.user?.name || c.data?.user?.name || "");
    if (uname && /^(?:超话社区|微博开新年|微博热搜|微博视频)$/.test(uname)) return true;
    if (isObj(c.data) && (isAdComment(c.data) || isAdMblog(c.data))) return true;
    return false;
  };

  // ---------- 4. 「我的」页 (/2/profile/me) 真实 itemId 白名单 + 通用嵌套标题清洗 ----------
  const PROFILE_TRASH_TEXT_RE =
    /任务中心|任务|签到|红包|领钱|提现|金币|积分|福利|抽奖|夺宝|借钱|微贷|贷款|分期|白条|信用卡|办卡|理财|保险|钱包|优惠券|省钱|卡券|会员|SVIP|VIP|游戏|小游戏|游民|电竞|商城|好物|种草|潮物|小店|橱窗|直播|连麦|语聊|相亲|交友|找对象|测试|运势|星座|算命|塔罗|占卜|小说|漫画|故事|短剧|听书|免流量|王卡|流量|网盘|彩铃|壁纸|表情|装扮|皮肤|挂件|公益|推广|热推|活动|推荐服务|更多服务|热门服务|我的服务|成长|等级|勋章|粉丝群|认证|订单|广告中心/;

  const PROFILE_CORE_WHITE_RE =
    /^(?:我的相册|相册|我的赞|赞|赞\/收藏|我的收藏|收藏|浏览记录|历史记录|浏览历史|足迹|草稿箱|草稿|创作中心|创作者中心|客服|客服中心|帮助与反馈|设置|夜间模式|深色模式|屏蔽管理|内容管理|我的关注|关注|我的粉丝|粉丝|我的微博|微博)$/;

  // 真实新版微博 /2/profile/me 顶层核心块白名单
  const REAL_PROFILE_KEEP_IDS = new Set([
    "profileme_mine",
    "100505_-_top8",
    "100505_-_manage",
    "100505_-_manage2",
    "100505_-_chaohua",
    "100505_-_recentlyuser",
  ]);
  // 真实 100505_-_top8 四宫格白名单
  const REAL_TOP8_KEEP_IDS = new Set([
    "100505_-_album",
    "100505_-_like",
    "100505_-_fav",
    "100505_-_watchhistory",
    "100505_-_draft",
    "100505_-_productcenter",
  ]);

  const extractStr = (v) => {
    if (typeof v === "string" && v.trim()) return v.trim();
    if (isObj(v)) {
      for (const k of ["content", "text", "title", "name"]) {
        if (typeof v[k] === "string" && v[k].trim()) return v[k].trim();
      }
    }
    return "";
  };

  const getEntryTitle = (obj) => {
    if (!isObj(obj)) return "";
    const d = isObj(obj.data) ? obj.data : obj;
    for (const k of ["title_sub", "title", "name", "desc", "card_type_name", "text", "main_title", "sub_title"]) {
      const s1 = extractStr(d[k]);
      if (s1) return s1;
      const s2 = extractStr(obj[k]);
      if (s2) return s2;
    }
    if (isObj(obj.header)) {
      const s3 = extractStr(obj.header.title);
      if (s3) return s3;
    }
    return "";
  };

  const isHeaderOrUserCard = (item) => {
    if (!isObj(item)) return false;
    const d = isObj(item.data) ? item.data : item;
    const itemId = String(item.itemId || item.itemid || d.itemid || d.card_id || "");
    if (itemId === "profileme_mine") return true;
    if (/header|userinfo|user_info|avatar|profile_top|mine_info/i.test(itemId)) return true;
    if (isObj(d.user) && (d.user.id || d.user.screen_name)) return true;
    if (d.card_type === 1 || d.card_type === 200 || d.card_type === 201) return true;
    return false;
  };

  const cleanProfileGridList = (list) => {
    if (!Array.isArray(list) || !list.length) return list;
    return list.filter((entry) => {
      if (!isObj(entry)) return false;
      const d = isObj(entry.data) ? entry.data : entry;
      if (isAdCard(d) || isAdTimelineItem(entry)) return false;
      const itemId = String(entry.itemId || entry.itemid || d.itemid || "");
      if (itemId && REAL_TOP8_KEEP_IDS.has(itemId)) return true;
      if (itemId && /^100505_-_/.test(itemId) && cleanUi) return false;

      const title = getEntryTitle(entry);
      const scheme = String(d.scheme || entry.scheme || "");

      if (title && PROFILE_CORE_WHITE_RE.test(title)) return true;
      if (title && PROFILE_TRASH_TEXT_RE.test(title)) return false;
      if (
        /(?:task|checkin|sign|wallet|finance|loan|borrow|game|mall|shop|store|novel|book|comic|live|vip|welfare|lottery|redpacket|activity|ad|banner|kingcard|free_traffic|ordercenter|promote)/i.test(
          scheme + " " + itemId
        )
      ) {
        return false;
      }
      if (cleanUi && title) return PROFILE_CORE_WHITE_RE.test(title);
      return true;
    });
  };

  const GRID_KEYS = ["elements", "items", "menus", "entrances", "group", "sub_item", "apps", "buttons", "list"];

  const cleanProfileItems = (list) => {
    if (!Array.isArray(list) || !list.length) return null;
    const out = [];
    let modified = false;

    // 检测是否是真实新版 /2/profile/me 响应（包含 profileme_mine 或 100505_-_ 前缀块）
    const isRealMeLayout = list.some(
      (x) => isObj(x) && (x.itemId === "profileme_mine" || /^100505_-_/.test(String(x.itemId || "")))
    );

    for (const item of list) {
      if (!isObj(item)) continue;
      const d = isObj(item.data) ? item.data : item;
      const itemId = String(item.itemId || item.itemid || d.itemid || d.card_id || "");

      // 真实新版 /2/profile/me 结构精确处理
      if (isRealMeLayout) {
        if (itemId === "profileme_mine") {
          if (isObj(item.header)) {
            for (const k of ["vipView", "vipCenter", "vipIcon"]) {
              if (item.header[k] !== undefined) {
                delete item.header[k];
                modified = true;
              }
            }
          }
          if (Array.isArray(item.items)) {
            for (const sub of item.items) {
              if (isObj(sub) && sub.itemId === "mainnums_friends" && sub.click?.modules?.[0]?.scheme) {
                const s = sub.click.modules[0].scheme;
                if (s.includes("231093_-_selfrecomm")) {
                  sub.click.modules[0].scheme = s.replace("231093_-_selfrecomm", "231093_-_selffollowed");
                  modified = true;
                }
              }
            }
          }
          out.push(item);
          continue;
        }
        if (itemId === "100505_-_top8") {
          if (cleanUi && Array.isArray(item.items)) {
            const kept = item.items.filter((sub) => {
              if (!isObj(sub)) return false;
              const sid = String(sub.itemId || sub.itemid || "");
              if (sid && REAL_TOP8_KEEP_IDS.has(sid)) return true;
              const t = getEntryTitle(sub);
              return !!(t && PROFILE_CORE_WHITE_RE.test(t));
            });
            if (kept.length !== item.items.length) {
              item.items = kept;
              modified = true;
            }
          }
          out.push(item);
          continue;
        }
        if (itemId === "100505_-_manage") {
          if (cleanUi) {
            if (item.style !== undefined) { delete item.style; modified = true; }
            if (item.images !== undefined) { delete item.images; modified = true; }
          }
          out.push(item);
          continue;
        }
        if (itemId === "100505_-_manage2") {
          if (cleanUi || blockAds) {
            if (item.footer !== undefined) { delete item.footer; modified = true; }
            if (item.body !== undefined) { delete item.body; modified = true; }
          }
          out.push(item);
          continue;
        }
        if (itemId === "100505_-_chaohua" || itemId === "100505_-_recentlyuser") {
          out.push(item);
          continue;
        }
        // 在真实 /2/profile/me 布局里，cleanUi=true 时其余全部 100505_-_ 推广/任务中心/钱包块直接砍掉
        if (cleanUi || isAdTimelineItem(item) || isAdCard(item) || !REAL_PROFILE_KEEP_IDS.has(itemId)) {
          if (cleanUi) {
            modified = true;
            continue;
          }
        }
      }

      // 通用 / 旧版我的页结构处理
      if (isHeaderOrUserCard(item)) {
        for (const k of ["vip_center", "vip_info", "ad_info", "banner", "pendant", "checkin_info", "task_info", "right_button"]) {
          if (d[k] !== undefined) {
            delete d[k];
            modified = true;
          }
        }
        out.push(item);
        continue;
      }

      if (isAdTimelineItem(item) || isAdCard(item) || isAdCard(d)) {
        modified = true;
        continue;
      }

      const title = getEntryTitle(item);
      const ct = Number(d.card_type || item.card_type || 0);

      if (ct === 118 || ct === 22 || ct === 208 || ct === 196 || ct === 89) {
        modified = true;
        continue;
      }
      if (
        /(?:ad|banner|vip|wallet|finance|loan|borrow|game|novel|shop|mall|live|redpacket|task|checkin|sign|welfare|activity|recommend|promotion|hot_service|newusertask|kingcard|free_traffic|charity)/i.test(
          itemId
        ) &&
        !/mine_header|user_info|my_fav|my_like|my_album|my_history/i.test(itemId)
      ) {
        modified = true;
        continue;
      }
      if (title && PROFILE_TRASH_TEXT_RE.test(title) && !PROFILE_CORE_WHITE_RE.test(title)) {
        modified = true;
        continue;
      }

      let hadChildContainer = false;
      let hasSurvivingChildren = false;

      if (Array.isArray(item.items) && item.items.length) {
        hadChildContainer = true;
        const looksLikeCards = item.items.some((x) => isObj(x) && (isObj(x.data) || x.card_type || Array.isArray(x.card_group)));
        const cleanedSub = looksLikeCards ? cleanProfileItems(item.items) : cleanProfileGridList(item.items);
        if (cleanedSub && cleanedSub.length !== item.items.length) {
          modified = true;
          item.items = cleanedSub;
        }
        if (Array.isArray(item.items) && item.items.length > 0) hasSurvivingChildren = true;
      }

      if (Array.isArray(d.card_group) && d.card_group.length) {
        hadChildContainer = true;
        const subCards = cleanProfileItems(d.card_group);
        if (subCards) {
          modified = true;
          d.card_group = subCards;
        }
        const subGrid = cleanProfileGridList(d.card_group);
        if (subGrid.length !== d.card_group.length) {
          modified = true;
          d.card_group = subGrid;
        }
        if (Array.isArray(d.card_group) && d.card_group.length > 0) hasSurvivingChildren = true;
      }

      for (const gk of GRID_KEYS) {
        if (gk === "items" && d === item) continue;
        if (Array.isArray(d[gk]) && d[gk].length) {
          hadChildContainer = true;
          const filtered = cleanProfileGridList(d[gk]);
          if (filtered.length !== d[gk].length) {
            modified = true;
            d[gk] = filtered;
          }
          if (d[gk].length > 0) hasSurvivingChildren = true;
        }
      }

      if (hadChildContainer && !hasSurvivingChildren) {
        modified = true;
        continue;
      }

      if (cleanUi && !hadChildContainer && title && !PROFILE_CORE_WHITE_RE.test(title)) {
        modified = true;
        continue;
      }

      out.push(item);
    }

    return modified ? out : null;
  };

  const filterList = (holder, key, predicate, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = list.filter((x) => !isObj(x) || !predicate(x));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
    }
  };

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
      if (isAdCard(card) || isAdTimelineItem(card)) {
        localChanged = true;
        continue;
      }
      if (Array.isArray(card.card_group) && card.card_group.length) {
        const groupKept = card.card_group.filter((g) => !isObj(g) || (!isAdCard(g) && !isAdTimelineItem(g)));
        if (groupKept.length !== card.card_group.length) {
          localChanged = true;
          if (!groupKept.length) continue;
          card.card_group = groupKept;
        }
      }
      if (isObj(card.data) && Array.isArray(card.data.card_group) && card.data.card_group.length) {
        const groupKept = card.data.card_group.filter((g) => !isObj(g) || (!isAdCard(g) && !isAdTimelineItem(g)));
        if (groupKept.length !== card.data.card_group.length) {
          localChanged = true;
          if (!groupKept.length) continue;
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

  // 清洗发现页 / 搜索页新版 items[] (category: feed / card / cell / group)
  const FINDER_DROP_CARD_TYPES = new Set([19, 118, 206, 208, 217, 236, 249, 261]);
  const FINDER_GROUP_DROP_TYPES = new Set([118, 182, 192, 217, 247]);
  const cleanSearchContainerItems = (holder) => {
    if (!isObj(holder) || !Array.isArray(holder.items) || !holder.items.length) return;
    const kept = [];
    let localChanged = false;
    for (const item of holder.items) {
      if (!isObj(item)) {
        kept.push(item);
        continue;
      }
      if (item.category === "feed") {
        if (isAdTimelineItem(item)) {
          localChanged = true;
          continue;
        }
        kept.push(item);
      } else if (item.category === "card") {
        const ct = item.data?.card_type;
        if (
          isAdCard(item) ||
          FINDER_DROP_CARD_TYPES.has(ct) ||
          (ct === 101 && item.data?.cate_id === "1114") ||
          (ct === 196 && Object.prototype.hasOwnProperty.call(item.data || {}, "rank"))
        ) {
          localChanged = true;
          continue;
        }
        kept.push(item);
      } else if (item.category === "group") {
        if (Array.isArray(item.items) && item.items.length) {
          const subKept = item.items.filter(
            (sub) => !isObj(sub) || (!isAdCard(sub) && !isAdTimelineItem(sub) && !FINDER_GROUP_DROP_TYPES.has(sub.data?.card_type))
          );
          if (subKept.length !== item.items.length) {
            localChanged = true;
            item.items = subKept;
          }
        }
        kept.push(item);
      } else if (isAdTimelineItem(item) || isAdCard(item)) {
        localChanged = true;
      } else {
        kept.push(item);
      }
    }
    if (localChanged && kept.length > 0) {
      holder.items = kept;
      changed = true;
    }
  };

  try {
    // 1. 开屏广告（覆写有效期至 2040/2090 年以覆盖客户端本地开屏缓存）
    if (isSdkAd && blockAds) {
      if (data.needlocation) { data.needlocation = false; changed = true; }
      if (data.show_push_splash_ad) { data.show_push_splash_ad = false; changed = true; }
      if (data.background_delay_display_time !== undefined) { data.background_delay_display_time = 31536000; changed = true; }
      if (data.lastAdShow_delay_display_time !== undefined) { data.lastAdShow_delay_display_time = 31536000; changed = true; }
      if (data.realtime_ad_video_stall_time !== undefined) { data.realtime_ad_video_stall_time = 0; changed = true; }
      if (data.realtime_ad_timeout_duration !== undefined) { data.realtime_ad_timeout_duration = 0; changed = true; }
      if (Array.isArray(data.ads) && data.ads.length) {
        for (const ad of data.ads) {
          if (!isObj(ad)) continue;
          ad.displaytime = 0;
          ad.displayintervel = 31536000;
          ad.allowdaydisplaynum = 0;
          ad.begintime = "2040-01-01 00:00:00";
          ad.endtime = "2040-01-01 23:59:59";
        }
        changed = true;
      }
    } else if (/\/v\d+\/ad\/preload$/.test(path) && blockAds) {
      const expirePreload = (arr) => {
        if (!Array.isArray(arr) || !arr.length) return;
        for (const ad of arr) {
          if (!isObj(ad)) continue;
          ad.start_time = 3818332800;
          ad.end_time = 3818419199;
          ad.daily_display_cnt = 50;
          ad.display_duration = 0;
          if (Array.isArray(ad.creatives)) expirePreload(ad.creatives);
        }
        changed = true;
      };
      expirePreload(data.ads);
      if (isObj(data.ads) && Array.isArray(data.ads.creatives)) expirePreload(data.ads.creatives);
    } else if (/\/wbapplua\/wbpullad\.lua$|\/preload\/get_ad$/.test(path) && blockAds) {
      if (isObj(data.cached_ad) && Array.isArray(data.cached_ad.ads) && data.cached_ad.ads.length) {
        for (const ad of data.cached_ad.ads) {
          if (!isObj(ad)) continue;
          ad.show_count = 50;
          ad.duration = 0;
          ad.display_duration = 0;
          ad.start_date = 3818332800;
          ad.end_date = 3818419199;
        }
        changed = true;
      }
      if (Array.isArray(data.ads) && data.ads.length) {
        for (const ad of data.ads) {
          if (!isObj(ad)) continue;
          ad.start_date = 3818332800;
          ad.end_date = 3818419199;
          ad.duration = 0;
          ad.display_duration = 0;
        }
        changed = true;
      }
    } else if (/\/2\/push\/active$|\/2\/checkin\/show$|\/2\/client\//.test(path)) {
      if (blockAds) {
        if (isObj(data.feed_redpacket)) {
          data.feed_redpacket.starttime = "2208960000";
          data.feed_redpacket.interval = "31536000";
          data.feed_redpacket.endtime = "2209046399";
          changed = true;
        }
        if (/\/2\/checkin\/show$/.test(path)) {
          if (data.show) { data.show = 0; changed = true; }
          if (data.show_time) { data.show_time = 0; changed = true; }
        }
        for (const h of [data, data.cached_ad, data.data]) {
          if (!isObj(h)) continue;
          for (const k of ["ads", "ad_list", "ads_list", "feed_ads", "tips", "float_ad", "popup", "checkin_info"]) {
            if (Array.isArray(h[k]) && h[k].length) {
              h[k] = [];
              changed = true;
            } else if (nonEmptyObj(h[k])) {
              delete h[k];
              changed = true;
            }
          }
        }
        if (data.need_ad) { data.need_ad = 0; changed = true; }
      }
      if (cleanUi && /\/2\/client\/publisher_list$/.test(path) && Array.isArray(data.elements)) {
        const kept = data.elements.filter((i) => isObj(i) && /^(?:写微博|图片|视频)$/.test(String(i.app_name || "")));
        if (kept.length && kept.length !== data.elements.length) {
          data.elements = kept;
          changed = true;
        }
      }
    }

    // 2. 顶部 tab 分组 (/2/groups/allgroups/v2)
    if (cleanUi && /\/2\/groups\/allgroups\/v2$/.test(path) && Array.isArray(data.pageDatas)) {
      const kept = data.pageDatas.filter((i) => !isObj(i) || i.pageDataType !== "homeExtend");
      if (kept.length && kept.length !== data.pageDatas.length) {
        data.pageDatas = kept;
        changed = true;
      }
    }

    // 3. 时间线、详情与视频流 (/2/statuses/*, /2/groups/timeline, /2/video/*)
    if (/\/2\/(?:statuses\/|groups\/timeline|video\/)/.test(path)) {
      if (blockAds) {
        const isHotOrFollowContainer =
          /\/2\/statuses\/(?:container_timeline(?:_hot|_unread)?|unread_hot_timeline)$/.test(path);
        for (const holder of [data, data.data]) {
          if (!isObj(holder)) continue;
          filterList(holder, "statuses", isAdTimelineItem);
          if (isHotOrFollowContainer && Array.isArray(holder.items) && holder.items.length) {
            const hasCategory = holder.items.some((x) => isObj(x) && typeof x.category === "string");
            const kept = holder.items.filter((x) => {
              if (!isObj(x)) return true;
              if (isAdTimelineItem(x)) return false;
              if (hasCategory && x.category && x.category !== "feed" && x.category !== "feedBiz") return false;
              return true;
            });
            if (kept.length !== holder.items.length && kept.length > 0) {
              holder.items = kept;
              changed = true;
            }
          } else {
            filterList(holder, "items", isAdTimelineItem);
          }
          filterList(holder, "trends", isAdTimelineItem, true);
          cleanCardArray(holder, "cards");
          for (const k of ["advertises", "ad", "ads", "feed_ads", "top_cards", "trend", "headers"]) {
            if (Array.isArray(holder[k]) && holder[k].length) {
              holder[k] = [];
              changed = true;
            }
          }
          if (isObj(holder.loadedInfo) && holder.loadedInfo.headers !== undefined) {
            delete holder.loadedInfo.headers;
            changed = true;
          }
        }
        if (/\/2\/statuses\/extend$/.test(path)) {
          for (const k of [
            "head_cards",
            "trend",
            "ad_info",
            "common_struct",
            "follow_data",
            "reward_info",
            "semantic_brand_params",
            "extend_info",
            "bubble_guide_data",
            "button_extra_info",
            "display_info",
            "floating_button",
            "highlight",
            "interaction_extra_info",
            "page_alerts",
            "source_tag_struct",
          ]) {
            if (data[k] !== undefined && data[k] !== null) {
              delete data[k];
              changed = true;
            }
          }
          if (data.has_common_struct) { data.has_common_struct = false; changed = true; }
          if (data.enable_comment_guide) { data.enable_comment_guide = false; changed = true; }
        }
        if (/\/2\/statuses\/container_detail(?:_comment|_mix)?$/.test(path)) {
          filterList(data, "items", isAdComment);
          filterList(data, "datas", isAdComment);
        }
      }
    }

    // 4. 评论区 (/2/comments/build_comments, /2/comments/mix_comments)
    if (/\/2\/comments\/(?:build_comments|mix_comments)$/.test(path) && blockAds) {
      filterList(data, "datas", isAdComment);
      filterList(data, "root_comments", isAdComment);
      filterList(data, "comments", isAdComment);
      filterList(data, "items", isAdComment);
      for (const k of ["comment_bubble", "ad_info", "header_info", "top_cards", "trend"]) {
        if (data[k] !== undefined && data[k] !== null) {
          if (k === "header_info" && isObj(data[k]) && !data[k].is_ad && !data[k].ad_type) continue;
          delete data[k];
          changed = true;
        }
      }
      if (Array.isArray(data.datas)) {
        for (const item of data.datas) {
          if (!isObj(item) || !isObj(item.data)) continue;
          for (const k of ["comment_bubble", "comment_bullet_screens_message", "vip_button"]) {
            if (item.data[k] !== undefined) {
              delete item.data[k];
              changed = true;
            }
          }
        }
      }
    }

    // 5. 「我的」页与个人页 (/2/profile/me, /2/profile/*, /2/users/show)
    const isProfileUrl =
      /\/2\/(?:profile\/|users\/show)/.test(path) ||
      (/\/2\/(?:page|cardlist)$/.test(path) && /(?:mine|profile|100505|user)/i.test(url)) ||
      isObj(data.vip_center) ||
      (Array.isArray(data.items) &&
        data.items.some((x) => isObj(x) && /^(?:profileme_mine|100505_-_|profile_mine|mine_)/.test(String(x.itemId || x.itemid || ""))));

    if (isProfileUrl) {
      if (blockAds || cleanUi) {
        if (data.vipHeaderBgImage !== undefined) {
          delete data.vipHeaderBgImage;
          changed = true;
        }
        if (isObj(data.loadedInfo) && data.loadedInfo.follow_guide_info !== undefined) {
          delete data.loadedInfo.follow_guide_info;
          changed = true;
        }
        for (const holder of [data, data.data]) {
          if (!isObj(holder)) continue;
          for (const dropKey of [
            "vip_center",
            "vipCenter",
            "top_cards",
            "ad_info",
            "banners",
            "banner",
            "tips",
            "floating_window",
            "checkin_info",
            "task_info",
            "pendant",
            "welfare_info",
            "hot_services",
            "recommend_services",
          ]) {
            if (holder[dropKey] !== undefined && holder[dropKey] !== null) {
              delete holder[dropKey];
              changed = true;
            }
          }
          // /2/profile/container_timeline 是个人主页微博流，不是「我的」宫格，不走宫格删除
          if (/\/2\/profile\/container_timeline$/.test(path)) {
            filterList(holder, "items", (x) => isAdTimelineItem(x) || /INTEREST_PEOPLE/.test(String(x.itemId || "")));
          } else {
            for (const arrKey of ["items", "cards", "card_group", "service_list", "menus"]) {
              if (Array.isArray(holder[arrKey]) && holder[arrKey].length) {
                const cleaned = cleanProfileItems(holder[arrKey]);
                if (cleaned) {
                  holder[arrKey] = cleaned;
                  changed = true;
                }
              }
            }
          }
          filterList(holder, "statuses", isAdTimelineItem);
        }
      }
    } else if (/\/2\/(?:search\/|searchall$|flowpage$|flowlist$|page$|cardlist$|container\/)/.test(path)) {
      // 6. 发现页、热搜榜、综合搜索与通用卡片流
      if (blockAds) {
        // /2/search/finder 新版把内容放在 channelInfo.channels[].payload
        if (/\/2\/search\/finder$/.test(path) && isObj(data.channelInfo) && Array.isArray(data.channelInfo.channels)) {
          for (const ch of data.channelInfo.channels) {
            if (!isObj(ch) || !isObj(ch.payload)) continue;
            const pl = ch.payload;
            if (isObj(pl.loadedInfo)) {
              if (Array.isArray(pl.loadedInfo.searchBarContent) && pl.loadedInfo.searchBarContent.length) {
                pl.loadedInfo.searchBarContent = [];
                changed = true;
              }
              if (pl.loadedInfo.headerBack?.channelStyleMap !== undefined) {
                delete pl.loadedInfo.headerBack.channelStyleMap;
                changed = true;
              }
              if (pl.loadedInfo.searchBarStyleInfo !== undefined) {
                delete pl.loadedInfo.searchBarStyleInfo;
                changed = true;
              }
            }
            cleanSearchContainerItems(pl);
          }
        }

        // /2/search/container_timeline
        if (/\/2\/search\/container_timeline$/.test(path)) {
          cleanSearchContainerItems(data);
          if (data.loadedInfo !== undefined) {
            delete data.loadedInfo;
            changed = true;
          }
        }

        // /2/flowpage (热搜榜)
        if (/\/2\/flowpage$/.test(path) && Array.isArray(data.items)) {
          const kept = [];
          let fpChanged = false;
          for (const item of data.items) {
            if (!isObj(item)) { kept.push(item); continue; }
            if (item.data?.itemid === "hot-search-push-notice") { fpChanged = true; continue; }
            if (Array.isArray(item.items) && item.items.length) {
              const subKept = item.items.filter(
                (s) =>
                  !isObj(s) ||
                  (!isAdCard(s) &&
                    !Object.prototype.hasOwnProperty.call(s.data || {}, "promotion") &&
                    !/_img_search_stick/.test(String(s.data?.pic || "")))
              );
              if (subKept.length !== item.items.length) {
                fpChanged = true;
                item.items = subKept;
              }
            }
            kept.push(item);
          }
          if (fpChanged) {
            data.items = kept;
            changed = true;
          }
        }

        // /2/searchall (综合搜索结果)
        if (/\/2\/searchall$/.test(path)) {
          if (isObj(data.header?.data)) {
            for (const k of ["bg_img", "background_scheme", "background_url"]) {
              if (data.header.data[k] !== undefined) {
                delete data.header.data[k];
                changed = true;
              }
            }
          }
          if (data.loadedInfo?.serviceMap?.layer?.pic) {
            delete data.loadedInfo.serviceMap.layer;
            changed = true;
          }
          if (Array.isArray(data.items) && data.items.length) {
            const SEARCHALL_DROP_TYPES = new Set([3, 17, 22, 30, 42, 89, 206, 236]);
            const kept = [];
            let saChanged = false;
            for (const item of data.items) {
              if (!isObj(item)) { kept.push(item); continue; }
              if (isAdTimelineItem(item) || isAdCard(item)) { saChanged = true; continue; }
              if (item.category === "group" && Array.isArray(item.items)) {
                const subKept = item.items.filter(
                  (sub) =>
                    !isObj(sub) ||
                    (!isAdTimelineItem(sub) &&
                      !isAdCard(sub) &&
                      !SEARCHALL_DROP_TYPES.has(sub.data?.card_type))
                );
                if (subKept.length !== item.items.length) {
                  saChanged = true;
                  item.items = subKept;
                }
              }
              kept.push(item);
            }
            if (saChanged && kept.length) {
              data.items = kept;
              changed = true;
            }
          }
        }

        for (const holder of [data, data.data]) {
          if (!isObj(holder)) continue;
          cleanCardArray(holder, "cards");
          cleanCardArray(holder, "items");
          filterList(holder, "statuses", isAdTimelineItem);
          for (const k of ["top_cards", "banners", "ad_list", "ads"]) {
            if (Array.isArray(holder[k]) && holder[k].length) {
              holder[k] = [];
              changed = true;
            }
          }
        }
        if (isObj(data.channelInfo) && Array.isArray(data.channelInfo.channels)) {
          const kept = data.channelInfo.channels.filter(
            (ch) => !isObj(ch) || (!ch.is_ad && !/广告|推广|游戏|商城/.test(String(ch.name || "")))
          );
          if (kept.length && kept.length !== data.channelInfo.channels.length) {
            data.channelInfo.channels = kept;
            changed = true;
          }
        }
      }
    }

    // 7. 私信列表去掉「活动通知 / 闪聊」
    if (cleanUi && /\/2\/direct_messages\/user_list$/.test(path) && Array.isArray(data.user_list)) {
      const kept = data.user_list.filter((i) => !isObj(i) || !/^(?:活动通知|闪聊)$/.test(String(i.user?.name || "")));
      if (kept.length !== data.user_list.length) {
        data.user_list = kept;
        changed = true;
      }
    }

    // 8. 超话底部栏去广场按钮广告配置
    if (cleanUi && /\/2\/!\/huati\/discovery_home_bottom_channels$/.test(path)) {
      if (data.button_configs !== undefined) {
        delete data.button_configs;
        changed = true;
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
  $done({ body: out + trailingSuffix });
})();

    } catch (e) {
      // 脚本抛错时按原样放行，和兼容模式下不调用 $done 的表现一致，但不拖到超时。
      finish(undefined);
    }
  });
}
