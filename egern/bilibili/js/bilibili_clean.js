// BiliBili Clean — Loon / Egern.
//
// 只做四件事：去广告、去会员推广、去遥测（遥测在模块规则里 REJECT）、自动最高画质
// （画质在 bilibili_quality.js 里改请求）。
//
// 广告和会员推广都在 JSON 里，按结构删，不做全量重编码：
//
//   /x/v2/splash/*            开屏：清空 list / event_list / brand_list
//   /x/v2/feed/index*         首页：只过滤 data.items 里 card_type=cm_* / card_goto=ad_* / goto=ad 的卡片
//   /x/v2/search/square       搜索：只过滤 data 数组里的广告项
//   /x/web-interface/wbi/...  网页推荐流：只过滤 data.item 里 goto=ad 的条目
//   /x/vip/ads/materials      大会员广告素材：清空
//   /pgc/view/v2/app/season   番剧页：删 data.payment（会员付费块）
//   /pgc/page/bangumi         番剧页模块：删 module_style/type 为 ad 的模块
//   /xlive/app-interface/v2/index/feed  直播首页：只删 small_card_v1 里的广告卡
//   /xlive/app-interface/v2/room/recList 直播推荐：同上
//   /xlive/app-room/v1/index/getInfoByRoom 房间页：只删 banner / 购物位，不碰房间信息
//   /pgc/activity/.../receive 番剧弹窗广告：返回关闭
//
// 只处理上面这些接口，形状对不上就原样放行，最差是不生效，不会把播放改坏。

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || {};
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = res.url || req.url || "";

  // Loon 传位置数组或对象，Egern 传 JSON 字符串，三种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0], hide_vip: raw[1], verbose_log: raw[2] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const blockAds = flag(opt.block_ads, true);
  const hideVip = flag(opt.hide_vip, true);
  const verbose = flag(opt.verbose_log, false);
  // 用 warn 级别输出：info 一多就刷没了，warn 在日志里更好找。
  const log = (msg) => {
    if (!verbose) return;
    const line = "bilibili: " + msg;
    if ("function" == typeof console.warn) console.warn(line);
    else console.log(line);
  };

  const body = res.body;
  if (typeof body !== "string" || !body) {
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
  if (!data || typeof data !== "object") {
    $done({});
    return;
  }

  const path = url.split("?")[0];
  let changed = false;

  // 只处理下面这些接口；模块正则之外万一命中，也原样放行。
  const handled =
    path.indexOf("/x/v2/splash/") >= 0 ||
    path.indexOf("/x/v2/feed/index") >= 0 ||
    path.indexOf("/x/v2/search/square") >= 0 ||
    path.indexOf("/x/web-interface/wbi/index/top/feed/rcmd") >= 0 ||
    path.indexOf("/x/vip/ads/materials") >= 0 ||
    path.indexOf("/pgc/view/v2/app/season") >= 0 ||
    path.indexOf("/pgc/page/") >= 0 ||
    path.indexOf("/pgc/activity/deliver/material/receive") >= 0 ||
    path.indexOf("/xlive/") >= 0;
  if (!handled) {
    $done({});
    return;
  }

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const str = (v) => (typeof v === "string" ? v.toLowerCase() : "");

  // 信息流广告的判定，和上游 Biliverse 完全一致：只认这几个标记，
  // 不做全树遍历，避免把直播 tab、配置块这类正常对象误删。
  const isFeedAd = (o) => {
    if (!isObj(o)) return false;
    const ct = "string" == typeof o.card_type ? o.card_type : "";
    const cg = "string" == typeof o.card_goto ? o.card_goto : "";
    return ct.indexOf("cm_") === 0 || cg.indexOf("ad_") === 0 || o.goto === "ad" || o.is_ad === true;
  };

  const keepNotAd = (arr) => {
    if (!Array.isArray(arr)) return null;
    const kept = arr.filter((item) => !isFeedAd(item));
    return kept.length === arr.length ? null : kept;
  };

  // 直播卡片的广告标记：is_ad / show_ad_icon / ad_transparent_content。
  const truthyFlag = (v) => v === true || v === 1 || v === "1";
  const isLiveCardAd = (o) => {
    if (!isObj(o)) return false;
    const mark = o.ad_transparent_content;
    const transparent =
      "string" == typeof mark ? mark.trim().length > 0 : isObj(mark) ? Object.keys(mark).length > 0 : Boolean(mark);
    return truthyFlag(o.is_ad) || truthyFlag(o.show_ad_icon) || transparent;
  };

  const clearArray = (obj, key) => {
    if (isObj(obj) && Array.isArray(obj[key]) && obj[key].length) {
      obj[key] = [];
      changed = true;
    }
  };

  // 番剧弹窗广告：直接给一个「关闭」的合法响应。
  if (path.indexOf("/pgc/activity/deliver/material/receive") >= 0) {
    const out = JSON.stringify({
      code: 0,
      data: { closeType: "close_win", container: [], showTime: "" },
      message: "success",
    });
    log("pgc material -> close");
    $done({ body: out });
    return;
  }

  // 开屏：把几个已知数组清空。
  if (path.indexOf("/x/v2/splash/") >= 0) {
    const d = data.data;
    if (isObj(d)) {
      ["list", "event_list", "brand_list", "show"].forEach((k) => clearArray(d, k));
    } else if (Array.isArray(d) && d.length) {
      data.data = [];
      changed = true;
    }
  }

  // 大会员广告素材。
  if (path.indexOf("/x/vip/ads/materials") >= 0) {
    const d = data.data;
    if (isObj(d)) {
      ["materials", "list", "items"].forEach((k) => clearArray(d, k));
    } else if (Array.isArray(d) && d.length) {
      data.data = [];
      changed = true;
    }
  }

  // 番剧页的会员付费块。
  if (path.indexOf("/pgc/view/v2/app/season") >= 0 && isObj(data.data) && data.data.payment) {
    delete data.data.payment;
    changed = true;
  }

  // 直播：只按上游的三个接口定点处理。通用 walk 会顺着对象树把
  // room_info / playurl_info 里带广告字段的正常对象也删掉，导致直播打不开。
  const isLive = path.indexOf("/xlive/") >= 0;
  if (isLive && blockAds) {
    const d = isObj(data.data) ? data.data : {};
    if (path.indexOf("/xlive/app-interface/v2/index/feed") >= 0 && Array.isArray(d.card_list)) {
      const kept = d.card_list.filter((card) => !isLiveCardAd(card?.card_data?.small_card_v1));
      if (kept.length !== d.card_list.length) {
        d.card_list = kept;
        changed = true;
      }
    } else if (path.indexOf("/xlive/app-interface/v2/room/recList") >= 0 && Array.isArray(d.list)) {
      const kept = d.list.filter((card) => !isLiveCardAd(card));
      if (kept.length !== d.list.length) {
        d.list = kept;
        changed = true;
      }
    } else if (path.indexOf("/xlive/app-room/v1/index/getInfoByRoom") >= 0) {
      // 房间页只删 banner 和购物位，其余一律不碰。
      if ("activity_banner_info" in d) {
        delete d.activity_banner_info;
        changed = true;
      }
      if (isObj(d.shopping_info) && 0 !== d.shopping_info.is_show) {
        d.shopping_info = { is_show: 0 };
        changed = true;
      }
      const outer = d.new_tab_info?.outer_list;
      if (Array.isArray(outer)) {
        const kept = outer.filter((item) => 33 !== item?.biz_id);
        if (kept.length !== outer.length) {
          d.new_tab_info.outer_list = kept;
          changed = true;
        }
      }
    }
  }

  // 首页 / 推荐：只过滤 data.items，和上游一致。
  if (blockAds && path.indexOf("/x/v2/feed/index") >= 0) {
    const kept = keepNotAd(data.data?.items);
    if (kept) {
      data.data.items = kept;
      changed = true;
    }
  }

  // 网页版推荐流：只过滤 data.item 里 goto=ad 的条目。
  if (blockAds && path.indexOf("/x/web-interface/wbi/index/top/feed/rcmd") >= 0) {
    const kept = keepNotAd(data.data?.item);
    if (kept) {
      data.data.item = kept;
      changed = true;
    }
  }

  // 搜索广场：data 本身就是数组，只过滤广告项。
  if (blockAds && path.indexOf("/x/v2/search/square") >= 0) {
    const kept = keepNotAd(data.data);
    if (kept) {
      data.data = kept;
      changed = true;
    }
  }

  // 番剧页的广告模块（module_style / module_type / type 为 ad）。
  if (path.indexOf("/pgc/page/") >= 0) {
    const d = data.data;
    if (isObj(d) && Array.isArray(d.modules)) {
      const kept = d.modules.filter((m) => {
        if (!isObj(m)) return true;
        const style = str(m.module_style);
        const type = str(m.module_type) || str(m.type);
        const ad = style === "ad" || style.indexOf("ad_") === 0 || type === "ad" || type.indexOf("ad_") === 0;
        if (ad) changed = true;
        return !ad;
      });
      d.modules = kept;
    }
  }

  if (!changed) {
    $done({});
    return;
  }

  const out = JSON.stringify(data);
  if (out === body) {
    $done({});
    return;
  }
  log(body.length + " -> " + out.length);
  $done({ body: out });
})();
