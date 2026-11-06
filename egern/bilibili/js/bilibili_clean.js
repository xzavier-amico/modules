// BiliBili Clean — Loon / Egern.
//
// 只做四件事：去广告、去会员推广、去遥测（遥测在模块规则里 REJECT）、自动最高画质
// （画质在 bilibili_quality.js 里改请求）。
//
// 广告和会员推广都在 JSON 里，按结构删，不做全量重编码：
//
//   /x/v2/splash/*            开屏：清空 list / event_list / brand_list
//   /x/v2/feed/index*         首页：删 card_type=ad、card_goto=ad、ad_info 非空的卡片
//   /x/v2/search/square       搜索：同上
//   /x/web-interface/wbi/...  网页推荐流：同上
//   /x/vip/ads/materials      大会员广告素材：清空
//   /pgc/view/v2/app/season   番剧页：删 data.payment（会员付费块）
//   /pgc/page/bangumi         番剧页模块：删 module_style/type 为 ad 的模块
//   /xlive/...                直播推荐：删广告卡
//   /pgc/activity/.../receive 番剧弹窗广告：返回关闭
//
// 只处理上面这些接口，形状对不上就原样放行，最差是不生效，不会把播放改坏。

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || {};
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = res.url || req.url || "";

  let opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const blockAds = flag(opt.block_ads, true);
  const hideVip = flag(opt.hide_vip, true);
  const verbose = flag(opt.verbose_log, false);
  const log = (msg) => {
    if (verbose) console.log("bilibili: " + msg);
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

  const adCard = (o) => {
    if (!isObj(o)) return false;
    const ct = str(o.card_type);
    const cg = str(o.card_goto);
    const go = str(o.goto);
    if (ct === "ad" || ct.indexOf("ad_") === 0 || ct.indexOf("ad-") === 0) return true;
    if (cg === "ad" || go === "ad") return true;
    if (o.ad_info && (typeof o.ad_info !== "object" || Object.keys(o.ad_info).length > 0)) return true;
    if (o.is_ad === true || o.is_ad === 1) return true;
    return false;
  };

  const vipCard = (o) => {
    if (!isObj(o)) return false;
    const ct = str(o.card_type);
    const cg = str(o.card_goto);
    const go = str(o.goto);
    return ct === "vip" || cg === "vip" || go === "vip" || ct.indexOf("vip_") === 0;
  };

  const dropItem = (o) => (blockAds && adCard(o)) || (hideVip && vipCard(o));

  // 只过滤数组元素，不改对象键，避免把正常字段删掉。
  function walk(node) {
    if (Array.isArray(node)) {
      const out = [];
      for (const item of node) {
        if (isObj(item) && dropItem(item)) {
          changed = true;
          continue;
        }
        out.push(walk(item));
      }
      return out;
    }
    if (isObj(node)) {
      for (const key of Object.keys(node)) node[key] = walk(node[key]);
    }
    return node;
  }

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

  // 其余接口：递归删广告卡 / 会员卡。
  if (blockAds || hideVip) {
    data = walk(data);
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
