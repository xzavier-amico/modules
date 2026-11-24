//=======================================================================================
// Delivery Clean — 美团 / 京东 / 饿了么 JSON 清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// Shadowrocket 运行时兼容层。
//
// 只拼接到 shadowrocket/ 下的成品；Loon / Egern 自带这些 API，不会加载本文件。
// 全部按需安装：已有原生实现时整段跳过，不覆盖更快的原生版本。

if ("undefined" == typeof TextEncoder) {
  globalThis.TextEncoder = function () {};
  TextEncoder.prototype.encode = function (s) {
    s = String(s);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) {
          c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
          i++;
        }
      }
      if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  };
}

if ("undefined" == typeof TextDecoder) {
  globalThis.TextDecoder = function (label, options) {
    this.fatal = !!(options && options.fatal);
  };
  TextDecoder.prototype.decode = function (input) {
    const b = input instanceof Uint8Array ? input : new Uint8Array(input || []);
    let out = "";
    for (let i = 0; i < b.length; ) {
      const start = i;
      const first = b[i++];
      let cp = 0;
      let need = 0;
      if (first < 0x80) cp = first;
      else if (first >= 0xc2 && first <= 0xdf) {
        cp = first & 0x1f;
        need = 1;
      } else if (first >= 0xe0 && first <= 0xef) {
        cp = first & 0x0f;
        need = 2;
      } else if (first >= 0xf0 && first <= 0xf4) {
        cp = first & 7;
        need = 3;
      } else need = -1;
      let ok = need >= 0 && i + need <= b.length;
      for (let k = 0; ok && k < need; k++) {
        if ((b[i + k] & 0xc0) !== 0x80) ok = false;
        else cp = (cp << 6) | (b[i + k] & 63);
      }
      if (ok && need === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) ok = false;
      if (ok && need === 3 && (cp < 0x10000 || cp > 0x10ffff)) ok = false;
      if (!ok) {
        if (this.fatal) throw new TypeError("invalid utf-8");
        out += "\ufffd";
        i = start + 1;
        continue;
      }
      i += need;
      if (cp > 0xffff) {
        cp -= 0x10000;
        out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 1023));
      } else {
        out += String.fromCharCode(cp);
      }
    }
    return out;
  };
}

if ("undefined" == typeof Object.hasOwn) {
  Object.hasOwn = function (object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  };
}

// Uint8Array.fromBase64 / toBase64 是较新的 API，部分 Shadowrocket 的 JSC 没有。
// 这里补标准 base64（带填充），并保留命名函数供冒烟测试直接调用。
function shadowrocketBase64From(text) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const clean = String(text)
    .replace(/[-_]/g, (ch) => (ch === "-" ? "+" : "/"))
    .replace(/[^A-Za-z0-9+/]/g, "");
  const out = [];
  for (let i = 0; i < clean.length; i += 4) {
    const a = chars.indexOf(clean.charAt(i));
    const b = chars.indexOf(clean.charAt(i + 1));
    const c = chars.indexOf(clean.charAt(i + 2));
    const d = chars.indexOf(clean.charAt(i + 3));
    const n = (a << 18) | ((b & 63) << 12) | ((c & 63) << 6) | (d & 63);
    out.push((n >> 16) & 255);
    if (i + 2 < clean.length) out.push((n >> 8) & 255);
    if (i + 3 < clean.length) out.push(n & 255);
  }
  return new Uint8Array(out);
}

function shadowrocketBase64To(bytes) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += chars.charAt(b0 >> 2);
    out += chars.charAt(((b0 & 3) << 4) | (b1 >> 4));
    out += i + 1 < bytes.length ? chars.charAt(((b1 & 15) << 2) | (b2 >> 6)) : "=";
    out += i + 2 < bytes.length ? chars.charAt(b2 & 63) : "=";
  }
  return out;
}

if ("undefined" == typeof Uint8Array.fromBase64) {
  Uint8Array.fromBase64 = shadowrocketBase64From;
}
if ("undefined" == typeof Uint8Array.prototype.toBase64) {
  Uint8Array.prototype.toBase64 = function () {
    return shadowrocketBase64To(this);
  };
}

//=======================================================================================
// Delivery Clean — 美团、饿了么、京东开屏与信息流广告清理
//
// 只处理「业务数据里夹着广告位」的接口；纯广告下发与上报接口交给模块里的 URL Rewrite / Domain Rules。
// 所有改写都按结构删数组元素或字段，不做盲目全树递归，避免破坏正常商品、店铺与订单数据：
//
//   京东 (api.m.jd.com)
//     functionId=start / home_launchConfig / splash
//       开屏：清空 images / ads / data 或把投放窗口推到 2040 年
//     functionId=welcomeHome
//       首页：删 floatLayer / xview / topAtmosphere / shimmer 等弹窗浮层，过滤 floorList 里的广告楼层
//     functionId=personinfoBusiness
//       我的：过滤 floors 里的广告楼层；clean_ui 打开时额外删白条 / 金条 / 借钱等金融营销楼层
//     functionId=search / uniformRecommend / wareBusiness / feed
//       搜索与推荐：过滤 wareInfo / list / data 里带 adIcon / isAd / adword / p4p 的推广商品
//
//   美团 (wmapi.meituan.com / apimobile.meituan.com / mapi.meituan.com / wx.waimai.meituan.com)
//     /api/v<n>/startpicture / loadInfo / openscreen / splash
//       开屏：清空 ad / startup / plat_ads / splash_list，或把起止时间推到 2040 年
//     外卖与主站信息流 (poilist / module_list / card_list / items / feed)
//       删 is_ad / ad_mark / ad_type / charge_info (CPC/CPM 计费串) / adInfo / biz_type="ad" 的推广店铺与卡片
//       清 activity_banner / ad_banner / floating_layer / popup_info 等运营横幅与弹窗
//
//   饿了么 (waimai-guide.ele.me / acs.m.taobao.com)
//     首页与推荐信息流：过滤 items / list / modules 里带 is_ad / ad_data / brand_ad / is_p4p / p4p_data 的推广条目
//     清 float_ad / popup_ad / banner_ad 等浮层与横幅
//
// 保护字符串外的 16+ 位整数（订单号、SKU ID、traceId），防止 JSON.parse 丢精度。
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
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    $done({});
    return;
  }

  // 外卖与电商响应普遍带 16~19 位订单号、SKU ID、shopId；
  // 先用占位符保护字符串外的 16+ 位整数，JSON.stringify 后再原样还原，既不早退也不丢精度。
  const BIGINT_MARK = "__dlv_bigint_";
  let hasBigInt = false;
  const safeBody = body.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
    if (!num) return m;
    hasBigInt = true;
    return '"' + BIGINT_MARK + num + '"';
  });

  let root;
  try {
    root = JSON.parse(safeBody);
  } catch (e) {
    $done({});
    return;
  }
  if (!isObj(root)) {
    $done({});
    return;
  }

  let changed = false;

  const truthy = (v) => v === true || v === 1 || v === "1" || v === "true";
  const nonEmptyObj = (v) => isObj(v) && Object.keys(v).length > 0;
  const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

  // 清空容器字段但保持原类型（数组→[]、对象→{}），避免客户端反序列化报类型错误。
  const clearSlot = (holder, key) => {
    if (!isObj(holder) || !Object.prototype.hasOwnProperty.call(holder, key)) return;
    const val = holder[key];
    if (Array.isArray(val)) {
      if (val.length) {
        holder[key] = [];
        changed = true;
      }
    } else if (isObj(val)) {
      if (Object.keys(val).length) {
        holder[key] = {};
        changed = true;
      }
    } else if (typeof val === "string" && val) {
      holder[key] = "";
      changed = true;
    }
  };

  const dropKeys = (holder, keys) => {
    if (!isObj(holder)) return;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(holder, key) && holder[key] !== undefined && holder[key] !== null) {
        delete holder[key];
        changed = true;
      }
    }
  };

  // 过滤数组元素；若整页都会被删空则保留原数组，防止客户端报「没有更多内容」或白屏。
  const filterArray = (holder, key, isAdFn) => {
    if (!isObj(holder) || !Array.isArray(holder[key])) return;
    const list = holder[key];
    if (!list.length) return;
    const kept = list.filter((item) => !isObj(item) || !isAdFn(item));
    if (kept.length && kept.length !== list.length) {
      holder[key] = kept;
      changed = true;
    }
  };

  // 把开屏素材的投放时间推到 2040 年（秒或毫秒自适应），让客户端判定素材尚未生效。
  const FUTURE_SEC = 2208960000;
  const FUTURE_MS = 2208960000000;
  const expireSplashItem = (ad) => {
    if (!isObj(ad)) return;
    for (const k of ["startTime", "start_time", "beginTime", "begin_time", "onlineTime", "online_time", "valid_from"]) {
      if (typeof ad[k] === "number") {
        ad[k] = ad[k] > 1e11 ? FUTURE_MS : FUTURE_SEC;
        changed = true;
      } else if (typeof ad[k] === "string" && /^\d{10,13}$/.test(ad[k])) {
        ad[k] = ad[k].length > 10 ? String(FUTURE_MS) : String(FUTURE_SEC);
        changed = true;
      }
    }
    for (const k of ["endTime", "end_time", "expireTime", "expire_time", "offlineTime", "offline_time", "valid_to"]) {
      if (typeof ad[k] === "number") {
        ad[k] = ad[k] > 1e11 ? FUTURE_MS + 86400000 : FUTURE_SEC + 86400;
        changed = true;
      } else if (typeof ad[k] === "string" && /^\d{10,13}$/.test(ad[k])) {
        ad[k] = ad[k].length > 10 ? String(FUTURE_MS + 86400000) : String(FUTURE_SEC + 86400);
        changed = true;
      }
    }
    for (const k of ["showTimes", "show_times", "duration", "display_time", "stay_time", "dwellTime"]) {
      if (typeof ad[k] === "number" && ad[k] !== 0) {
        ad[k] = 0;
        changed = true;
      }
    }
  };

  // ---------- 通用与平台特定广告条目判定 ----------
  const isDeliveryAdItem = (item) => {
    if (!isObj(item)) return false;
    // 1. 显式布尔/数值广告标记
    if (
      truthy(item.is_ad) ||
      truthy(item.isAd) ||
      truthy(item.ad_mark) ||
      truthy(item.adMark) ||
      truthy(item.is_p4p) ||
      truthy(item.isP4p) ||
      truthy(item.ad_flag) ||
      truthy(item.brand_ad)
    ) {
      return true;
    }
    // 2. 美团 CPC/CPM 计费与推广字段
    if (
      nonEmptyStr(item.charge_info) ||
      nonEmptyObj(item.charge_info) ||
      nonEmptyObj(item.ad_info) ||
      nonEmptyObj(item.adInfo) ||
      nonEmptyObj(item.ad_data) ||
      nonEmptyObj(item.adData) ||
      nonEmptyObj(item.p4p_data) ||
      nonEmptyObj(item.ads_info)
    ) {
      return true;
    }
    if (typeof item.ad_type === "number" && item.ad_type > 0) return true;
    if (typeof item.adType === "number" && item.adType > 0) return true;
    if ((item.ad_type || item.adType) && (item.ad_id || item.adId)) return true;
    // 3. 京东商品流与楼层广告标记
    if (nonEmptyStr(item.adIcon) || nonEmptyStr(item.adword) || nonEmptyStr(item.extension_id)) return true;
    // 4. 卡片类型标记
    const ct = String(item.card_type || item.cardType || item.biz_type || item.bizType || item.module_type || "");
    if (/^(?:ad|advert|ad[_-]|p4p|commercial|brand_ad|cpm_ad|cpc_ad)/i.test(ct)) return true;
    // 5. 嵌套在 item.poi / item.data / item.item 里的外卖店铺广告标记
    const inner = isObj(item.poi) ? item.poi : isObj(item.data) ? item.data : null;
    if (inner) {
      if (
        truthy(inner.is_ad) ||
        truthy(inner.isAd) ||
        truthy(inner.ad_mark) ||
        truthy(inner.is_p4p) ||
        nonEmptyStr(inner.charge_info) ||
        nonEmptyObj(inner.ad_info) ||
        nonEmptyObj(inner.ad_data) ||
        (typeof inner.ad_type === "number" && inner.ad_type > 0)
      ) {
        return true;
      }
    }
    return false;
  };

  // 京东首页与「我的」楼层判定
  const JD_AD_FLOOR_RE = /^(?:ad|advert|float|xview|shimmer|popup|banner_ad|commercial|hot_ad)/i;
  const JD_FINANCE_FLOOR_RE = /baitiao|jintiao|jdpay_loan|borrow|credit_loan|xiaojinku|finance_loan|白条|金条|借钱/i;

  const isJdFloorAd = (floor) => {
    if (!isObj(floor)) return false;
    if (blockAds && isDeliveryAdItem(floor)) return true;
    const identity = [
      floor.mId,
      floor.bId,
      floor.refId,
      floor.type,
      floor.floorName,
      floor.showName,
      floor.labelName,
    ]
      .filter((x) => typeof x === "string")
      .join(" ");
    if (blockAds && JD_AD_FLOOR_RE.test(identity)) return true;
    if (cleanUi && JD_FINANCE_FLOOR_RE.test(identity)) return true;
    return false;
  };

  try {
    // =========================================================================
    // 1. 京东 (api.m.jd.com)
    // =========================================================================
    if (/\.jd\.com/i.test(url)) {
      const fnMatch = /[?&]functionId=([^&]+)/i.exec(url);
      const fn = fnMatch ? decodeURIComponent(fnMatch[1]) : "";

      // 开屏与启动图
      if (blockAds && /^(?:start|home_launchConfig|splash|getLoadingLinks)/i.test(fn)) {
        for (const k of ["images", "ads", "adList", "splashList", "list", "data"]) {
          if (Array.isArray(root[k])) {
            for (const item of root[k]) expireSplashItem(item);
            clearSlot(root, k);
          }
        }
        if (isObj(root.data)) {
          for (const k of ["images", "ads", "adList", "splashList", "list"]) {
            if (Array.isArray(root.data[k])) {
              for (const item of root.data[k]) expireSplashItem(item);
              clearSlot(root.data, k);
            }
          }
        }
      }

      // 京东首页 welcomeHome
      if (/^welcomeHome$/i.test(fn)) {
        if (blockAds) {
          dropKeys(root, [
            "floatLayer",
            "topAtmosphere",
            "shimmer",
            "xview",
            "xviewList",
            "popup",
            "popupInfo",
            "pullDown",
            " ruleFloat",
          ]);
          if (isObj(root.searchBoxWords)) {
            clearSlot(root.searchBoxWords, "words");
          }
        }
        if (Array.isArray(root.floorList)) {
          filterArray(root, "floorList", isJdFloorAd);
        }
      }

      // 京东「我的」页 personinfoBusiness
      if (/^personinfoBusiness$/i.test(fn)) {
        if (blockAds) {
          dropKeys(root, ["floatLayer", "popupInfo", "xview", "plus Promotion", "plusPromotion"]);
        }
        if (Array.isArray(root.floors)) {
          filterArray(root, "floors", isJdFloorAd);
        }
      }

      // 京东搜索 / 推荐商品列表
      if (blockAds) {
        for (const holder of [root, root.data, root.result]) {
          if (!isObj(holder)) continue;
          for (const listKey of ["wareInfo", "wareList", "recommendList", "feedList", "items", "list", "paragraphs"]) {
            filterArray(holder, listKey, isDeliveryAdItem);
          }
        }
      }
    }

    // =========================================================================
    // 2. 美团 & 美团外卖 (*.meituan.com / *.sankuai.com)
    // =========================================================================
    if (/\.(?:meituan|sankuai)\.com/i.test(url)) {
      const isSplashUrl = /\/(?:startpicture|loadInfo|openscreen|splash|adBoard|startup)(?:[/?]|$)/i.test(url);
      if (blockAds && isSplashUrl) {
        for (const holder of [root, root.data]) {
          if (!isObj(holder)) continue;
          for (const k of ["ad", "ads", "startup", "plat_ads", "splash_list", "ad_list", "start_picture", "openscreen"]) {
            if (Array.isArray(holder[k])) {
              for (const item of holder[k]) expireSplashItem(item);
            }
            clearSlot(holder, k);
          }
        }
      }

      if (blockAds) {
        for (const holder of [root, root.data, isObj(root.data) ? root.data.data : null]) {
          if (!isObj(holder)) continue;
          // 清理顶部/悬浮运营广告块
          dropKeys(holder, [
            "ad_banner",
            "adBanner",
            "activity_banner",
            "floating_layer",
            "float_layer",
            "popup_info",
            "popup_ad",
            "platinum_banner",
            "mid_ad_banner",
            "top_banner_ad",
          ]);
          // 过滤商家列表与模块卡片列表里的 CPC/CPM 推广条目
          for (const listKey of ["poilist", "poi_list", "poiList", "module_list", "moduleList", "card_list", "cardList", "items", "list", "feeds", "feed_list", "recommend_list"]) {
            filterArray(holder, listKey, isDeliveryAdItem);
            // module_list 内部如果套了 items / poilist 也一并过滤
            if (Array.isArray(holder[listKey])) {
              for (const mod of holder[listKey]) {
                if (!isObj(mod)) continue;
                filterArray(mod, "items", isDeliveryAdItem);
                filterArray(mod, "poilist", isDeliveryAdItem);
                if (isObj(mod.data)) {
                  filterArray(mod.data, "items", isDeliveryAdItem);
                  filterArray(mod.data, "poilist", isDeliveryAdItem);
                  filterArray(mod.data, "list", isDeliveryAdItem);
                }
              }
            }
          }
        }
      }
    }

    // =========================================================================
    // 3. 饿了么 (*.ele.me / mtop.ele.*) & 通用兜底
    // =========================================================================
    if (blockAds) {
      for (const holder of [root, root.data, isObj(root.data) ? root.data.data : null, root.result]) {
        if (!isObj(holder)) continue;
        dropKeys(holder, [
          "float_ad",
          "popup_ad",
          "banner_ad",
          "ad_banners",
          "splash_ad",
          "top_ad",
          "bottom_ad",
        ]);
        for (const listKey of ["items", "list", "modules", "cards", "restaurants", "feeds", "recommend_list"]) {
          filterArray(holder, listKey, isDeliveryAdItem);
          if (Array.isArray(holder[listKey])) {
            for (const sub of holder[listKey]) {
              if (!isObj(sub)) continue;
              filterArray(sub, "items", isDeliveryAdItem);
              filterArray(sub, "list", isDeliveryAdItem);
              if (isObj(sub.data)) {
                filterArray(sub.data, "items", isDeliveryAdItem);
                filterArray(sub.data, "list", isDeliveryAdItem);
              }
            }
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

  let out = JSON.stringify(root);
  if (hasBigInt) {
    out = out.replace(new RegExp('"' + BIGINT_MARK + '(-?\\d+)"', "g"), "$1");
  }
  $done({ body: out });
})();
