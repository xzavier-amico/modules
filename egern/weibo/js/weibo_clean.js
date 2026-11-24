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
// Weibo Clean — 微博开屏、时间线、评论区、热搜与「我的」页全方位广告清理
//
// 为什么之前微博「我的」页和部分时间线还有一堆「任务中心」和广告：
//   1) 域名漏网之鱼：新版微博 iOS 客户端除了 `api.weibo.cn`，大量使用双栈与高防网关
//      `v6.api.weibo.cn`、`h5.api.weibo.cn`、`b.api.weibo.cn`、`weibointl.api.weibo.cn`！
//      之前 MitM 只写了 `api.weibo.cn`，走 `v6.api.weibo.cn` 等子域名的请求根本没进脚本！
//   2) 「我的」页接口与结构：
//      - 新版「我的」页走 `/2/profile/me`、`/2/profile/container_timeline`、`/2/page`、`/2/cardlist`；
//      - 卡片结构里不仅有 `elements` / `card_group`，还有 `card_type = 216 / 208 / 17 / 19 / 118`
//        内部的 `items`、`group`、`sub_item`、`menus`、`apps`、`title_extra_text`；
//      - 如果采用「黑名单猜名字」，微博随便换个词（如「任务中心」「成长中心」「签到领红包」
//        「超话社区活动」「微博小店」「今日福利」「热门服务」）就会漏出来！
//      - 现对「我的」页改为【严格核心功能白名单 + 深度清洗】：
//        当 `clean_ui=true`（默认开启）时，「我的」页只允许保留：
//          ① 顶部个人资料头像卡 (`profile_mine_header` / `userInfo` / `avatar`)
//          ② 基础四宫格 (`我的相册`、`我的赞/赞`、`收藏`、`浏览记录/历史记录`)
//          ③ 创作与账号管理 (`创作中心`、`草稿箱`、`客服`、`设置`)
//        其余一切「任务中心」「红包/签到」「我的钱包/借钱」「热门活动」「游戏/小说/商城/直播」
//        「推荐关注/为你推荐」卡片统统砍掉！
//   3) 首页信息流广告：
//      - 覆盖 `unread_hot_timeline`、`unread_friends_timeline`、`friends_timeline`、
//        `container_timeline`、`container_timeline_hot`、`container_timeline_unread`、`video/tiny_stream_*`；
//      - 识别 `promotion`、`ad_state`、`mblogtypename`、`readtimetype="adMblog"`、
//        `mblog_menus_new` 含 `ad_`、`actionlog` 含 `source="ad"` / `adid`、以及伪装成普通卡片的
//        `category="trend" / "card" / "group"` 推广块。
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

  // 兼容 wbpullad.lua 有时返回非纯 JSON（前导文本 + JSON）或标准 JSON
  let rawJson = body;
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    const idx = body.indexOf("{");
    const lastIdx = body.lastIndexOf("}");
    if (idx >= 0 && lastIdx > idx && /wbpullad\.lua/.test(url)) {
      rawJson = body.slice(idx, lastIdx + 1);
    } else {
      $done({});
      return;
    }
  }

  // 微博 mid / id 都是 16~19 位整数，用占位符保护字符串外的长整数。
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

  const path = url.split("?")[0];
  let changed = false;

  const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
  const nonEmptyObj = (v) => isObj(v) && Object.keys(v).length > 0;
  const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

  // ---------- 1. 微博单条状态 (mblog) 全方位广告判定 ----------
  const isAdMblog = (m) => {
    if (!isObj(m)) return false;
    if (truthy(m.is_ad) || truthy(m.ad_state) || truthy(m.isAd)) return true;
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
    if (m.readtimetype === "adMblog" || m.mblogtype === 1 && m.promotion) return true;
    const typeName = typeof m.mblogtypename === "string" ? m.mblogtypename : "";
    const mark = typeof m.mark === "string" ? m.mark : "";
    const titleText = isObj(m.title) && typeof m.title.text === "string" ? m.title.text : "";
    if (/广告|热推|推广|品牌|赞助|商业|精选推荐/.test(typeName)) return true;
    if (mark && /(?:^|[_|-])ad(?:$|[_|-])|^\d+_ad/i.test(mark)) return true;
    if (/广告|热推|商业推广|品牌推荐/.test(titleText)) return true;
    if (isObj(m.content_auth_info) && /广告|热推|推广|商业/.test(String(m.content_auth_info.content_auth_title || ""))) {
      return true;
    }
    // 右上角负反馈菜单里如果带 ad / 为什么看到此广告 (type === "ad" 或 params.crime_type === "ad")
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
    // 顺手剥离正常微博里的商业附加挂件（同款商品、微博小店横幅、正文顶栏营销）
    for (const k of ["common_struct", "ad_struct", "semantic_brand_params", "follow_data"]) {
      if (isObj(m[k]) || (Array.isArray(m[k]) && m[k].length)) {
        delete m[k];
        changed = true;
      }
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
    if (/^(?:ad|advert|feed_ad|trend_ad|hot_ad|banner_ad|recommend_ad|group_ad)$/i.test(cat)) return true;

    // 信息流里夹杂的横幅 / 推荐关注 / 商业卡片块 (trend / card)
    const d = isObj(item.data) ? item.data : item;
    if (truthy(d.is_ad) || nonEmptyObj(d.promotion) || nonEmptyObj(d.ad_data) || nonEmptyObj(d.ad_info)) return true;
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

  // ---------- 2. 发现页 / 热搜 / 通用卡片 (card / card_group) 广告判定 ----------
  const isAdCard = (card) => {
    if (!isObj(card)) return false;
    if (truthy(card.is_ad) || truthy(card.ad_state) || nonEmptyObj(card.promotion) || nonEmptyObj(card.ad_data)) {
      return true;
    }
    if (card.card_type === 22 || (card.card_type === 118 && (card.is_ad || card.promotion))) return true;
    if (isObj(card.mblog) && isAdMblog(card.mblog)) return true;
    // 热搜词条里的「商」「广告」「热推」「品牌」商业角标
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
    if (c.type === 1 && (c.adType || (isObj(c.data) && (c.data.is_ad || c.data.adType || c.data.promotion)))) {
      return true;
    }
    if (c.comment_type === "ad" || c.type === "ad") return true;
    if (isObj(c.data) && isAdComment(c.data)) return true;
    return false;
  };

  // ---------- 4. 「我的」页 (/2/profile/me 及 container_timeline) 白名单级深度净化 ----------
  // 任何宫格或列表项，名字/文案命中黑名单关键词（含「任务中心」「中心」「签到」「红包」等）一律干掉；
  // 并且当 cleanUi=true 时，宫格按钮只放行核心用户功能白名单！
  const PROFILE_TRASH_TEXT_RE =
    /任务中心|任务|签到|红包|领钱|提现|金币|积分|福利|抽奖|夺宝|借钱|微贷|贷款|分期|白条|信用卡|办卡|理财|保险|钱包|优惠券|省钱|卡券|会员|SVIP|VIP|游戏|小游戏|游民|电竞|商城|好物|种草|潮物|小店|橱窗|直播|连麦|语聊|相亲|交友|找对象|测试|运势|星座|算命|塔罗|占卜|小说|漫画|故事|短剧|听书|免流量|王卡|流量|网盘|彩铃|壁纸|表情|装扮|皮肤|挂件|公益|推广|热推|活动|推荐服务|更多服务|热门服务|我的服务|成长|等级|勋章|超话社区|粉丝群|认证/;

  // 核心功能白名单：个人资料、我的相册/赞/收藏/历史记录、创作中心/草稿箱、客服、设置、关注/粉丝列表
  const PROFILE_CORE_WHITE_RE =
    /^(?:我的相册|相册|我的赞|赞|我的收藏|收藏|浏览记录|历史记录|浏览历史|足迹|草稿箱|草稿|创作中心|创作者中心|客服|客服中心|帮助与反馈|设置|夜间模式|深色模式|屏蔽管理|内容管理|我的关注|关注|我的粉丝|粉丝|我的微博|微博)$/;

  const getEntryTitle = (obj) => {
    if (!isObj(obj)) return "";
    const d = isObj(obj.data) ? obj.data : obj;
    for (const k of ["title_sub", "title", "name", "desc", "card_type_name", "text", "main_title", "sub_title"]) {
      if (typeof d[k] === "string" && d[k].trim()) return d[k].trim();
      if (typeof obj[k] === "string" && obj[k].trim()) return obj[k].trim();
    }
    return "";
  };

  const isHeaderOrUserCard = (item) => {
    if (!isObj(item)) return false;
    const d = isObj(item.data) ? item.data : item;
    const itemId = String(item.itemId || item.itemid || d.itemid || d.card_id || "");
    if (/header|userinfo|user_info|avatar|profile_top|mine_info/i.test(itemId)) return true;
    if (isObj(d.user) && (d.user.id || d.user.screen_name)) return true;
    if (d.card_type === 1 || d.card_type === 200 || d.card_type === 201) return true;
    return false;
  };

  // 清洗宫格菜单数组（elements / items / menus / apps / group / entrances / sub_item）
  const cleanProfileGridList = (list) => {
    if (!Array.isArray(list) || !list.length) return list;
    return list.filter((entry) => {
      if (!isObj(entry)) return false;
      const d = isObj(entry.data) ? entry.data : entry;
      if (isAdCard(d) || isAdTimelineItem(entry)) return false;
      const title = getEntryTitle(entry);
      const scheme = String(d.scheme || entry.scheme || "");
      const itemId = String(entry.itemId || entry.itemid || d.itemid || "");

      // 明确在核心白名单里的保留
      if (title && PROFILE_CORE_WHITE_RE.test(title)) return true;

      // 命中任务中心/钱包/游戏/活动黑名单的直接杀
      if (title && PROFILE_TRASH_TEXT_RE.test(title)) return false;
      if (
        /(?:task|checkin|sign|wallet|finance|loan|borrow|game|mall|shop|store|novel|book|comic|live|vip|welfare|lottery|redpacket|activity|ad|banner|kingcard|free_traffic)/i.test(
          scheme + " " + itemId
        )
      ) {
        return false;
      }

      // cleanUi 开启时，对于带标题的宫格入口，不在核心白名单里的一律过滤（彻底杜绝换名营销入口）
      if (cleanUi && title) {
        return PROFILE_CORE_WHITE_RE.test(title);
      }
      return true;
    });
  };

  const GRID_KEYS = ["elements", "items", "menus", "entrances", "group", "sub_item", "apps", "buttons", "list"];

  const cleanProfileItems = (list) => {
    if (!Array.isArray(list) || !list.length) return null;
    const out = [];
    let modified = false;

    for (const item of list) {
      if (!isObj(item)) continue;

      // 1. 顶部个人头像与账号资料卡无条件保留（但剥离上面的 VIP 诱导角标/背景广告）
      if (isHeaderOrUserCard(item)) {
        const d = isObj(item.data) ? item.data : item;
        for (const k of ["vip_center", "vip_info", "ad_info", "banner", "pendant", "checkin_info", "task_info", "right_button"]) {
          if (d[k] !== undefined) {
            delete d[k];
            modified = true;
          }
        }
        out.push(item);
        continue;
      }

      // 2. 广告卡片直接干掉
      if (isAdTimelineItem(item) || isAdCard(item)) {
        modified = true;
        continue;
      }
      const d = isObj(item.data) ? item.data : item;
      if (isAdCard(d)) {
        modified = true;
        continue;
      }

      const itemId = String(item.itemId || item.itemid || d.itemid || d.card_id || "");
      const title = getEntryTitle(item);
      const ct = Number(d.card_type || item.card_type || 0);

      // 3. 轮播图 (118)、大图横幅 (22 / 208 / 196 / 89 / 216 活动卡) 或命中黑名单标题/ID 的整卡删除
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

      // 4. 递归清理容器内部的 card_group 与 item.items
      let hadChildContainer = false;
      let hasSurvivingChildren = false;

      if (Array.isArray(item.items) && item.items.length) {
        hadChildContainer = true;
        // 判断 item.items 是卡片容器还是宫格按钮列表
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

      // 5. 清洗卡片内的宫格字段 (elements / menus / group / sub_item / apps 等)
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

      // 如果这个卡片本来是个宫格/分组容器，里面的按钮全被删光了，就把空壳子也删掉
      if (hadChildContainer && !hasSurvivingChildren) {
        modified = true;
        continue;
      }

      // 如果是单条入口卡片（既不是容器也没子项），在 cleanUi 模式下必须命中核心白名单才保留
      if (cleanUi && !hadChildContainer && title && !PROFILE_CORE_WHITE_RE.test(title)) {
        modified = true;
        continue;
      }

      out.push(item);
    }

    return modified ? out : null;
  };

  // 过滤普通数组；若删完为空且 allowEmpty=false 则保留原数组
  const filterList = (holder, key, predicate, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = list.filter((x) => !isObj(x) || !predicate(x));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
    }
  };

  // 递归清理发现页 / 热搜 / cardlist 的 cards 及其内部的 card_group
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
          if (!groupKept.length) {
            continue;
          }
          card.card_group = groupKept;
        }
      }
      if (isObj(card.data) && Array.isArray(card.data.card_group) && card.data.card_group.length) {
        const groupKept = card.data.card_group.filter((g) => !isObj(g) || (!isAdCard(g) && !isAdTimelineItem(g)));
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
    // 1. 开屏与冷启动配置 (/wbapplua/wbpullad.lua, /2/push/active, /2/client/*, /2/checkin/*)
    if (/\/wbapplua\/wbpullad\.lua$|\/2\/push\/active$|\/2\/client\/|\/2\/checkin\//.test(path)) {
      if (blockAds) {
        const FUTURE = 2208960000;
        const holders = [data, data.cached_ad, data.data];
        for (const h of holders) {
          if (!isObj(h)) continue;
          for (const k of ["ads", "ad_list", "ads_list", "feed_ads", "tips", "float_ad", "popup", "checkin_info"]) {
            if (Array.isArray(h[k]) && h[k].length) {
              for (const ad of h[k]) {
                if (!isObj(ad)) continue;
                ad.start_date = FUTURE;
                ad.end_date = FUTURE + 86400;
                ad.display_duration = 0;
              }
              h[k] = [];
              changed = true;
            } else if (isObj(h[k]) && Object.keys(h[k]).length) {
              delete h[k];
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

    // 2. 时间线与视频流 (/2/statuses/*, /2/groups/timeline, /2/video/*)
    if (/\/2\/(?:statuses\/|groups\/timeline|video\/)/.test(path)) {
      if (blockAds) {
        for (const holder of [data, data.data]) {
          if (!isObj(holder)) continue;
          filterList(holder, "statuses", isAdTimelineItem);
          filterList(holder, "items", isAdTimelineItem);
          filterList(holder, "trends", isAdTimelineItem, true);
          cleanCardArray(holder, "cards");
          for (const k of ["advertises", "ad", "ads", "feed_ads", "top_cards", " trend"]) {
            if (Array.isArray(holder[k]) && holder[k].length) {
              holder[k] = [];
              changed = true;
            }
          }
        }
        // 详情页 extend 接口里的推广横幅与商品卡
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
          ]) {
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
        for (const k of ["comment_bubble", "ad_info", "header_info", "top_cards", "trend"]) {
          if (data[k] !== undefined && data[k] !== null) {
            if (k === "header_info" && isObj(data[k]) && !data[k].is_ad && !data[k].ad_type) continue;
            delete data[k];
            changed = true;
          }
        }
      }
    }

    // 4. 「我的」页与个人页 (/2/profile/*, /2/users/show, 以及带 mine / profile / 100505 的 /2/page 与 /2/cardlist)
    const isProfileUrl =
      /\/2\/(?:profile\/|users\/show)/.test(path) ||
      (/\/2\/(?:page|cardlist)$/.test(path) && /(?:mine|profile|100505|user)/i.test(url)) ||
      isObj(data.vip_center) ||
      (Array.isArray(data.items) && data.items.some((x) => isObj(x) && /profile_mine|mine_/.test(String(x.itemId || x.itemid || ""))));

    if (isProfileUrl) {
      if (blockAds || cleanUi) {
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
          for (const arrKey of ["items", "cards", "card_group", "service_list", "menus"]) {
            if (Array.isArray(holder[arrKey]) && holder[arrKey].length) {
              const cleaned = cleanProfileItems(holder[arrKey]);
              if (cleaned) {
                holder[arrKey] = cleaned;
                changed = true;
              }
            }
          }
          filterList(holder, "statuses", isAdTimelineItem);
        }
      }
    } else if (/\/2\/(?:search\/|page$|cardlist$|container\/)/.test(path)) {
      // 5. 发现页、热搜与通用卡片流 (/2/search/*, /2/page, /2/cardlist, /2/container/*)
      if (blockAds) {
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
