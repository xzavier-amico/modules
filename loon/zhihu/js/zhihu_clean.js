//=======================================================================================
// Zhihu Clean — 知乎开屏 / 推荐流 / 回答 / 评论广告清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


//=======================================================================================
// Zhihu Clean — 知乎开屏、推荐流、回答页、评论区与搜索广告清理
//
// 只改 JSON 响应，按结构删数组元素或字段，不碰正常回答正文与图片：
//
//   /commercial_api/(launch_v2|real_time_launch_v2)
//     开屏广告：清空 launch_ads / ads，把投放时间推到 2040 年
//   /topstory/recommend | /topstory/hot-lists/* | /v2/topstory/hot-lists/*
//     首页推荐流与热榜：过滤 data[] 里 type="feed_advert"、带 adjson / ad / promotion_extra 的广告卡；
//     clean_ui=true 时额外过滤盐选专栏 / 付费训练营营销卡 (extra.type="km_sku" / market_card)
//   /api/v4/questions/*/answers | /api/v4/answers/* | /next-bff | /next-data | /next-render
//     回答列表与详情：剥离 ad_info / adjson / activity_topping_info / BrandAd 等插页广告与底部推荐商品
//   /api/v4/comment_v5/* | /api/v4/comments/*
//     评论区：清理 ad_plugin_infos 与带 ad_info / is_ad 的推广评论
//   /api/v4/search/* | /api/v4/search_v3
//     搜索结果與热搜：过滤带 ad_info / is_ad / promotion_info 的商业搜索词与结果卡
//
// 保护字符串外的 16+ 位回答/问题 ID 整数，防止 JSON.parse 丢精度。
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

  // 知乎回答 / 文章 ID 常达 19 位整数，先用占位符保护字符串外的 16+ 位整数。
  const BIGINT_MARK = "__zh_bigint_";
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
  const nonEmptyStr = (v) => typeof v === "string" && v.trim().length > 0;

  // ---------- 推荐流 / 热榜 / 搜索卡片判定 ----------
  const isZhihuAdItem = (item) => {
    if (!isObj(item)) return false;
    if (blockAds) {
      if (item.type === "feed_advert" || item.type === "advert" || item.card_type === "feed_advert") return true;
      if (truthy(item.is_ad) || truthy(item.isAd)) return true;
      if (
        item.type !== "answer" &&
        item.type !== "article" &&
        (nonEmptyStr(item.adjson) || nonEmptyObj(item.ad) || nonEmptyObj(item.ad_info) || nonEmptyObj(item.advert))
      ) {
        return true;
      }
      if (nonEmptyObj(item.promotion_extra) || nonEmptyObj(item.brand_info)) return true;
      const video = item.common_card?.feed_content?.video;
      if (isObj(video) && truthy(video.is_ad)) return true;
      const footerText = item.common_card?.footline?.elements?.[0]?.text?.panel_text;
      if (typeof footerText === "string" && /^广告/.test(footerText.trim())) return true;
      if (isObj(item.target) && (truthy(item.target.is_ad) || nonEmptyObj(item.target.ad_info))) return true;
      if (isObj(item.object) && (truthy(item.object.is_ad) || nonEmptyObj(item.object.ad_info))) return true;
    }
    if (cleanUi) {
      // 盐选故事 / 知乎严选训练营推广卡
      const extraType = String(item.extra?.type || "");
      if (/^(?:km_sku|market_card|edu_card|training_camp|drama|live)$/i.test(extraType)) return true;
      if (item.type === "market_card" || item.card_type === "market_card" || item.promotion_card) return true;
    }
    return false;
  };

  const filterDataList = (holder, key) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = list.filter((item) => !isObj(item) || !isZhihuAdItem(item));
    if (kept.length && kept.length !== list.length) {
      holder[key] = kept;
      changed = true;
    }
  };

  const dropAdFields = (obj) => {
    if (!isObj(obj)) return;
    const keys = ["ad_info", "adjson", "ad", "advert", "ad_plugin_infos", "activity_topping_info", "promotion_info"];
    if (cleanUi) keys.push("km_vip_info", "vip_switches", "goods_card", "mcn_link_list");
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
        delete obj[k];
        changed = true;
      }
    }
  };

  try {
    // 1. 开屏广告 (/commercial_api/launch_v2, /commercial_api/real_time_launch_v2)
    if (/\/commercial_api\/(?:launch_v2|real_time_launch_v2)/.test(path)) {
      if (blockAds) {
        for (const k of ["launch_ads", "ads", "data", "feed_ads"]) {
          if (Array.isArray(data[k]) && data[k].length) {
            data[k] = [];
            changed = true;
          }
        }
        if (typeof data.launch === "string" && data.launch.length > 2) {
          try {
            const launchObj = JSON.parse(data.launch);
            if (isObj(launchObj)) {
              for (const k of ["ads", "launch_ads"]) {
                if (Array.isArray(launchObj[k]) && launchObj[k].length) {
                  launchObj[k] = [];
                  changed = true;
                }
              }
              if (changed) data.launch = JSON.stringify(launchObj);
            }
          } catch (e) {}
        }
      }
    }

    // 2. 首页推荐流与热榜 (/topstory/recommend, /topstory/hot-lists, /v2/topstory/hot-lists)
    if (/\/topstory\/(?:recommend|hot-lists)/.test(path)) {
      filterDataList(data, "data");
      if (blockAds) {
        dropAdFields(data);
        if (Array.isArray(data.data)) {
          for (const item of data.data) {
            dropAdFields(item);
          }
        }
      }
    }

    // 3. 问题回答列表与回答详情 (/api/v4/questions/*/answers, /api/v4/answers/*, /next-bff, /next-data, /next-render)
    if (/\/(?:api\/v4\/(?:questions\/[^/]+\/answers|answers\/)|next-(?:bff|data|render))/.test(path)) {
      if (blockAds || cleanUi) {
        filterDataList(data, "data");
        if (Array.isArray(data.data)) {
          for (const item of data.data) {
            dropAdFields(item);
            if (isObj(item) && isObj(item.target)) dropAdFields(item.target);
          }
        }
        dropAdFields(data);
        if (isObj(data.paging) && isObj(data.paging.previous)) {
          dropAdFields(data.paging.previous);
        }
      }
    }

    // 4. 评论区 (/api/v4/comment_v5/*, /api/v4/comments/*)
    if (/\/api\/v4\/comment(?:_v5|s)\//.test(path)) {
      if (blockAds) {
        dropAdFields(data);
        filterDataList(data, "data");
        if (Array.isArray(data.data)) {
          for (const c of data.data) {
            if (!isObj(c)) continue;
            dropAdFields(c);
            filterDataList(c, "child_comments");
          }
        }
      }
    }

    // 5. 搜索与热搜词 (/api/v4/search/*, /api/v4/search_v3)
    if (/\/api\/v4\/search/.test(path)) {
      if (blockAds) {
        dropAdFields(data);
        filterDataList(data, "data");
        filterDataList(data, "top_search_words");
        filterDataList(data, "preset_words");
        if (isObj(data.top_search) && Array.isArray(data.top_search.words)) {
          filterDataList(data.top_search, "words");
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
