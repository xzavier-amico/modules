//=======================================================================================
// Shopping Clean — 京东、淘宝、菜鸟裹裹、丰巢、拼多多、美团、饿了么去广告与界面净化
//
// 同时支持请求阶段（精准阻断菜鸟 AMDC 调度以防绕过 MITM，不误伤淘宝主站）与响应阶段 JSON/JSONP 清理：
//   1) 京东 (api.m.jd.com)：
//      - functionId=start 开屏清空 images & showTimesDaily
//      - welcomeHome 过滤 floorList 广告/营销楼层、清空 webViewFloorList 下拉二楼与 promotionTabs
//      - personinfoBusiness 过滤大促/推荐/金融楼层，并深入 basefloorinfo 清弹窗/浮层、userinfo 清 Plus 卡
//      - deliverLayer / orderTrackBusiness 删物流页寄件横幅 bannerInfo 与 jdDeliveryBanner
//      - getTabHomeInfo / myOrderInfo / readCustomSurfaceList 删浮窗/广告卡/冗余底栏
//      - 搜索/猜你喜欢商品流过滤 adIcon / adword / exposalUrl 竞价商品
//   2) 淘宝 / 天猫 (guide-acs / trade-acs / acs.m.taobao.com, poplayer.template.alibaba.com)：
//      - mtop.taobao.wireless.home.splash.awesome.get 深入 bizData["taobao-splash"].data[] 覆写开屏有效期
//      - mtop.taobao.cloudvideo.video.query 清空视频开屏缓存与时长
//      - poplayer.template.alibaba.com 清空弹窗素材并置 enable=false
//      - 首页 containers / itemsArray 过滤 P4P 直通车广告（兼容 JSON 与 MTOP JSONP）
//   3) 菜鸟裹裹 (cn-acs.m.cainiao.com / acs.m.cainiao.com / netflow-mtop.cainiao.com)：
//      - 请求阶段拦截 Cainiao4iPhone 的 amdc.m.taobao.com/amdc/mobileDispatch，迫使走标准域名 MITM
//      - guoguo.nbnetflow.ads.mshow 按真实广告位数字 ID 删除横幅/商品推广
//      - guoguo.nbnetflow.ads.show 过滤 materialContentMapper 广告与裹酱/回收营销卡
//      - nbpresentation.protocol.homepage.get 清理 dataList 里的 banner_area / promotion 与 icons_scroll 营销图标
//      - nbpresentation.pickup.empty.page.get 清理取件空页营销卡片
//      - nbfriend.message.conversation.list 仅保留物流通知 (logistic_message)
//   4) 丰巢 (consumer / app / wx / api / m.fcbox.com)：清理开屏、取件页弹窗、横幅与广告列表
//   5) 拼多多 (api.pinduoduo.com / api.yangkeduo.com)：
//      - /api/alexa/homepage/hub 精简多多视频/大促会场/直播底栏、清 icon_set & search_bar_hot_query
//      - /api/philo/personal/hub 清省钱月卡入口与冗余图标
//      - /api/oak/integration/render 删 ui.bottom_section / float_info / bottom_section_list（不误杀页面）
//      - 商品流过滤 p_search.is_ad / ad 竞价商品
//   6) 美团 / 美团外卖 & 饿了么：
//      - 过滤 poilist / module_list (含 string_data 内嵌 JSON) CPC/CPM 竞价店、微信小程序推广与饿了么悬浮模板
//
// 保护字符串外的 16+ 位整数（订单号/SKU ID/traceId），防止 JSON.parse 丢精度。
//=======================================================================================

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || null;
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = (res && res.url) || req.url || "";

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

  // 请求阶段：精准拦截菜鸟裹裹的 AMDC 调度（迫使其回退标准 HTTPS 域名走 MITM），放行淘宝主站避免误杀购物车/下单按钮
  if (!res) {
    if (/amdc\.m\.taobao\.com\/amdc\/mobileDispatch\b/i.test(url)) {
      const headers = req.headers || {};
      let ua = "";
      for (const k of Object.keys(headers)) {
        if (k.toLowerCase() === "user-agent") {
          ua = String(headers[k] || "");
          break;
        }
      }
      if (/Cainiao4iPhone|AMapiPhone/i.test(ua)) {
        $done({ response: { status: 404, headers: {}, body: "" } });
        return;
      }
    }
    $done({});
    return;
  }

  const status = Number(res.status || res.statusCode || 200);
  const body = res.body;
  if (status >= 300 || typeof body !== "string" || !body || body.length > 8388608) {
    $done({});
    return;
  }

  // 支持标准 JSON 与 MTOP JSONP (如 mtopjsonp1({...}))
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

    if (
      nonEmptyStr(item.adIcon) ||
      nonEmptyStr(item.adword) ||
      nonEmptyStr(item.extension_id) ||
      nonEmptyStr(item.ad_click_url) ||
      nonEmptyStr(item.exposalUrl) ||
      (nonEmptyStr(item.clickUrl) && truthy(item.isJdAd))
    ) {
      return true;
    }

    if (isObj(item.p_search) && (truthy(item.p_search.is_ad) || truthy(item.p_search.is_sink_ad))) {
      return true;
    }
    if (isObj(item.ext) && (truthy(item.ext.is_p4p) || truthy(item.ext.is_ad) || item.ext.adType)) {
      return true;
    }
    if (isObj(item.args) && (truthy(item.args.is_ad) || truthy(item.args.is_p4p) || item.args.ad_id)) {
      return true;
    }
    if (isObj(item.bizData) && (truthy(item.bizData.isAd) || truthy(item.bizData.is_p4p))) {
      return true;
    }

    const ct = String(
      item.card_type || item.cardType || item.biz_type || item.bizType || item.module_type || item.template_name || ""
    );
    if (/^(?:ad|advert|ad[_-]|p4p|commercial|brand_ad|cpm_ad|cpc_ad|one_ad)/i.test(ct)) return true;

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

  // ---------- 京东真实楼层常量 ----------
  const JD_AD_FLOOR_RE =
    /^(?:ad|advert|float|xview|shimmer|popup|banner_ad|commercial|hot_ad|bottomXview|ruleFloat|topAtmosphere)/i;
  const JD_FINANCE_FLOOR_RE =
    /baitiao|jintiao|jdpay_loan|borrow|credit_loan|xiaojinku|finance_loan|plus_banner|game_center|白条|金条|借钱|小金库|互动游戏/i;
  const JD_PERSON_MID_EXCLUDE = new Set([
    "bigSaleFloor",
    "buyOften",
    "newAttentionCard",
    "newBigSaleFloor",
    "newStyleAttentionCard",
    "newsFloor",
    "noticeFloor",
    "recommendfloor",
  ]);
  const JD_WELCOME_TYPE_INCLUDE = new Set([
    "topTab",
    "searchC",
    "dynamicIcon",
    "locPermission",
    "login",
    "hybrid",
    "recommend",
  ]);
  const JD_CUSTOM_SURFACE_KEEP = new Set(["index", "messagenew", "cart", "home"]);

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

  const cleanJdPersonFloors = (floors) => {
    if (!Array.isArray(floors) || !floors.length) return floors;
    const out = [];
    for (const floor of floors) {
      if (!isObj(floor)) {
        out.push(floor);
        continue;
      }
      if (isJdFloorAd(floor)) {
        changed = true;
        continue;
      }
      if (cleanUi && JD_PERSON_MID_EXCLUDE.has(floor.mId)) {
        changed = true;
        continue;
      }
      if (blockAds && floor.mId === "basefloorinfo" && isObj(floor.data)) {
        dropKeys(floor.data, ["commonPopup", "commonPopup_dynamic", "floatLayer"]);
        clearSlot(floor.data, "commonTips");
        clearSlot(floor.data, "commonWindows");
      } else if (blockAds && floor.mId === "orderIdFloor" && isObj(floor.data?.commentRemindInfo)) {
        clearSlot(floor.data.commentRemindInfo, "infos");
      } else if (cleanUi && floor.mId === "userinfo" && isObj(floor.data)) {
        dropKeys(floor.data, ["newPlusBlackCard"]);
      }
      if (Array.isArray(floor.subFloors)) {
        filterArray(floor, "subFloors", isJdFloorAd);
      }
      out.push(floor);
    }
    return out;
  };

  try {
    // =========================================================================
    // 1. 京东 (*.jd.com)
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

      // (a) 开屏与启动图 (functionId=start / home_launchConfig / getLoadingLinks)
      if (blockAds && (/^(?:start|home_launchConfig|splash|getLoadingLinks)/i.test(fn) || Array.isArray(root.images))) {
        if (root.showTimesDaily) {
          root.showTimesDaily = 0;
          changed = true;
        }
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

      // (b) 京东首页 (welcomeHome)：清二楼 webViewFloorList、顶部推广 promotionTabs、广告楼层
      if (/^welcomeHome$/i.test(fn) || Array.isArray(root.webViewFloorList) || root.promotionTabs !== undefined) {
        if (blockAds) {
          clearSlot(root, "webViewFloorList");
          dropKeys(root, ["promotionTabs"]);
        }
        if (cleanUi && Array.isArray(root.floorList) && root.floorList.length) {
          const looksRealWelcome = root.floorList.some((f) => isObj(f) && JD_WELCOME_TYPE_INCLUDE.has(f.type));
          if (looksRealWelcome) {
            const kept = root.floorList.filter((f) => !isObj(f) || JD_WELCOME_TYPE_INCLUDE.has(f.type));
            if (kept.length && kept.length !== root.floorList.length) {
              root.floorList = kept;
              changed = true;
            }
          }
        }
      }

      // (c) 底栏精简 (readCustomSurfaceList)
      if (cleanUi && /^readCustomSurfaceList$/i.test(fn) && isObj(root.result?.modeMap)) {
        for (const mode of ["dark", "normal"]) {
          const nav = root.result.modeMap[mode]?.navigationAll;
          if (Array.isArray(nav) && nav.length) {
            const kept = nav.filter((i) => !isObj(i) || JD_CUSTOM_SURFACE_KEEP.has(i.functionId));
            if (kept.length && kept.length !== nav.length) {
              root.result.modeMap[mode].navigationAll = kept;
              changed = true;
            }
          }
        }
      }

      // (d) 物流页 (deliverLayer / orderTrackBusiness)
      if (blockAds && (/^(?:deliverLayer|orderTrackBusiness)$/i.test(fn) || root.bannerInfo !== undefined)) {
        dropKeys(root, ["bannerInfo"]);
        if (Array.isArray(root.floors)) {
          const kept = root.floors.filter((i) => !isObj(i) || (i.mId !== "banner" && i.mId !== "jdDeliveryBanner"));
          if (kept.length !== root.floors.length) {
            root.floors = kept;
            changed = true;
          }
        }
      }

      // (e) 新品页 (getTabHomeInfo)
      if (blockAds && /^getTabHomeInfo$/i.test(fn) && isObj(root.result)) {
        dropKeys(root.result, ["iconInfo", "roofTop"]);
      }

      // (f) 订单页 (myOrderInfo)
      if (blockAds && /^myOrderInfo$/i.test(fn) && Array.isArray(root.floors)) {
        const DROP_ORDER_FLOORS = new Set(["bannerFloor", "bpDynamicFloor", "plusFloor"]);
        const kept = [];
        for (const floor of root.floors) {
          if (isObj(floor) && DROP_ORDER_FLOORS.has(floor.mId)) {
            changed = true;
            continue;
          }
          if (isObj(floor) && floor.mId === "virtualServiceCenter" && Array.isArray(floor.data?.virtualServiceCenters)) {
            for (const item of floor.data.virtualServiceCenters) {
              if (Array.isArray(item?.serviceList)) {
                const sKept = item.serviceList.filter((c) => !isObj(c) || c.serviceTitle !== "精选特惠");
                if (sKept.length !== item.serviceList.length) {
                  item.serviceList = sKept;
                  changed = true;
                }
              }
            }
          }
          kept.push(floor);
        }
        root.floors = kept;
      }

      // (g) 通用首页 / 我的页 (personinfoBusiness / floorList / floors / others.floors)
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

      for (const holder of [root, root.data, root.others]) {
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
          holder.floors = cleanJdPersonFloors(holder.floors);
        }
      }

      // (h) 京东搜索与商品推荐流
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
    // 2. 淘宝 / 天猫 / 阿里弹窗 (*.taobao.com / *.tmall.com / poplayer.template.alibaba.com)
    // =========================================================================
    if (/\.(?:taobao|tmall)\.com|poplayer\.template\.alibaba\.com/i.test(url)) {
      const d = isObj(root.data) ? root.data : root;

      if (blockAds) {
        // (a) 淘宝弹窗模板 (poplayer.template.alibaba.com/*.json)
        if (/poplayer\.template\.alibaba\.com/i.test(url)) {
          if (isObj(root.res)) {
            clearSlot(root.res, "images");
            clearSlot(root.res, "videos");
          }
          if (isObj(root.mainRes)) {
            clearSlot(root.mainRes, "images");
          }
          if (root.enable) {
            root.enable = false;
            changed = true;
          }
        }

        // (b) 淘宝视频开屏 (mtop.taobao.cloudvideo.video.query)
        if (/mtop\.taobao\.cloudvideo\.video\.query/i.test(url) && isObj(root.data)) {
          if (root.data.duration !== undefined) { root.data.duration = "0"; changed = true; }
          clearSlot(root.data, "resources");
          clearSlot(root.data, "caches");
          if (root.data.respTimeInMs !== undefined) { root.data.respTimeInMs = "3818332800000"; changed = true; }
        }

        // (c) 淘宝开屏 (mtop.taobao.wireless.home.splash.awesome.get)
        if (/mtop\.taobao\.wireless\.home\.splash\.awesome\.get/i.test(url)) {
          const sections = root.data?.containers?.splash_home_base?.base?.sections;
          if (Array.isArray(sections)) {
            for (const sec of sections) {
              const splashList = sec?.bizData?.["taobao-splash"]?.data;
              if (Array.isArray(splashList) && splashList.length) {
                for (const item of splashList) {
                  if (!isObj(item)) continue;
                  item.waitTime = "0";
                  item.times = "0";
                  item.hotStart = "false";
                  item.coldStart = "false";
                  item.haveVoice = "false";
                  item.hideTBLogo = "false";
                  item.enable4G = "false";
                  item.startTime = "3818332800000";
                  item.endTime = "3818419199000";
                  item.gmtStart = "2090-12-31 00:00:00";
                  item.gmtEnd = "2090-12-31 23:59:59";
                  item.gmtStartMs = "3818332800000";
                  item.gmtEndMs = "3818419199000";
                  if (item.imgUrl) item.imgUrl = "";
                  if (item.videoUrl) item.videoUrl = "";
                }
                changed = true;
              }
            }
          }
        }

        // (d) 通用 MTOP 浮层与 P4P 信息流清理
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
            "adList",
            "ads",
            "bannerList",
            "marketingList",
            "operationList",
            "homePopup",
          ]);
          for (const listKey of ["items", "list", "modules", "cards", "feeds", "recommend_list", "resultList", "itemsArray", "sections"]) {
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

      if (cleanUi) {
        const TB_CLUTTER_RE = /借钱|网商贷|花呗分期|芭芭农场|斗地主|小游戏|省钱月卡|红包签到|免费领水果|天天领现金/;
        if (isObj(d.hierarchy) && isObj(d.data)) {
          for (const k of Object.keys(d.data)) {
            const node = d.data[k];
            if (isObj(node) && TB_CLUTTER_RE.test(JSON.stringify(node.fields || node))) {
              delete d.data[k];
              changed = true;
            }
          }
        }
      }
    }

    // =========================================================================
    // 2.2 菜鸟裹裹 (cn-acs.m.cainiao.com / acs.m.cainiao.com / netflow-mtop.cainiao.com)
    // =========================================================================
    if (/\.cainiao\.com/i.test(url)) {
      const d = isObj(root.data) ? root.data : root;

      // (a) 首页 / 物流页广告槽位字典 (.guoguo.nbnetflow.ads.mshow)
      if (blockAds && /\.guoguo\.nbnetflow\.ads\.mshow\b/i.test(url) && isObj(root.data)) {
        const DROP_SLOTS = [
          "10", "328", "366", "369", "498", "615", "616", "727", "793", "954",
          "1275", "1308", "1316", "1332", "1340", "1391", "1410", "1428",
          "1524", "1525", "1638", "1910",
        ];
        for (const id of DROP_SLOTS) {
          if (Object.prototype.hasOwnProperty.call(root.data, id)) {
            delete root.data[id];
            changed = true;
          }
        }
      }

      // (b) 我的页广告与裹酱营销 (.guoguo.nbnetflow.ads.show)
      if (/\.guoguo\.nbnetflow\.ads\.show\b/i.test(url) && Array.isArray(root.data?.result)) {
        const DROP_GROUPS = new Set(["common_header_banner", "entertainment", "interests", "kuaishou_banner"]);
        const DROP_IDS = new Set(["29338", "29339", "32103", "33927", "36649"]);
        const kept = root.data.result.filter((i) => {
          if (!isObj(i)) return true;
          const m = i.materialContentMapper;
          if (blockAds && (m?.adItemDetail || (m?.bgImg && m?.advRecGmtModifiedTime))) return false;
          if (cleanUi && (DROP_GROUPS.has(m?.group_id) || DROP_IDS.has(String(i.id || "")))) return false;
          return true;
        });
        if (kept.length !== root.data.result.length) {
          root.data.result = kept;
          changed = true;
        }
        for (const i of root.data.result) {
          if (i?.materialContentMapper?.show_tips_content) {
            i.materialContentMapper.show_tips_content = "";
            changed = true;
          }
        }
      }

      // (c) 菜鸟首页协议 (.nbpresentation.protocol.homepage.get)
      if (/\.nbpresentation\.protocol\.homepage\.get\b/i.test(url) && Array.isArray(root.data?.result?.dataList)) {
        const DROP_ICON_KEYS = new Set([
          "618cjhb", "bgxq", "cncy", "cngy", "cngreen", "cnhs",
          "dtxb", "gjjf", "jkymd", "ljjq", "ttlhb", "xybg",
        ]);
        const kept = [];
        for (const item of root.data.result.dataList) {
          if (!isObj(item)) { kept.push(item); continue; }
          const t = String(item.type || "");
          if (blockAds && (t.includes("banner_area") || t.includes("promotion"))) {
            changed = true;
            continue;
          }
          if (cleanUi && t.includes("kingkong") && Array.isArray(item.bizData?.items)) {
            for (const sub of item.bizData.items) {
              if (isObj(sub) && (sub.rightIcon !== null || sub.bubbleText !== null)) {
                sub.rightIcon = null;
                sub.bubbleText = null;
                changed = true;
              }
            }
          } else if (cleanUi && t.includes("icons_scroll") && Array.isArray(item.bizData?.items)) {
            const subKept = item.bizData.items.filter((sub) => !isObj(sub) || !DROP_ICON_KEYS.has(sub.key));
            if (subKept.length !== item.bizData.items.length) {
              item.bizData.items = subKept;
              changed = true;
            }
            for (const sub of item.bizData.items) {
              if (isObj(sub) && (sub.rightIcon !== null || sub.bubbleText !== null)) {
                sub.rightIcon = null;
                sub.bubbleText = null;
                changed = true;
              }
            }
          }
          kept.push(item);
        }
        root.data.result.dataList = kept;
      }

      // (d) 取件空页 (.nbpresentation.pickup.empty.page.get)
      if (cleanUi && /\.nbpresentation\.pickup\.empty\.page\.get\b/i.test(url) && Array.isArray(root.data?.result?.content?.middle)) {
        const DROP_TPL = new Set([
          "guoguo_pickup_empty_page_relation_add",
          "guoguo_pickup_helper_feedback",
          "guoguo_pickup_helper_tip_view",
        ]);
        const mid = root.data.result.content.middle;
        const kept = mid.filter((i) => !isObj(i) || !DROP_TPL.has(i.template?.name));
        if (kept.length !== mid.length) {
          root.data.result.content.middle = kept;
          changed = true;
        }
      }

      // (e) 消息中心 (.nbfriend.message.conversation.list)
      if (cleanUi && /\.nbfriend\.message\.conversation\.list\b/i.test(url) && Array.isArray(root.data?.data)) {
        const kept = root.data.data.filter((i) => !isObj(i) || String(i.conversationId || "").includes("logistic_message"));
        if (kept.length !== root.data.data.length) {
          root.data.data = kept;
          changed = true;
        }
      }

      // (f) 通用菜鸟浮层与营销模块兜底清理
      if (blockAds) {
        for (const holder of [root, d, isObj(d.data) ? d.data : null, isObj(d.result) ? d.result : null]) {
          if (!isObj(holder)) continue;
          dropKeys(holder, ["homePopup", "pickupAd", "bannerList", "adList", "ads", "marketingList", "operationList"]);
          for (const listKey of ["modules", "sections", "cards", "items", "list"]) {
            filterArray(holder, listKey, isShoppingAdItem);
          }
        }
      }
      if (cleanUi) {
        const CN_CLUTTER_RE = /裹酱|免费领水果|天天领现金|省钱专区|好物推荐|猜你喜欢|借钱|小游戏/;
        for (const holder of [d, isObj(d.data) ? d.data : null, isObj(d.result) ? d.result : null]) {
          if (!isObj(holder)) continue;
          for (const arrKey of ["modules", "sections", "cards", "items", "list"]) {
            if (!Array.isArray(holder[arrKey]) || !holder[arrKey].length) continue;
            const kept = holder[arrKey].filter((m) => {
              if (!isObj(m)) return true;
              const code = String(m.moduleCode || m.bizCode || m.sectionBizCode || m.type || m.name || "");
              const title = String(m.title || m.moduleName || m.desc || "");
              if (/ad|banner|popup|recommend_mall|goods_feed|guess_like|welfare|game|orchard|farm/i.test(code)) return false;
              if (title && CN_CLUTTER_RE.test(title)) return false;
              return true;
            });
            if (kept.length && kept.length !== holder[arrKey].length) {
              holder[arrKey] = kept;
              changed = true;
            }
          }
        }
      }
    }

    // =========================================================================
    // 2.5 丰巢 (*.fcbox.com / *.fengchao.com)
    // =========================================================================
    if (/\.(?:fcbox|fengchao)\.com/i.test(url)) {
      if (blockAds) {
        for (const holder of [root, root.data, root.result, isObj(root.data) ? root.data.data : null]) {
          if (!isObj(holder)) continue;
          for (const k of [
            "adList",
            "ads",
            "advertList",
            "adverts",
            "bannerList",
            "banners",
            "popup",
            "popupList",
            "popList",
            "floatAd",
            "floatingAd",
            "splash",
            "splashAd",
            "openScreenAd",
            "activityList",
            "marketingList",
          ]) {
            clearSlot(holder, k);
          }
          for (const listKey of ["list", "items", "modules", "cards", "floorList", "records"]) {
            filterArray(holder, listKey, isShoppingAdItem, true);
          }
        }
        if (/\/(?:ad|ads|advert|banner|splash|popup|marketing)(?:\/|[?]|$)/i.test(url)) {
          if (Array.isArray(root.data) && root.data.length) {
            root.data = [];
            changed = true;
          }
        }
      }
    }

    // =========================================================================
    // 3. 拼多多 (*.pinduoduo.com / *.yangkeduo.com)
    // =========================================================================
    if (/\.(?:pinduoduo|yangkeduo)\.com/i.test(url)) {
      // (a) 首页框架 (/api/alexa/homepage/hub)
      if (/\/api\/alexa\/homepage\/hub\b/i.test(url) && isObj(root.result)) {
        if (blockAds) {
          dropKeys(root.result, ["search_bar_hot_query"]);
        }
        if (cleanUi) {
          dropKeys(root.result, ["icon_set"]);
          if (Array.isArray(root.result.bottom_tabs)) {
            const kept = root.result.bottom_tabs.filter(
              (t) => !isObj(t) || !/^(?:多多视频|大促会场|直播)$/.test(String(t.title || ""))
            );
            if (kept.length && kept.length !== root.result.bottom_tabs.length) {
              root.result.bottom_tabs = kept;
              changed = true;
            }
          }
        }
      }

      // (b) 个人中心 (/api/philo/personal/hub)
      if (/\/api\/philo\/personal\/hub\b/i.test(url) && cleanUi) {
        dropKeys(root, ["monthly_card_entrance", "personal_center_style_v2_vo"]);
        if (isObj(root.icon_set)) {
          dropKeys(root.icon_set, ["icons", "top_personal_icons"]);
        }
      }

      // (c) 商品/首页混合渲染 (/api/oak/integration/render)
      if (/\/api\/oak\/integration\/render\b/i.test(url) && blockAds) {
        if (isObj(root.ui)) {
          dropKeys(root.ui, ["bottom_section"]);
          if (isObj(root.ui.live_section)) {
            dropKeys(root.ui.live_section, ["float_info"]);
          }
        }
        dropKeys(root, ["bottom_section_list"]);
      }

      // (d) 通用弹窗与商品流竞价广告
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
        for (const holder of [root, root.result, root.data]) {
          if (!isObj(holder)) continue;
          for (const tabKey of ["bottom_tabs", "tabs", "icon_set", "quick_entrance"]) {
            if (!Array.isArray(holder[tabKey])) continue;
            const kept = holder[tabKey].filter((t) => {
              if (!isObj(t)) return true;
              const title = String(t.title || t.tab_name || t.name || "");
              return !/多多视频|大转盘|领现金|多多果园|多多买菜|大促会场/.test(title);
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
    // 4. 美团 / 美团外卖 & 饿了么 (*.meituan.com / *.sankuai.com / *.dianping.com / *.ele.me)
    // =========================================================================
    if (/\.(?:meituan|sankuai|dianping)\.com/i.test(url)) {
      // 美团外卖微信小程序
      if (/\/api\/miniprogram/i.test(url) && root.data !== undefined) {
        if (cleanUi && Array.isArray(root.data)) {
          const kept = root.data.filter((i) => isObj(i) && /^(?:首页|神券|我的)$/.test(String(i.name || "")));
          if (kept.length && kept.length !== root.data.length) {
            root.data = kept;
            changed = true;
          }
        } else if (blockAds && isObj(root.data)) {
          dropKeys(root.data, ["oneCentBuy"]);
        }
      }

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

    if (/\.ele\.me/i.test(url)) {
      const d = isObj(root.data) ? root.data : root;
      if (blockAds) {
        if (/mtop\.alsc\.eleme\.miniapp\.homepage/i.test(url) && isObj(d.data)) {
          dropKeys(d.data, ["miniapp_suspension_template", "frontend_suspension_template"]);
        }
        for (const holder of [root, d, isObj(d.data) ? d.data : null, isObj(d.result) ? d.result : null]) {
          if (!isObj(holder)) continue;
          dropKeys(holder, ["float_ad", "popup_ad", "banner_ad", "ad_banners", "splash_ad", "top_ad", "bottom_ad", "floatLayer"]);
          for (const listKey of ["items", "list", "modules", "cards", "restaurants", "feeds", "recommend_list", "resultList"]) {
            filterArray(holder, listKey, isShoppingAdItem);
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
