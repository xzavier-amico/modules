//=======================================================================================
// Shopping Clean — 京东、淘宝、拼多多、美团、饿了么开屏、弹窗与信息流推广清理
//
// 为什么之前装了完全没效果（即使本地 Loon 已全局拦截 QUIC）：
//   1) 16 位数字无差别自杀：旧版用 /\d{16,}/.test(body) 检查整段原始响应（连引号内的字符串都算）。
//      电商/外卖的几乎每一条响应都带 16~19 位的 skuId / orderId / traceId / 毫秒时间戳拼接串，
//      导致脚本在 JSON.parse 之前就 99.9% 直接 $done({}) 退出了！
//      现改为「占位符保护字符串外的 16+ 位整数」，既不早退，也不在 JSON.parse 时丢失大整数精度。
//   2) 请求方式与字段对不上：
//      - 京东 welcomeHome / personinfoBusiness / search 等真实调用里，functionId 往往放在 POST
//        表单 body 或 URL path (/api?functionId=...)，且楼层结构是 floorList[].mId / bId / subFloors，
//        并不叫 guessed 的 card_type="ad_*"；
//      - 淘宝 / 饿了么走阿里 MTOP 网关 (guide-acs.m.taobao.com / trade-acs.m.taobao.com / waimai-guide.ele.me)，
//        真实结构是 data.containers / data.sections / data.result 里的 item.bizData /ext.is_p4p / p4p / ad；
//      - 拼多多走 api.pinduoduo.com / api.yangkeduo.com，首页与搜索流挂在 goods_list / items / flip，
//        推广条目带 ad / p_search.is_ad / icon_list 广告标，弹窗挂在 popup / activity_integration_popup；
//      - 美团 / 美团外卖走 wmapi / apimobile / i.meituan.com / wx.waimai.meituan.com，
//        竞价店带 charge_info (CPC/CPM 计费串) / ad_mark / is_ad / ad_attr。
//
// 参数：
//   block_ads (默认 true) ：去开屏、首页弹窗浮层、搜索/推荐信息流里的 CPC/CPM/P4P 竞价广告卡
//   clean_ui  (默认 false)：额外精简京东/美团/淘宝/拼多多「我的」页与首页的白条/金条/借钱/多多视频/小游戏营销楼层
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

  // Loon 传位置数组或对象，Egern 传 ctx.env 对象，Shadowrocket 传 JSON 字符串，全部兼容。
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

  // 支持标准 JSON，也支持 MTOP JSONP 包装 (如 mtopjsonp1({...}))
  let jsonPrefix = "";
  let jsonSuffix = "";
  let rawJson = body;
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    const mtopMatch = /^(\s*[a-zA-Z0-9_$]+\s*\()(\{[\s\S]*\})(\)\s*;?\s*)$/.exec(body);
    if (!mtopMatch) {
      $done({});
      return;
    }
    jsonPrefix = mtopMatch[1];
    rawJson = mtopMatch[2];
    jsonSuffix = mtopMatch[3];
  }

  // 保护字符串外的 16+ 位整数（订单号、SKU ID、shopId、traceId），防止 JSON.parse 丢精度。
  const BIGINT_MARK = "__shp_bigint_";
  let hasBigInt = false;
  const safeBody = rawJson.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
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

  // 清空容器字段但保持原类型（数组→[]、对象→{}），避免客户端反序列化崩溃。
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

  // 过滤数组元素；若整页都会被删空则保留原数组（allowEmpty=true 时允许清空纯广告数组）。
  const filterArray = (holder, key, isAdFn, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key])) return false;
    const list = holder[key];
    if (!list.length) return false;
    const kept = list.filter((item) => !isObj(item) || !isAdFn(item));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
      return true;
    }
    return false;
  };

  // 把开屏素材的投放时间推到 2040 年（秒或毫秒自适应）。
  const FUTURE_SEC = 2208960000;
  const FUTURE_MS = 2208960000000;
  const expireSplashItem = (ad) => {
    if (!isObj(ad)) return;
    for (const k of ["startTime", "start_time", "beginTime", "begin_time", "onlineTime", "online_time", "valid_from", "start"]) {
      if (typeof ad[k] === "number") {
        ad[k] = ad[k] > 1e11 ? FUTURE_MS : FUTURE_SEC;
        changed = true;
      } else if (typeof ad[k] === "string" && /^\d{10,13}$/.test(ad[k])) {
        ad[k] = ad[k].length > 10 ? String(FUTURE_MS) : String(FUTURE_SEC);
        changed = true;
      }
    }
    for (const k of ["endTime", "end_time", "expireTime", "expire_time", "offlineTime", "offline_time", "valid_to", "end"]) {
      if (typeof ad[k] === "number") {
        ad[k] = ad[k] > 1e11 ? FUTURE_MS + 86400000 : FUTURE_SEC + 86400;
        changed = true;
      } else if (typeof ad[k] === "string" && /^\d{10,13}$/.test(ad[k])) {
        ad[k] = ad[k].length > 10 ? String(FUTURE_MS + 86400000) : String(FUTURE_SEC + 86400);
        changed = true;
      }
    }
    for (const k of ["showTimes", "show_times", "duration", "display_time", "stay_time", "dwellTime", "time"]) {
      if (typeof ad[k] === "number" && ad[k] !== 0) {
        ad[k] = 0;
        changed = true;
      }
    }
  };

  // ---------- 通用电商/外卖商品与商家卡片广告判定 ----------
  const isShoppingAdItem = (item) => {
    if (!isObj(item)) return false;
    // 1. 显式布尔/数值广告标记（京东、淘宝、拼多多、美团、饿了么通用）
    if (
      truthy(item.is_ad) ||
      truthy(item.isAd) ||
      truthy(item.ad_mark) ||
      truthy(item.adMark) ||
      truthy(item.is_p4p) ||
      truthy(item.isP4p) ||
      truthy(item.p4p) ||
      truthy(item.ad_flag) ||
      truthy(item.brand_ad) ||
      truthy(item.is_brand_ad)
    ) {
      return true;
    }
    // 2. 竞价计费与推广载荷 (美团 charge_info、阿里 p4p_data/clickUrl、拼多多 ad、京东 adword)
    if (
      nonEmptyStr(item.charge_info) ||
      nonEmptyObj(item.charge_info) ||
      nonEmptyObj(item.ad_info) ||
      nonEmptyObj(item.adInfo) ||
      nonEmptyObj(item.ad_data) ||
      nonEmptyObj(item.adData) ||
      nonEmptyObj(item.p4p_data) ||
      nonEmptyObj(item.p4pData) ||
      nonEmptyObj(item.ads_info) ||
      nonEmptyObj(item.ad_attr) ||
      nonEmptyObj(item.ad)
    ) {
      return true;
    }
    if (typeof item.ad_type === "number" && item.ad_type > 0) return true;
    if (typeof item.adType === "number" && item.adType > 0) return true;
    if ((item.ad_type || item.adType) && (item.ad_id || item.adId)) return true;

    // 3. 京东商品流推广字段
    if (
      nonEmptyStr(item.adIcon) ||
      nonEmptyStr(item.adword) ||
      nonEmptyStr(item.extension_id) ||
      nonEmptyStr(item.ad_click_url) ||
      nonEmptyStr(item.exposalUrl) ||
      nonEmptyStr(item.clickUrl) && truthy(item.isJdAd)
    ) {
      return true;
    }

    // 4. 拼多多搜索/推荐流广告标记 (p_search.is_ad / ad_sn)
    if (isObj(item.p_search) && (truthy(item.p_search.is_ad) || truthy(item.p_search.is_sink_ad))) {
      return true;
    }

    // 5. 淘宝/天猫 MTOP 信息流卡片标记 (bizData / ext / args / item.utLogMap)
    if (isObj(item.ext) && (truthy(item.ext.is_p4p) || truthy(item.ext.is_ad) || item.ext.adType)) {
      return true;
    }
    if (isObj(item.args) && (truthy(item.args.is_ad) || truthy(item.args.is_p4p) || item.args.ad_id)) {
      return true;
    }
    if (isObj(item.bizData) && (truthy(item.bizData.isAd) || truthy(item.bizData.is_p4p))) {
      return true;
    }

    // 6. 卡片类型名
    const ct = String(
      item.card_type || item.cardType || item.biz_type || item.bizType || item.module_type || item.template_name || ""
    );
    if (/^(?:ad|advert|ad[_-]|p4p|commercial|brand_ad|cpm_ad|cpc_ad|one_ad)/i.test(ct)) return true;

    // 7. 嵌套在 item.poi / item.data / item.item / item.content 里的广告标记
    for (const subKey of ["poi", "data", "item", "content"]) {
      const inner = item[subKey];
      if (!isObj(inner)) continue;
      if (
        truthy(inner.is_ad) ||
        truthy(inner.isAd) ||
        truthy(inner.ad_mark) ||
        truthy(inner.is_p4p) ||
        truthy(inner.p4p) ||
        nonEmptyStr(inner.charge_info) ||
        nonEmptyObj(inner.ad_info) ||
        nonEmptyObj(inner.ad_data) ||
        nonEmptyObj(inner.p4p_data) ||
        nonEmptyObj(inner.ad) ||
        (typeof inner.ad_type === "number" && inner.ad_type > 0)
      ) {
        return true;
      }
    }
    return false;
  };

  // 京东首页与「我的」页楼层判定（不管 URL 上有没有 functionId，按响应特征结构直接识别）
  const JD_AD_FLOOR_RE =
    /^(?:ad|advert|float|xview|shimmer|popup|banner_ad|commercial|hot_ad| bottomXview|ruleFloat|topAtmosphere)/i;
  const JD_FINANCE_FLOOR_RE =
    /baitiao|jintiao|jdpay_loan|borrow|credit_loan|xiaojinku|finance_loan|plus_banner|game_center|白条|金条|借钱|小金库|互动游戏/i;

  const isJdFloorAd = (floor) => {
    if (!isObj(floor)) return false;
    if (blockAds && isShoppingAdItem(floor)) return true;
    const identity = [
      floor.mId,
      floor.bId,
      floor.refId,
      floor.type,
      floor.floorName,
      floor.showName,
      floor.labelName,
      floor.head && floor.head.name,
    ]
      .filter((x) => typeof x === "string")
      .join(" ");
    if (blockAds && JD_AD_FLOOR_RE.test(identity)) return true;
    if (cleanUi && JD_FINANCE_FLOOR_RE.test(identity)) return true;
    return false;
  };

  try {
    // =========================================================================
    // 1. 京东 (*.jd.com) —— 按 URL functionId + 响应结构特征双重识别（兼容 POST body 传 functionId）
    // =========================================================================
    if (/\.jd\.com/i.test(url)) {
      const fnMatch = /[?&]functionId=([^&]+)/i.exec(url);
      const reqBodyStr = typeof req.body === "string" ? req.body : "";
      const bodyFnMatch = !fnMatch && reqBodyStr ? /(?:^|&)functionId=([^&]+)/i.exec(reqBodyStr) : null;
      const fn = fnMatch
        ? decodeURIComponent(fnMatch[1])
        : bodyFnMatch
          ? decodeURIComponent(bodyFnMatch[1])
          : "";

      // (a) 开屏与启动图
      if (blockAds && (/^(?:start|home_launchConfig|splash|getLoadingLinks)/i.test(fn) || Array.isArray(root.images))) {
        for (const holder of [root, root.data]) {
          if (!isObj(holder)) continue;
          for (const k of ["images", "ads", "adList", "splashList", "show_list"]) {
            if (Array.isArray(holder[k])) {
              for (const item of holder[k]) expireSplashItem(item);
              clearSlot(holder, k);
            }
          }
        }
      }

      // (b) 京东首页（welcomeHome 或带 floorList 的响应）与「我的」页（personinfoBusiness 或带 floors 的响应）
      if (blockAds) {
        for (const holder of [root, root.data]) {
          if (!isObj(holder)) continue;
          dropKeys(holder, [
            "floatLayer",
            "topAtmosphere",
            "shimmer",
            "xview",
            "xviewList",
            "bottomXview",
            "popup",
            "popupInfo",
            "pullDown",
            "ruleFloat",
            "plusPromotion",
            "plus_promotion",
            "adInfo",
            "advert",
          ]);
          if (isObj(holder.searchBoxWords)) {
            clearSlot(holder.searchBoxWords, "words");
          }
        }
      }

      for (const holder of [root, root.data]) {
        if (!isObj(holder)) continue;
        if (Array.isArray(holder.floorList)) {
          filterArray(holder, "floorList", isJdFloorAd);
          for (const fl of holder.floorList) {
            if (isObj(fl) && Array.isArray(fl.subFloors)) {
              filterArray(fl, "subFloors", isJdFloorAd);
            }
          }
        }
        if (Array.isArray(holder.floors)) {
          filterArray(holder, "floors", isJdFloorAd);
          for (const fl of holder.floors) {
            if (isObj(fl) && Array.isArray(fl.subFloors)) {
              filterArray(fl, "subFloors", isJdFloorAd);
            }
          }
        }
      }

      // (c) 京东搜索、猜你喜欢、商品推荐流 (wareInfo / wareList / recommendList / feedList / paragraphs)
      if (blockAds) {
        for (const holder of [root, root.data, root.result, isObj(root.data) ? root.data.data : null]) {
          if (!isObj(holder)) continue;
          for (const listKey of [
            "wareInfo",
            "wareList",
            "recommendList",
            "feedList",
            "items",
            "list",
            "paragraphs",
            "cards",
          ]) {
            filterArray(holder, listKey, isShoppingAdItem);
          }
        }
      }
    }

    // =========================================================================
    // 2. 淘宝 / 天猫 / 饿了么阿里系 MTOP (*.taobao.com / *.tmall.com / *.ele.me)
    // =========================================================================
    if (/\.(?:taobao|tmall)\.com|\.ele\.me/i.test(url)) {
      const d = isObj(root.data) ? root.data : root;

      if (blockAds) {
        // 清理开屏、弹窗、浮层与顶栏横幅
        for (const holder of [root, d, isObj(d.data) ? d.data : null, isObj(d.result) ? d.result : null]) {
          if (!isObj(holder)) continue;
          dropKeys(holder, [
            "float_ad",
            "popup_ad",
            "banner_ad",
            "ad_banners",
            "splash_ad",
            "top_ad",
            "bottom_ad",
            "poplayer",
            "popLayer",
            "floatLayer",
            "atmosphere",
            "topAtmosphere",
            "adv_info",
            "adInfo",
          ]);
          for (const listKey of [
            "items",
            "list",
            "modules",
            "cards",
            "restaurants",
            "feeds",
            "recommend_list",
            "resultList",
            "itemsArray",
            "sections",
          ]) {
            filterArray(holder, listKey, isShoppingAdItem);
            if (Array.isArray(holder[listKey])) {
              for (const sub of holder[listKey]) {
                if (!isObj(sub)) continue;
                filterArray(sub, "items", isShoppingAdItem);
                filterArray(sub, "list", isShoppingAdItem);
                filterArray(sub, "sections", isShoppingAdItem);
                if (isObj(sub.data)) {
                  filterArray(sub.data, "items", isShoppingAdItem);
                  filterArray(sub.data, "list", isShoppingAdItem);
                }
              }
            }
          }
        }

        // 淘宝首页 MTOP (mtop.taobao.wireless.home.newface.awesome.get) 的 containers 树结构
        if (isObj(d.containers)) {
          for (const cKey of Object.keys(d.containers)) {
            const container = d.containers[cKey];
            if (!isObj(container)) continue;
            for (const secKey of ["sections", "base", "custom"]) {
              if (Array.isArray(container[secKey])) {
                filterArray(container, secKey, isShoppingAdItem);
              } else if (isObj(container[secKey]) && Array.isArray(container[secKey].sections)) {
                filterArray(container[secKey], "sections", isShoppingAdItem);
              }
            }
          }
        }
      }

      // clean_ui：淘宝「我的」页 (mtop.taobao.mclaren) 隐藏借钱/省钱卡/小游戏娱乐楼层
      if (cleanUi && isObj(d.hierarchy) && isObj(d.data)) {
        const TB_CLUTTER_RE = /借钱|网商贷|花呗分期|芭芭农场|斗地主|小游戏|省钱月卡|红包签到/;
        for (const k of Object.keys(d.data)) {
          const node = d.data[k];
          if (isObj(node) && TB_CLUTTER_RE.test(JSON.stringify(node.fields || node))) {
            delete d.data[k];
            changed = true;
          }
        }
      }
    }

    // =========================================================================
    // 3. 拼多多 (*.pinduoduo.com / *.yangkeduo.com)
    // =========================================================================
    if (/\.(?:pinduoduo|yangkeduo)\.com/i.test(url)) {
      if (blockAds) {
        for (const holder of [root, root.result, root.data]) {
          if (!isObj(holder)) continue;
          dropKeys(holder, [
            "popup",
            "popup_list",
            "activity_integration_popup",
            "float_window",
            "floating_window",
            "splash_ad",
            "ad_banner",
            "top_banner",
            "pendant",
          ]);
          for (const listKey of ["goods_list", "items", "list", "feeds", "org_list", "recommend_list"]) {
            filterArray(holder, listKey, isShoppingAdItem);
          }
        }
      }
      if (cleanUi) {
        // 拼多多底栏或首页顶部的多多视频 / 现金大转盘营销入口
        for (const holder of [root, root.result, root.data]) {
          if (!isObj(holder)) continue;
          for (const tabKey of ["bottom_tabs", "tabs", "icon_set", "quick_entrance"]) {
            if (!Array.isArray(holder[tabKey])) continue;
            const kept = holder[tabKey].filter((t) => {
              if (!isObj(t)) return true;
              const title = String(t.title || t.tab_name || t.name || "");
              return !/多多视频|大转盘|领现金|多多果园|多多买菜/.test(title);
            });
            if (kept.length && kept.length !== holder[tabKey].length) {
              holder[tabKey] = kept;
              changed = true;
            }
          }
        }
      }
    }

    // =========================================================================
    // 4. 美团 & 美团外卖 (*.meituan.com / *.sankuai.com / *.dianping.com)
    // =========================================================================
    if (/\.(?:meituan|sankuai|dianping)\.com/i.test(url)) {
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
            "marketing_banner",
          ]);
          for (const listKey of [
            "poilist",
            "poi_list",
            "poiList",
            "module_list",
            "moduleList",
            "card_list",
            "cardList",
            "items",
            "list",
            "feeds",
            "feed_list",
            "recommend_list",
          ]) {
            filterArray(holder, listKey, isShoppingAdItem);
            if (Array.isArray(holder[listKey])) {
              for (const mod of holder[listKey]) {
                if (!isObj(mod)) continue;
                filterArray(mod, "items", isShoppingAdItem);
                filterArray(mod, "poilist", isShoppingAdItem);
                filterArray(mod, "poi_list", isShoppingAdItem);
                if (isObj(mod.data)) {
                  filterArray(mod.data, "items", isShoppingAdItem);
                  filterArray(mod.data, "poilist", isShoppingAdItem);
                  filterArray(mod.data, "poi_list", isShoppingAdItem);
                  filterArray(mod.data, "list", isShoppingAdItem);
                }
                if (typeof mod.string_data === "string" && mod.string_data.charCodeAt(0) === 0x7b) {
                  try {
                    const sd = JSON.parse(mod.string_data);
                    if (isObj(sd)) {
                      let sdHit = false;
                      if (filterArray(sd, "poilist", isShoppingAdItem)) sdHit = true;
                      if (filterArray(sd, "items", isShoppingAdItem)) sdHit = true;
                      if (filterArray(sd, "list", isShoppingAdItem)) sdHit = true;
                      if (sdHit) mod.string_data = JSON.stringify(sd);
                    }
                  } catch (e) {}
                }
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
  $done({ body: jsonPrefix + out + jsonSuffix });
})();
