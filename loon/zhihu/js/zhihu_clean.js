//=======================================================================================
// Zhihu Clean — 知乎开屏 / 推荐流 / 回答 / 评论 / 配置清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


//=======================================================================================
// Zhihu Clean — 知乎开屏、推荐流广告、文章/回答底部全清、漂浮广告与云控配置清理
//
// 配合规则层的硬编码 IP / HTTPDNS 阻断 (118.89.204.198 / 103.41.167.237 / IPv6)，
// 并在 appcloud2.zhihu.com/v3/config 关闭客户端 LocalDNS / BackUpIP，强制走标准域名 MITM。
//
// 覆盖接口（同时兼容带 /api/v4/ 与无 /api/v4/ 前缀的 App 真实路径）：
//   appcloud2.zhihu.com/v3/config               关闭 LocalDNS/备用IP、推迟活动 Tab 与灰度模式
//   m-cloud.zhihu.com/api/cloud/config/all      关闭 feed_gray_theme / feed_top_res
//   /commercial_api/app_float_layer             首页与文章内漂浮广告（直接返回 {}）
//   /commercial_api/(launch_v2|real_time_launch_v2) 开屏广告
//   /(v\d+/|feed/)?topstory/(recommend*|feed|hot-lists)
//                                               首页推荐流与热榜：遍历 footline/source_line/brief/
//                                               adjson/extra 彻底过滤伪装广告与盐选推广，并重排 offset
//   /moments(_v\d+)?                            关注页推荐插入卡
//   /next-bff | /next-data | /next-render       文章/回答底部推荐流（推文/相关回答/广告）：
//                                               clean_ui=true（默认）时彻底清空 data 并置 paging.is_end=true，
//                                               让文章底部只留点赞/评论等操作栏！
//   /answers/v2/* & /articles/v2/*              文章/回答扩展信息：剥离 third_business 里的相关搜索、
//                                               底部推文、带货卡与悬浮挂件，保留点赞/评论/正文
//   /(api/v\d+/|v\d+/)?(answers|articles)/\d+/(recommendations?|related-readings)
//                                               文章/回答底部相关推荐清空
//   /(api/v\d+/|v\d+/)?questions/\d+/(feeds|answers) 问题回答列表去广告与付费推文
//   /bazaar/vip_tab/header & /feed/render/tab/config & /root/tab
//   /(api/v\d+/)?comment(_v\d+|s)/ & /(api/v\d+/)?search
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

  // 扫描 elements[]（footline / source_line / tag_area）里任意位置的文本与标签
  const elementsMatchRe = (elements, re) => {
    if (!Array.isArray(elements) || !elements.length) return false;
    for (const el of elements) {
      if (!isObj(el)) continue;
      for (const txt of [
        el.text?.panel_text,
        el.text?.text,
        typeof el.text === "string" ? el.text : "",
        el.tag?.text,
        el.label?.text,
        el.badge?.text,
        el.content,
      ]) {
        if (typeof txt === "string" && txt && re.test(txt)) return true;
      }
    }
    return false;
  };

  const AD_LABEL_RE = /广告|推广|赞助|品牌特约|品牌推广|商业推广|知乎推广|商品推荐|好物推荐/;
  const UI_LABEL_RE = /盐选|严选|知乎故事|训练营|付费咨询|知学堂|直播中/;
  const BRIEF_AD_RE = /"(?:ad_id|ad_type|is_ad|ad_extra|commercial_info|feed_advert|advert_id)"|"(?:source|type)"\s*:\s*"(?:ad|advert|commercial|feed_advert|brand)"/i;
  const BRIEF_UI_RE = /"(?:type|content_type|sub_type)"\s*:\s*"(?:km_sku|market_card|paid_column|vip_story|drama|live|edu_card|training_camp)"/i;

  const isZhihuAdItem = (item) => {
    if (!isObj(item)) return false;
    const cc = isObj(item.common_card) ? item.common_card : null;
    const fc = isObj(cc?.feed_content) ? cc.feed_content : null;

    if (blockAds) {
      const t = String(item.type || item.card_type || "");
      if (
        t === "feed_advert" ||
        t === "advert" ||
        t === "slot_event_card" ||
        t === "banner_card" ||
        t === "promotion_card" ||
        /(?:^|_)ad(?:vert)?(?:_|$)/i.test(t)
      ) {
        return true;
      }
      if (truthy(item.is_ad) || truthy(item.isAd) || truthy(cc?.is_ad) || truthy(item.extra?.is_ad)) return true;
      if (
        item.type !== "answer" &&
        item.type !== "article" &&
        (nonEmptyStr(item.adjson) ||
          nonEmptyStr(cc?.adjson) ||
          nonEmptyStr(item.fields?.adjson) ||
          nonEmptyObj(item.ad) ||
          nonEmptyObj(item.ad_info) ||
          nonEmptyObj(cc?.ad_info) ||
          nonEmptyObj(item.fields?.ad_info) ||
          nonEmptyObj(item.advert) ||
          nonEmptyObj(item.ad_extra) ||
          nonEmptyObj(cc?.ad_extra) ||
          nonEmptyObj(item.commercial_info) ||
          nonEmptyObj(cc?.commercial_info))
      ) {
        return true;
      }
      if (
        nonEmptyObj(item.promotion_extra) ||
        nonEmptyObj(cc?.promotion_extra) ||
        nonEmptyObj(item.brand_info) ||
        nonEmptyObj(cc?.brand_info) ||
        truthy(item.fields?.is_ad)
      ) {
        return true;
      }
      if (nonEmptyObj(item.action_card) && truthy(item.action_card.is_ad)) return true;
      if (typeof item.brief === "string" && BRIEF_AD_RE.test(item.brief)) return true;
      if (isObj(fc?.video) && truthy(fc.video.is_ad)) return true;

      // 遍历 footline / source_line / tag_area 全部元素（不再只查 elements[0]/[1]！）
      if (elementsMatchRe(cc?.footline?.elements, AD_LABEL_RE)) return true;
      if (elementsMatchRe(fc?.source_line?.elements, AD_LABEL_RE)) return true;
      if (elementsMatchRe(fc?.tag_area?.elements, AD_LABEL_RE)) return true;
      if (typeof item.card_label?.text === "string" && AD_LABEL_RE.test(item.card_label.text)) return true;
      if (typeof item.target?.label_info?.text === "string" && AD_LABEL_RE.test(item.target.label_info.text)) return true;

      const extraType = String(item.extra?.type || "");
      if (/^(?:ad|advert|commercial|feed_advert|brand|promotion|ecom|commerce|goods|plugin)$/i.test(extraType)) {
        return true;
      }
      if (isObj(item.target) && (truthy(item.target.is_ad) || nonEmptyObj(item.target.ad_info) || nonEmptyStr(item.target.adjson))) {
        return true;
      }
      if (isObj(item.object) && (truthy(item.object.is_ad) || nonEmptyObj(item.object.ad_info))) return true;
      const metricsText = item.target?.metrics_area?.text;
      if (typeof metricsText === "string" && /合作推广|广告/.test(metricsText)) return true;
      if (isObj(item.origin_data)) {
        const od = item.origin_data;
        if (typeof od.type === "string" && od.type.includes("ad")) return true;
        if (typeof od.resource_type === "string" && od.resource_type.includes("ad")) return true;
        if (typeof od.next_guide?.title === "string" && od.next_guide.title.includes("推荐")) return true;
      }
      if (/\/moments/.test(path) && typeof item.title === "string" && item.title.includes("为您推荐")) {
        return true;
      }
    }

    if (cleanUi) {
      const extraType = String(item.extra?.type || "");
      if (
        /^(?:km_sku|market_card|edu_card|training_camp|drama|live|paid_column|vip_story|story|ebook|club|remix_album)$/i.test(
          extraType
        )
      ) {
        return true;
      }
      if (item.type === "market_card" || item.card_type === "market_card" || item.promotion_card) return true;
      if (typeof item.type === "string" && item.type.includes("aggregation_card")) return true;
      if (typeof item.brief === "string" && BRIEF_UI_RE.test(item.brief)) return true;
      if (elementsMatchRe(cc?.footline?.elements, UI_LABEL_RE)) return true;
      if (elementsMatchRe(fc?.source_line?.elements, UI_LABEL_RE)) return true;
      if (elementsMatchRe(fc?.tag_area?.elements, UI_LABEL_RE)) return true;
      if (typeof item.target?.label_info?.text === "string" && UI_LABEL_RE.test(item.target.label_info.text)) return true;
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
      "ad_extra",
      "commercial_info",
      "ad_plugin_infos",
      "activity_topping_info",
      "promotion_info",
      "query_info",
      "floating_ad",
      "float_layer",
      "float_window",
      "pendant",
      "pendant_info",
      "bubble_info",
    ];
    if (cleanUi) {
      keys.push(
        "km_vip_info",
        "vip_switches",
        "goods_card",
        "mcn_link_list",
        "recommend_info",
        "related_readings",
        "bottom_card",
        "bottom_banner",
        "recommend_list"
      );
    }
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, k) && obj[k] !== undefined && obj[k] !== null) {
        delete obj[k];
        changed = true;
      }
    }
  };

  const markPagingEnd = (obj) => {
    if (!isObj(obj)) return;
    if (isObj(obj.paging)) {
      if (!obj.paging.is_end) {
        obj.paging.is_end = true;
        changed = true;
      }
      if (obj.paging.next) {
        obj.paging.next = "";
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

    // 3. 首页与文章内漂浮广告 (/commercial_api/app_float_layer, /commercial_api/ad_float_layer)
    if (/\/commercial_api\/(?:app|ad)_float_layer\b/.test(path) && blockAds) {
      $done({ body: "{}" });
      return;
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

    // 5. 首页推荐流、预加载流、热榜与关注流
    if (/\/(?:(?:v\d+\/|feed\/)?(?:preload-)?topstory\/(?:recommend[\w-]*|hot-lists|feed)|preload-topstory|moments(?:_v\d+)?)/.test(path)) {
      const didFilter = filterDataList(data, "data");
      if (isObj(data.data) && Array.isArray(data.data.data)) {
        filterDataList(data.data, "data");
      }
      if (didFilter && /topstory\/recommend/.test(path) && Array.isArray(data.data)) {
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

    // 6. 文章/回答详情扩展接口 (/answers/v2/\d+, /articles/v2/\d+, /(api/v4/|v4/)?(answers|articles)/\d+)
    //    保留正文、点赞、评论数等核心字段，彻底清除底部相关提问、推文卡片、带货卡与悬浮广告！
    if (/\/(?:answers|articles)\/v\d+\/\d+/.test(path) || /\/(?:(?:api\/v\d+|v\d+)\/)?(?:answers|articles)\/\d+$/.test(path)) {
      if (blockAds || cleanUi) {
        dropAdFields(data);
        if (isObj(data.third_business)) {
          const tb = data.third_business;
          if (Array.isArray(tb.related_queries?.queries) && tb.related_queries.queries.length) {
            tb.related_queries.queries = [];
            changed = true;
          }
          for (const k of Object.keys(tb)) {
            if (
              k === "related_queries" ||
              /ad|promo|recommend|goods|mcn|float|pendant|bubble|banner|commercial|card|plugin|bottom|shop|vip|market|km/i.test(
                k
              )
            ) {
              if (k === "related_queries") {
                if (cleanUi) {
                  delete tb[k];
                  changed = true;
                }
              } else {
                delete tb[k];
                changed = true;
              }
            }
          }
        }
        // 清理正文附加挂件（plugin_info / commercial_card / floating_widgets / ad_cards）
        for (const k of [
          "plugin_info",
          "commercial_card",
          "floating_widgets",
          "float_widgets",
          "ad_cards",
          "recommend_cards",
          "related_articles",
          "related_answers",
          "more_recommendations",
        ]) {
          if (data[k] !== undefined && data[k] !== null) {
            delete data[k];
            changed = true;
          }
        }
      }
    }

    // 7. 文章/回答底部推荐与相关阅读 (/recommendations?, /related-readings)
    if (/\/(?:recommendations?|related-readings)\b/.test(path) && (blockAds || cleanUi)) {
      if (Array.isArray(data.data) && data.data.length) {
        data.data = [];
        changed = true;
      } else if (data.data !== undefined && !Array.isArray(data.data)) {
        delete data.data;
        changed = true;
      }
      for (const k of ["paging", "ad_info", "recommend_info"]) {
        if (Object.prototype.hasOwnProperty.call(data, k)) {
          delete data[k];
          changed = true;
        }
      }
    }

    // 8. 文章/回答底部推文与下条加载 (/next-bff, /next-data, /next-render)
    //    clean_ui=true（默认）时彻底清空底部推文流并标记 paging.is_end=true，让文章下面只留操作按钮！
    if (/\/next-(?:bff|data|render)\b/.test(path)) {
      if (cleanUi) {
        for (const k of ["data", "items", "recommends", "cards"]) {
          if (Array.isArray(data[k]) && data[k].length) {
            data[k] = [];
            changed = true;
          }
        }
        if (isObj(data.data)) {
          for (const k of ["data", "items", "recommends", "cards"]) {
            if (Array.isArray(data.data[k]) && data.data[k].length) {
              data.data[k] = [];
              changed = true;
            }
          }
        }
        dropAdFields(data);
        if (isObj(data.data)) dropAdFields(data.data);
        markPagingEnd(data);
        markPagingEnd(data.data);
      } else if (blockAds) {
        if (/\/next-render\b/.test(path) && Array.isArray(data.data)) {
          const kept = data.data.filter((i) => !isObj(i) || (!isZhihuAdItem(i) && !i.section_info && !i.tips));
          if (kept.length !== data.data.length) {
            data.data = kept;
            changed = true;
          }
        } else {
          filterDataList(data, "data", true);
        }
        if (isObj(data.data)) {
          filterDataList(data.data, "data", true);
          dropAdFields(data.data);
        }
        dropAdFields(data);
      }
    }

    // 9. 问题详情与回答列表 (/(api/v4/|v4/)?questions/\d+(/(answers|feeds))?)
    if (/\/(?:api\/v\d+\/|v\d+\/)?questions\/\d+(?:\/(?:answers|feeds))?$/.test(path)) {
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

    // 10. 会员页顶部横幅/弹窗 (/bazaar/vip_tab/header)
    if (/\/bazaar\/vip_tab\/header\b/.test(path) && blockAds) {
      for (const k of ["activity_banner", "activity_window", "vip_tip"]) {
        if (data[k] !== undefined) {
          delete data[k];
          changed = true;
        }
      }
    }

    // 11. 首页顶部 Tab 配置 (/feed/render/tab/config, /root/tab)
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

    // 12. 评论区（兼容 /comment_v5/* 与 /api/v4/comment*）
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

    // 13. 搜索与热搜词（兼容 /search/* 与 /api/v4/search*）
    if (/\/(?:api\/v\d+\/)?search\b/.test(path) && blockAds) {
      dropAdFields(data);
      filterDataList(data, "data");
      filterDataList(data, "top_search_words");
      filterDataList(data, "preset_words");
      if (isObj(data.top_search) && Array.isArray(data.top_search.words)) {
        filterDataList(data.top_search, "words");
      }
      if (nonEmptyObj(data.recommend_queries)) {
        data.recommend_queries = {};
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
  $done({ body: out });
})();
