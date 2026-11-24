//=======================================================================================
// Zhihu Clean — 知乎开屏 / 推荐流 / 回答 / 评论 / 配置清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


//=======================================================================================
// Zhihu Clean — 知乎开屏、推荐流、热榜、关注流、回答页、评论区、搜索与云控配置清理
//
// 配合规则层的硬编码 IP / HTTPDNS 阻断 (118.89.204.198 / 103.41.167.237 / IPv6)，
// 并在 appcloud2.zhihu.com/v3/config 关闭客户端 LocalDNS / BackUpIP，强制走标准域名 MITM。
//
// 覆盖接口（同时兼容带 /api/v4/ 与无 /api/v4/ 前缀的 App 真实路径）：
//   appcloud2.zhihu.com/v3/config               关闭 LocalDNS/备用IP、推迟活动 Tab 与灰度模式
//   m-cloud.zhihu.com/api/cloud/config/all      关闭 feed_gray_theme / feed_top_res
//   /commercial_api/app_float_layer             首页右下角悬浮动图
//   /commercial_api/(launch_v2|real_time_launch_v2) 开屏广告
//   /topstory/recommend(_v\d)?                  首页推荐流（含 offset 重排 & 可选过滤盐选/直播）
//   /(v2/)?topstory/hot-lists/*                 热榜（兼容 data[] 与 data.data[]「合作推广」）
//   /moments_v\d+                               关注页推荐插入卡
//   /(api/v4/|v4/)?questions/\d+/(feeds|answers) 问题回答列表（去 ad_info / 付费回答）
//   /answers/v2/* & /articles/v2/*              新版回答详情下的相关搜索推广
//   /api/v4/(answers|articles)/\d+/recommendations? 回答/文章底部推荐卡
//   /next-bff | /next-data | /next-render       回答流下条/推荐加载（含 origin_data & data.data[]）
//   /bazaar/vip_tab/header                      会员页横幅/弹窗
//   /feed/render/tab/config & /root/tab         顶部冗余活动/直播 Tab (clean_ui)
//   /(api/v4/)?comment(_v\d+|s)/                评论区广告插件与推广评论
//   /(api/v4/)?search                           搜索结果与热搜商业词
//
// 保护字符串外的 16+ 位回答/问题 ID 整数，避免 JSON.parse 丢精度。
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

  const isZhihuAdItem = (item) => {
    if (!isObj(item)) return false;
    if (blockAds) {
      if (item.type === "feed_advert" || item.type === "advert" || item.card_type === "feed_advert") return true;
      if (typeof item.type === "string" && /(?:^|_)ad(?:vert)?(?:_|$)/i.test(item.type)) return true;
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
      if (typeof footerText === "string" && /广告/.test(footerText)) return true;
      if (isObj(item.target) && (truthy(item.target.is_ad) || nonEmptyObj(item.target.ad_info))) return true;
      if (isObj(item.object) && (truthy(item.object.is_ad) || nonEmptyObj(item.object.ad_info))) return true;
      // 热榜合作推广
      const metricsText = item.target?.metrics_area?.text;
      if (typeof metricsText === "string" && metricsText.includes("合作推广")) return true;
      // next-bff 回答下条推广
      if (isObj(item.origin_data)) {
        const od = item.origin_data;
        if (typeof od.type === "string" && od.type.includes("ad")) return true;
        if (typeof od.resource_type === "string" && od.resource_type.includes("ad")) return true;
        if (typeof od.next_guide?.title === "string" && od.next_guide.title.includes("推荐")) return true;
      }
      // 关注流为您推荐
      if (/\/moments_v\d+/.test(path) && typeof item.title === "string" && item.title.includes("为您推荐")) {
        return true;
      }
    }
    if (cleanUi) {
      const extraType = String(item.extra?.type || "");
      if (/^(?:km_sku|market_card|edu_card|training_camp|drama|live)$/i.test(extraType)) return true;
      if (item.type === "market_card" || item.card_type === "market_card" || item.promotion_card) return true;
      if (typeof item.type === "string" && item.type.includes("aggregation_card")) return true;
      const sourceText = item.common_card?.feed_content?.source_line?.elements?.[1]?.text?.panel_text;
      if (typeof sourceText === "string" && sourceText.includes("盐选")) return true;
      if (typeof item.target?.answer_type === "string" && /paid/i.test(item.target.answer_type)) return true;
      if (typeof item.data?.answer_type === "string" && /paid/i.test(item.data.answer_type)) return true;
      if (typeof item.business_type === "string" && /paid/i.test(item.business_type)) return true;
    }
    return false;
  };

  const filterDataList = (holder, key, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return false;
    const list = holder[key];
    const kept = list.filter((item) => !isObj(item) || !isZhihuAdItem(item));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
      return true;
    }
    return false;
  };

  const dropAdFields = (obj) => {
    if (!isObj(obj)) return;
    const keys = [
      "ad_info",
      "adjson",
      "ad",
      "advert",
      "ad_plugin_infos",
      "activity_topping_info",
      "promotion_info",
      "query_info",
    ];
    if (cleanUi) keys.push("km_vip_info", "vip_switches", "goods_card", "mcn_link_list");
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
        delete obj[k];
        changed = true;
      }
    }
  };

  try {
    // 1. appcloud2 云控配置：关闭客户端本地 DNS / 备用 IP（防止绕过 MITM），推迟活动 Tab 与灰度模式
    if (/appcloud2\.zhihu\.com\/v\d+\/config\b/.test(path) && isObj(data.config)) {
      const cfg = data.config;
      if (isObj(cfg.zhcnh_thread_sync)) {
        cfg.zhcnh_thread_sync.LocalDNSSetHostWhiteList = [];
        cfg.zhcnh_thread_sync.isOpenLocalDNS = "0";
        cfg.zhcnh_thread_sync.ZHBackUpIP_Switch_Open = "0";
        cfg.zhcnh_thread_sync.dns_ip_detector_operation_lock = "1";
        cfg.zhcnh_thread_sync.ZHHTTPSessionManager_setupZHHTTPHeaderField = "1";
        changed = true;
      }
      if (blockAds) {
        if (isObj(cfg.homepage_feed_tab) && Array.isArray(cfg.homepage_feed_tab.tab_infos)) {
          cfg.homepage_feed_tab.tab_infos = cfg.homepage_feed_tab.tab_infos.filter((i) => {
            if (isObj(i) && i.tab_type === "activity_tab") {
              i.start_time = "3818332800";
              i.end_time = "3818419199";
              return true;
            }
            return false;
          });
          changed = true;
        }
        if (cfg.hp_channel_tab !== undefined) {
          delete cfg.hp_channel_tab;
          changed = true;
        }
        if (isObj(cfg.zombie_conf) && cfg.zombie_conf.zombieEnable) {
          cfg.zombie_conf.zombieEnable = false;
          changed = true;
        }
        if (isObj(cfg.gray_mode)) {
          cfg.gray_mode.start_time = "3818332800";
          cfg.gray_mode.end_time = "3818419199";
          changed = true;
        }
        if (cfg.is_show_followguide_alert) {
          cfg.is_show_followguide_alert = false;
          changed = true;
        }
      }
    }

    // 2. m-cloud 云控主题/顶栏资源
    if (/\/api\/cloud\/config\/all\b/.test(path) && blockAds && Array.isArray(data.data?.configs)) {
      for (const item of data.data.configs) {
        if (!isObj(item)) continue;
        if ((item.configKey === "feed_gray_theme" || item.configKey === "feed_top_res") && isObj(item.configValue)) {
          item.configValue.start_time = "3818332800";
          item.configValue.end_time = "3818419199";
          item.status = false;
          changed = true;
        }
      }
    }

    // 3. 首页右下角悬浮动图 (/commercial_api/app_float_layer)
    if (/\/commercial_api\/app_float_layer\b/.test(path) && blockAds) {
      if (Object.prototype.hasOwnProperty.call(data, "feed_egg")) {
        $done({ body: "{}" });
        return;
      }
    }

    // 4. 开屏广告 (/commercial_api/launch_v2, /commercial_api/real_time_launch_v2)
    if (/\/commercial_api\/(?:launch_v\d+|real_time_launch_v\d+)/.test(path) && blockAds) {
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
            let launchChanged = false;
            for (const k of ["ads", "launch_ads"]) {
              if (Array.isArray(launchObj[k]) && launchObj[k].length) {
                launchObj[k] = [];
                launchChanged = true;
              }
            }
            if (launchChanged) {
              data.launch = JSON.stringify(launchObj);
              changed = true;
            }
          }
        } catch (e) {}
      }
    }

    // 5. 首页推荐流、热榜与关注流 (/topstory/recommend(_v\d)?, /(v2/)?topstory/hot-lists/*, /moments_v\d+)
    if (/\/(?:(?:v\d+\/)?topstory\/(?:recommend(?:_v\d+)?|hot-lists)|moments_v\d+)/.test(path)) {
      const didFilter = filterDataList(data, "data");
      // v2/topstory/hot-lists/everyone-seeing 是两层 data.data[]
      if (isObj(data.data) && Array.isArray(data.data.data)) {
        filterDataList(data.data, "data");
      }
      if (didFilter && /\/topstory\/recommend/.test(path) && Array.isArray(data.data)) {
        // 推荐流删除卡片后必须重排 offset，避免客户端分页错位
        for (let i = 0; i < data.data.length; i++) {
          if (isObj(data.data[i]) && typeof data.data[i].offset === "number") {
            data.data[i].offset = i + 1;
          }
        }
      }
      if (blockAds) {
        dropAdFields(data);
        if (Array.isArray(data.data)) {
          for (const item of data.data) dropAdFields(item);
        }
      }
    }

    // 6. 新版回答/文章详情页的相关提问推广 (/answers/v2/\d+, /articles/v2/\d+)
    if (/\/(?:answers|articles)\/v\d+\/\d+/.test(path) && blockAds) {
      if (Array.isArray(data.third_business?.related_queries?.queries) && data.third_business.related_queries.queries.length) {
        data.third_business.related_queries.queries = [];
        changed = true;
      }
    }

    // 7. 网页/App 回答与文章底部推荐 (/api/v4/(answers|articles)/\d+/recommendations?)
    if (/\/api\/v\d+\/(?:answers|articles)\/\d+\/recommendations?\b/.test(path) && blockAds) {
      for (const k of ["data", "paging", "ad_info", "recommend_info"]) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          delete data[k];
          changed = true;
        }
      }
    }

    // 8. 问题回答列表与 next-bff / next-data / next-render（兼容带或不带 /api/v4/）
    if (
      /\/(?:(?:api\/v\d+\/|v\d+\/)?(?:questions\/\d+\/(?:answers|feeds)|answers\/)|next-(?:bff|data|render))/.test(path) &&
      !/\/recommendations?\b/.test(path) &&
      !/\/(?:answers|articles)\/v\d+\/\d+/.test(path)
    ) {
      if (blockAds || cleanUi) {
        // next-render 额外过滤 section_info / tips / adjson
        if (/\/next-render\b/.test(path) && Array.isArray(data.data)) {
          const kept = data.data.filter(
            (i) => !isObj(i) || (!isZhihuAdItem(i) && !(blockAds && (i.section_info || i.tips)))
          );
          if (kept.length !== data.data.length && kept.length > 0) {
            data.data = kept;
            changed = true;
          }
        } else {
          filterDataList(data, "data");
        }
        // next-data 是两层 data.data[]
        if (isObj(data.data)) {
          filterDataList(data.data, "data");
          dropAdFields(data.data);
        }
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

    // 9. 会员页顶部横幅/弹窗 (/bazaar/vip_tab/header)
    if (/\/bazaar\/vip_tab\/header\b/.test(path) && blockAds) {
      for (const k of ["activity_banner", "activity_window", "vip_tip"]) {
        if (data[k] !== undefined) {
          delete data[k];
          changed = true;
        }
      }
    }

    // 10. 首页顶部 Tab 配置 (/feed/render/tab/config, /root/tab)
    if (cleanUi && /\/feed\/render\/tab\/config\b/.test(path) && Array.isArray(data.selected_sections)) {
      const kept = data.selected_sections.filter((i) => !isObj(i) || !/^(?:activity|live)$/.test(String(i.tab_type || "")));
      if (kept.length && kept.length !== data.selected_sections.length) {
        data.selected_sections = kept;
        changed = true;
      }
    }
    if (cleanUi && /\/root\/tab\b/.test(path) && Array.isArray(data.tab_list)) {
      const kept = data.tab_list.filter((i) => !isObj(i) || !/^(?:故事|活动)$/.test(String(i.tab_name || "")));
      if (kept.length && kept.length !== data.tab_list.length) {
        data.tab_list = kept;
        changed = true;
      }
    }

    // 11. 评论区（兼容 /comment_v5/* 与 /api/v4/comment*）
    if (/\/(?:api\/v\d+\/)?comment(?:_v\d+|s)\//.test(path) && blockAds) {
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

    // 12. 搜索与热搜词（兼容 /search/* 与 /api/v4/search*）
    if (/\/(?:api\/v\d+\/)?search\b/.test(path) && blockAds) {
      dropAdFields(data);
      filterDataList(data, "data");
      filterDataList(data, "top_search_words");
      filterDataList(data, "preset_words");
      if (isObj(data.top_search) && Array.isArray(data.top_search.words)) {
        filterDataList(data.top_search, "words");
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
