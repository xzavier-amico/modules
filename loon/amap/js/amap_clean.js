//=======================================================================================
// AMap Clean — 高德地图 JSON 广告清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


//=======================================================================================
// AMap Clean — 高德地图 JSON 广告清理
//
// 只处理「业务数据里夹着广告位」的接口；只返回广告的接口交给模块里的 URL Rewrite。
// 所有改写都是按结构删字段 / 删数组元素，结构对不上、解析失败、响应过大都原样放行。
//
// 已知接口（17.3.x）：
//   /ws/valueadded/alimama/splash_screen   开屏素材：把广告有效期推到未来
//   /ws/faas/amap-navigation/main-page     首页：删广告卡，清广告楼层
//   /ws/faas/amap-navigation/usr-profile-fc/homeV2
//                                          「我的」：删 tipData 与推荐 / 广告卡
//                                          （地址取自 AOCS amap_basemap_config
//                                           .usercenter_performance_optimization.home_api_url）
//   /ws/shield/dsp/profile/index/nodefaas  旧版「我的」，保留兼容
//   /ws/shield/search/new_hotword          搜索热词：清 header_hotword
//   /ws/promotion-web/resource             打车页运营位：清 icon / banner / tips 等
//   /ws/msgbox/pull                        消息盒子：清 msgs
//   /ws/message/notice/list                消息中心：清 noticeList
//   /ws/shield/frogserver/aocs/updatable   首页可更新配置：清角标 / 运营层 / AI 入口
//   /ws/shield/search/nearbyrec_smart      附近推荐：删券、活动、商品推荐
//   /v1/ai_rec/home_explore                探索 tab：SSE 流，逐个事件摘掉推荐卡片
//=======================================================================================

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  const req = (typeof $request !== "undefined" && $request) || null;
  const url = res.url || (req && req.url) || "";
  const body = res.body;

  // ---------------------------------------------------------------- 探索 tab（SSE）
  // ai_rec 返回 text/event-stream，每个事件是一个 JSON 增量，结构为
  //   component.data.data.{modules, regions.content}
  // modules 是模块数据，regions.content 是渲染顺序表。只删 modules 里的数据而
  // 把名字留在 regions 里，客户端会渲染出空白块；两边要一起删。
  // 保留地图相关模块（AiMapPoints / AiExploreMap / AiMapRoutes 等），
  // 只摘掉推荐卡片，这样页面还是能用的地图 + 点位。
  if (/\/v1\/ai_rec\/home_explore/.test(url)) {
    const FEED_MODULES = ["MdCard_Explore_0", "ContentCard_0", "AiCardContainer_0", "PmtContainer", "PmtMultiCard"];
    let hit = false;
    const lines = body.split("\n").map((line) => {
      const prefix = /^data:\s*/.exec(line);
      if (!prefix) return line;
      let ev;
      try {
        ev = JSON.parse(line.slice(prefix[0].length));
      } catch (e) {
        return line;
      }
      const node = ev && ev.component && ev.component.data && ev.component.data.data;
      if (!node || "object" != typeof node) return line;
      let removed = false;
      const modules = node.modules;
      if (modules && "object" == typeof modules) {
        for (const name of FEED_MODULES) {
          if (Object.prototype.hasOwnProperty.call(modules, name)) {
            delete modules[name];
            removed = true;
          }
        }
      }
      const regions = node.regions && node.regions.content;
      if (Array.isArray(regions)) {
        const kept = regions.filter((name) => FEED_MODULES.indexOf(name) < 0);
        if (kept.length !== regions.length) {
          node.regions.content = kept;
          removed = true;
        }
      }
      if (!removed) return line;
      hit = true;
      return prefix[0] + JSON.stringify(ev);
    });
    if (!hit) {
      $done({});
      return;
    }
    $done({ body: lines.join("\n") });
    return;
  }

  // 这些接口都返回 JSON 对象。二进制 / 空响应直接放行。
  if (typeof body !== "string" || !body) {
    $done({});
    return;
  }
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    $done({});
    return;
  }

  // JSON.parse / stringify 会把超过 2^53 的数字截断。只检查字符串外的数字：
  // AOCS 配置里很多 16 位 ID 在 URL 字符串里（shopId 等），不能因此整条放行。
  const numberOutsideStrings = (text) => /\d{16,}/.test(text.replace(/"(?:\\.|[^"\\])*"/g, '""'));
  if (numberOutsideStrings(body)) {
    $done({});
    return;
  }

  let root;
  try {
    root = JSON.parse(body);
  } catch (e) {
    $done({});
    return;
  }
  if (!root || "object" != typeof root) {
    $done({});
    return;
  }

  let changed = false;

  // 清空一个广告位，保持原来的容器类型：数组→[]、对象→{}、字符串→""。
  // 把对象位改成 [] 会让客户端解码失败并弹「网络不畅」，这是之前首页报错的来源。
  // 已经是空值的不重复写，避免没有命中时也返回一个新 body。
  const clear = (holder, key) => {
    if (!holder || "object" != typeof holder) return;
    const value = holder[key];
    if (value === undefined || value === null || value === false || value === 0 || value === "") return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      holder[key] = [];
    } else if ("object" == typeof value) {
      if (!Object.keys(value).length) return;
      holder[key] = {};
    } else if ("string" == typeof value) {
      holder[key] = "";
    } else {
      return;
    }
    changed = true;
  };

  const drop = (holder, key) => {
    if (!holder || "object" != typeof holder) return;
    if (Object.prototype.hasOwnProperty.call(holder, key)) {
      delete holder[key];
      changed = true;
    }
  };

  // 批量删字段，用于 AOCS 这类「整段配置都是运营位」的场景。
  const dropKeys = (holder, keys) => {
    let hit = false;
    for (const key of keys) {
      if (!Object.prototype.hasOwnProperty.call(holder, key)) continue;
      delete holder[key];
      hit = true;
    }
    return hit;
  };

  const cardType = (card) => {
    if (!card || "object" != typeof card) return "";
    const value = card.dataType || card.data_type || card.cardType || card.card_type || card.type;
    return "string" == typeof value ? value : "";
  };

  // 卡片可见文案。新版「我的」页的「好友动态」「猜你喜欢」不一定带广告类型名，
  // 只能靠标题识别；title / name 有时是对象，取里面的 text。
  const cardText = (card) => {
    if (!card || "object" != typeof card) return "";
    const parts = [];
    const add = (value) => {
      if ("string" == typeof value) parts.push(value);
      else if (value && "object" == typeof value && "string" == typeof value.text) parts.push(value.text);
    };
    for (const key of ["title", "name", "text", "subTitle", "sub_title", "cardTitle", "mainTitle", "desc", "description"]) add(card[key]);
    if (card.data && "object" == typeof card.data) {
      for (const key of ["title", "name", "text", "subTitle", "sub_title", "cardTitle", "mainTitle", "desc", "description"]) add(card.data[key]);
    }
    return parts.join(" ");
  };

  // 广告 / 推荐卡的文案与类型。除了 Recommend / Promotion / Coupon / Banner / Ad，
  // 新版「我的」页还有「好友动态」(FriendFeed) 和「猜你喜欢」(GuessYouLike)。
  const AD_TEXT = /好友动态|猜你喜欢|为你推荐|可能感兴趣|附近推荐|热门活动|广告|推广|赞助/;
  const AD_TYPE = /recommend|promotion|promo|coupon|banner|advert|(?:^|[_-])ads?(?:$|[_-]|card|banner|item|module|slot|entry|info|data|list|view|layer|popup|float|tip)|marketing|operation.?activity|commercial/i;
  // 只在「我的」页用的卡片类型：好友动态、猜你喜欢这类社交 / 推荐卡。
  // UserCenter* 是 usr-profile-fc/homeV2 的卡片命名，Nearby=猜你喜欢，
  // Interact=好友动态，MemberVideo=会员视频推广。
  const PROFILE_AD_TYPE = /friend|dynamic|guess|social|interest|discover|nearby|interact|membervideo/i;

  const isAdCard = (card, profile) => {
    if (!card || "object" != typeof card) return false;
    if (card.isAd === true || card.is_ad === true || card.is_ad === 1 || card.isAd === 1) return true;
    if (card.adInfo || card.ad_info || card.ad || card.ads) return true;
    if (AD_TEXT.test(cardText(card))) return true;
    const type = cardType(card);
    return AD_TYPE.test(type) || (profile && PROFILE_AD_TYPE.test(type));
  };

  // 卡片不一定挂在 cardList 上：新版首页 / 「我的」还用过 cards、sections 或更深的
  // 楼层结构。这里递归找「元素像卡片」的数组，只删广告卡，其余原样保留；
  // 某个数组会被删空时跳过，避免客户端拿不到卡片列表。
  const sweepCards = (node, profile, depth) => {
    if (!node || "object" != typeof node || depth > 4) return false;
    let hit = false;
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        const kept = value.filter((item) => !isAdCard(item, profile));
        if (kept.length && kept.length !== value.length) {
          node[key] = kept;
          hit = true;
        }
        for (const item of node[key]) if (sweepCards(item, profile, depth + 1)) hit = true;
      } else if (value && "object" == typeof value) {
        if (sweepCards(value, profile, depth + 1)) hit = true;
      }
    }
    return hit;
  };
  // 首页 / 我的都用「删广告卡」而不是「只留白名单」：白名单会把登录卡、常用地址
  // 之外的正常卡片一起删掉，卡片列表为空时客户端会直接弹「网络不畅」。
  // 同理，一张都剩不下时宁可不改。容器是对象就按对象回写，避免形状变化导致解析失败。
  const filterAdCards = (cardList, profile) => {
    if (Array.isArray(cardList)) {
      const kept = cardList.filter((card) => !isAdCard(card, profile));
      return !kept.length || kept.length === cardList.length ? null : kept;
    }
    if (cardList && "object" == typeof cardList) {
      const keys = Object.keys(cardList);
      const kept = keys.filter((key) => !isAdCard(cardList[key], profile));
      if (!kept.length || kept.length === keys.length) return null;
      const out = {};
      for (const key of kept) out[key] = cardList[key];
      return out;
    }
    return null;
  };

  // ---------------------------------------------------------------- 开屏素材
  const SPLASH = /\/ws\/valueadded\/alimama\/splash_screen(?:[?/]|$)/;
  if (SPLASH.test(url)) {
    // 2240141184 = 0x8585FB80，把起止时间推到 2041 年，客户端判定广告未开始。
    const NOT_STARTED = 2240141184;
    const data = root.data;
    const ads = data && data.ad;
    if (Array.isArray(ads)) {
      for (const ad of ads) {
        if (!ad || "object" != typeof ad) continue;
        if (ad.setting && "object" == typeof ad.setting) {
          if (ad.setting.display_time !== 0) {
            ad.setting.display_time = 0;
            changed = true;
          }
        }
        const creatives = Array.isArray(ad.creative) ? ad.creative : ad.creative && "object" == typeof ad.creative ? [ad.creative] : [];
        for (const creative of creatives) {
          if (!creative || "object" != typeof creative) continue;
          if (creative.start_time !== NOT_STARTED) {
            creative.start_time = NOT_STARTED;
            changed = true;
          }
          if (creative.end_time !== NOT_STARTED) {
            creative.end_time = NOT_STARTED;
            changed = true;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- 首页
  const MAIN_PAGE = /\/ws\/faas\/amap-navigation\/main-page(?:[?/-]|$)/;
  if (MAIN_PAGE.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) {
      const kept = filterAdCards(data.cardList);
      if (kept) {
        data.cardList = kept;
        changed = true;
      }
      // cardList 不存在或换了键名时，退回递归扫描。
      if (sweepCards(data, false, 0)) changed = true;
      clear(data, "mapBizList");
      clear(data, "business_position");
      if (data.pull3 && "object" == typeof data.pull3) clear(data.pull3, "msgs");
    }
  }

  // ---------------------------------------------------------------- 我的
  // 17.3 起「我的」页改由 usr-profile-fc/homeV2 下发；旧版的 dsp 路径保留兼容。
  const PROFILE = /\/ws\/(?:shield\/dsp\/profile\/index\/node|faas\/amap-navigation\/usr-profile-fc\/homeV\d)/;
  if (PROFILE.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) {
      drop(data, "tipData");
      const kept = filterAdCards(data.cardList, true);
      if (kept) {
        data.cardList = kept;
        changed = true;
      }
      // cardList 不存在或换了键名时，退回递归扫描。
      if (sweepCards(data, true, 0)) changed = true;
      // 运营 / 券位和卡片列表是两套字段，有就一起清掉。
      clear(data, "coupon");
      clear(data, "activity");
      clear(data, "operation_activity");
      clear(data, "commodity_rec");
    }
  }

  // ---------------------------------------------------------------- 搜索热词
  const HOTWORD = /\/ws\/shield\/search\/new_hotword/;
  if (HOTWORD.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) clear(data, "header_hotword");
  }

  // ---------------------------------------------------------------- 打车页运营位
  const PROMOTION = /\/ws\/promotion-web\/resource/;
  if (PROMOTION.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) {
      for (const key of ["icon", "banner", "tips", "popup", "bubble", "other"]) clear(data, key);
    }
  }

  // ---------------------------------------------------------------- 消息盒子 / 消息中心
  const MSGBOX = /\/ws\/msgbox\/pull/;
  if (MSGBOX.test(url)) {
    clear(root, "msgs");
    if (root.pull3 && "object" == typeof root.pull3) clear(root.pull3, "msgs");
  }

  const NOTICE = /\/ws\/message\/notice\/list/;
  if (NOTICE.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) clear(data, "noticeList");
  }

  // ---------------------------------------------------------------- 首页可更新配置
  // AOCS 是「可更新配置」大包：633 个 key，广告开关、运营位、缓存策略都在里面。
  // 值是一段 JSON 字符串，这里按 key / 路径删字段，只动结构不改键名。
  const AOCS = /\/ws\/shield\/frogserver\/aocs(?:\/|$)/;
  if (AOCS.test(url)) {
    // 整个 key 都是广告 / 运营配置的，直接删掉；客户端拿不到就当没配置。
    const DROP_KEYS = [
      "adStatementConfig", "adCustomerRetainArchitecture", "adImEntryConfig", "adVenueConfig",
      "adPerfSwitch", "EndNaviC3AdCard", "infoCpcReport", "hotsaleConfig",
      "marketing_resource_config", "coupon_risk_asac", "commonCouponSceneLog", "sug_coupon_opt",
      "giftEntryConfig", "splashscreen", "SplashScreenControl", "splashview_config",
      "feedback_banner", "TrainOrderBanner", "nearby_business_popup", "shortcut_popup_frequency",
      "tel_retention_popup", "hotel_activity", "taxi_activity", "hotel_privilege",
      "sportsActivityConfig", "activity_qingke_contry_control", "920bestwishes",
      "custom_consultdata.widget_guide", "free_ride", "homepage_resource_config",
      "home_message_guide", "hotel_tipsicon", "sur_bar", "nearby_map_entry_guide",
      "comment_info", "small_biz_index", "small_biz_fun", "setpagesearch", "wallet",
    ];
    // 角标 / 运营层 / AI 入口这类前缀型 key，名字不固定，用正则。
    const AD_KEY_RE = /gd_notch_logo|home_business_position_config|operation_layer|aiNative|^ai_|routeresult_banner/i;

    // 打车配置里的营销位。删字段而不是删 key，打车功能开关要留着。
    const TAXI_DROP = [
      "denghuo_ad", "banner_picture_url", "carpool_city", "carpool_intercity",
      "intercity_index_page_header", "skin_show", "hq_112background", "chauffeurBannerSort",
      "hitch_other_tab", "hitch_other_tab_v2", "dache_toolbox_promo", "dache_toolbox_marketing",
      "dache_toolbox_remote", "dache_toolbox_carpool", "dache_toolbox_chauffeur",
      "PaymentOneClickLayerInfo", "s_reward_center_config", "taxi_personal_virtual_gold_url",
      "student_url", "student_icon", "student_title", "student_describe",
      "chauffeurTabKingToolConfig_left", "chauffeurTabBubbleText", "discount_bubble",
      "coupon_traction_bubble_v3", "intercity_entrance_tag", "long-dis_preferential",
      "taxi_shortcut_manager", "vip_88_guide_fatigue", "vip-h5", "taxi_commercialization",
      "isUseChauffeurNewMarketingSlot", "operation_module_render_new", "retainPopupDiscount",
      "taxi_coupon_entry_new", "thailandCouponRedirectAimap", "isChauffeurUseNewCouponCenter",
      "chauffeurComboCouponSwitch", "couponNewStyleV730", "is_favorable_show",
      "taxi_personal_virtual_gold", "taxi_personal_virtual_gold_title", "student_entry",
      "unionvip_white_list", "premium_customer_card_config", "chauffeurTabKingToolConfig_alternative",
      "chauffeurTabKingToolConfig_right", "chauffeur_fatigue_config", "hitch_101_popup_polling",
      "ChauffeurViaPoisConfig", "driveDiversionCardHitchTab", "pinzhi_daoliu", "CancelRetentionTec",
      "intercity_atmosphere_config", "carpool_waiting_config",
    ];
    const TAXI_ZERO = [
      "recommend_point_optimization", "recommend_point_service_overview",
      "end_point_optimization", "hitch_way_point_nav_default",
    ];
    // 导航中 / 到达后的推荐位。
    const NAVI_DROP = [
      "long_trip_service_coupon", "long_trip_service_coupon_enter", "long_trip_service_coupon_links",
      "QQMusicVipText", "QQMusicMembershipVoice", "ETCGuide", "etc_banner", "music_config",
      "music_sdk_recommend_title", "music_ai_guide_fatigue", "music_ai_next_login_rate",
      "music_source", "DownloadQQplayerSDK", "voicePlayground", "route_search_Starbucks",
      "Starbucksfinish", "H5guidelottie", "route_search_guide_lottie", "via_result_bottomtext",
      "planHomeGuideConfig", "energy_add_plate_list", "operation_consumer_bubble", "bubble_priority",
      "desk_card_commute", "consumeAfterPopup_days", "Rescue_popup_service", "smart_drive_tips",
      "city_drive_tips", "BackCar", "customized_navigation", "TabRecommend",
      "newTabRecommendSwitch", "tab_recommend_filter",
      "tab_recommend_switch_third_schema", "dropby_scroll", "gas_path_bubble", "carowner",
      "operation_chat_add_group", "noInternetCardSwitch",
    ];
    // 底图配置里的开屏、抽奖、弹窗、引导、角标、金币任务。
    const BASEMAP_DROP = [
      "splash", "ai_splash", "ipSquare_window_video_config", "usercenter_lottery_switch",
      "coins_lottery", "coins_wish", "newYearLotteryTips", "mileage_coin_scene",
      "licheng_coin_mine_entry", "member_grabbing", "vip_checkout_welfare_dialog_config",
      "task_poi_card_coupon_switch", "jay_act", "pointExchangeCenter", "pointExchangeGoCommentUrl",
      "batchCheckIn", "batchCheckIn_new", "fireworks", "fireworkFeatureCodes",
      "setFireworksNightMode", "fireworks_click_change_night", "2024greetingTofireworks",
      "greeting_widget_switch", "newYearSystemScreenRecordListenSwitch", "ugcActivityH5",
      "study_create_url", "asset_space_pilot", "ipSquare_goods_tab_desc", "vip_member_config",
      "recently_activity", "business_position", "carLogos", "voiceLogos",
      "increase_product_name_account", "invite_poi_share_pic",
      "block_increase_product_detail_share_button", "mainIcon", "mainBubble", "blueBar",
      "presetWord", "homepage_tabguide", "suit_set_popup", "pop_selection",
      "ipsqure_free_pop_hours", "desk_card_footprint_check_in", "desk_card_searchtool",
      "arLayerDialogConfig", "geochoBackConfirmDialogConfig", "followGuidePopupConfig",
      "growth_bubble_guide_config", "bottom_login_guide_config",
      "frequent_location_login_guide_config", "login_guide_show_rules",
      "show_landmark_exploration_card", "reachFrequency", "reachTaskFrequency",
      "msgbox_show_popwindow", "aiqs_pull_up_guide", "new_aiqs_pull_up_guide",
      "full_screen_guide_video_config", "ai_guideo_video_map", "feature_guide_switch",
      "geoechoGuideLottieConfig", "level_page_slide", "level_page_tips", "garage_top_button",
      "ThemeSquareSwiperCanJumpUrlList",
    ];

    // AOCS 的 value 是一段 JSON 字符串。里面可能还有 16 位 ID（shopId 等），
    // 同样只检查字符串外的数字，避免整条配置跳过。
    const editValue = (entry, edit) => {
      if (!entry || "object" != typeof entry || "string" != typeof entry.value || !entry.value) return false;
      if (numberOutsideStrings(entry.value)) return false;
      let value;
      try {
        value = JSON.parse(entry.value);
      } catch (e) {
        return false;
      }
      if (!value || "object" != typeof value) return false;
      if (!edit(value)) return false;
      entry.value = JSON.stringify(value);
      return true;
    };

    const data = root.data;
    if (data && "object" == typeof data) {
      for (const key of Object.keys(data)) {
        if (DROP_KEYS.indexOf(key) >= 0) {
          delete data[key];
          changed = true;
        } else if (AD_KEY_RE.test(key)) {
          // 前缀型 key 只置空、不删：整包少一个 key，客户端可能当成配置不完整。
          data[key] = { status: 1, version: "", value: "" };
          changed = true;
        }
      }
      // 搜索框的历史提示：删推荐榜单和附近热词，历史记录本身保留。
      if (editValue(data.his_input_tip, (tip) => {
        let hit = dropKeys(tip, ["channel_zhitiao"]);
        if (tip.his_recommend_bangdan) {
          tip.his_recommend_bangdan = 0;
          hit = true;
        }
        if (tip.nearby_hotword && "object" == typeof tip.nearby_hotword && tip.nearby_hotword.search_detail) {
          tip.nearby_hotword.search_detail = 0;
          hit = true;
        }
        return hit;
      })) changed = true;
      if (editValue(data.taxi, (taxi) => {
        let hit = dropKeys(taxi, TAXI_DROP);
        for (const key of TAXI_ZERO) {
          if (!taxi[key]) continue;
          taxi[key] = 0;
          hit = true;
        }
        return hit;
      })) changed = true;
      if (editValue(data.navi_cloud, (navi) => {
        let hit = dropKeys(navi, NAVI_DROP);
        for (const key of ["end_auto_foot_explore", "ExtremelyRecommendCount"]) {
          if (!navi[key]) continue;
          navi[key] = 0;
          hit = true;
        }
        return hit;
      })) changed = true;
      if (editValue(data.amap_basemap_config, (config) => {
        let hit = dropKeys(config, BASEMAP_DROP);
        // 「我的」页的卡片列表默认缓存 7 天，缓存期内不会再请求 nodefaasv3，
        // 脚本也就没机会过滤。把 timeout 归零让它每次重拉。
        const uc = config.usercenter_performance_optimization;
        if (uc && "object" == typeof uc && uc.timeout) {
          uc.timeout = 0;
          hit = true;
        }
        return hit;
      })) changed = true;
      // 详情页：商品货架、周边搜索优化、第二屏锚点不再指向货架。
      if (editValue(data.detail_config, (detail) => {
        let hit = dropKeys(detail, ["shelf_coupon_refresh"]);
        for (const key of ["isGoodsShelfPerfV2", "NearbySearchOptimization"]) {
          if (!detail[key]) continue;
          detail[key] = 0;
          hit = true;
        }
        for (const key of ["poiDetailScreenCacheConfig", "poiDetailScreenCacheOtherConfig"]) {
          const holder = detail[key];
          if (!holder || "object" != typeof holder || !holder.secondScreenAnchorModule) continue;
          holder.secondScreenAnchorModule = "";
          hit = true;
        }
        return hit;
      })) changed = true;
      // 引擎渲染层的广告开关。
      if (editValue(data.engine_render, (render) => dropKeys(render, ["can_show_advert", "advert_note_num"]))) changed = true;
      // 运动首页 / 路线页的分组 banner。
      for (const key of ["sportsGroupConfig", "sportsRouteConfig"]) {
        if (editValue(data[key], (entry) => dropKeys(entry, ["group_banner"]))) changed = true;
      }
      if (editValue(data.sportsHomeConfig, (sports) => dropKeys(sports, ["banner_list"]))) changed = true;
      // nore_rec.recommend 是首页「附近」流的开关。置 0 会让客户端拿不到内容，
      // 首页底部直接弹「网络不通，请稍后再试」，所以这里不动它。
      if (editValue(data.container_isolation, (config) => {
        if (!config.nearby_feed_poi_card_v2_multi_img) return false;
        config.nearby_feed_poi_card_v2_multi_img = 0;
        return true;
      })) changed = true;
      // 收藏夹的周边图片。
      if (editValue(data.favorites_info, (fav) => {
        let hit = false;
        for (const key of ["nearby_picture_on", "nearby_picture_distance"]) {
          if (!fav[key]) continue;
          fav[key] = 0;
          hit = true;
        }
        return hit;
      })) changed = true;
      // 景区 / 机场到达后的「找停车场」气泡。
      if (editValue(data.engine_eyrie, (eyrie) => dropKeys(eyrie, ["poi_area_bubble"]))) changed = true;
      // 地图小程序引导视频。
      if (editValue(data.WIA, (wia) => dropKeys(wia, ["orgGuideVideoConfig"]))) changed = true;
      // 兴趣点文件夹里只留骨架模块。
      if (editValue(data.poi_folder_modules, (mods) => {
        const KEEP = ["enhanceIMQuestions", "platformCustomerCommonModule", "platformCustomerComplianceInfo", "evaluateVO"];
        let hit = false;
        for (const key of ["folder_modules", "newFolderModules"]) {
          const list = mods[key];
          if (!Array.isArray(list)) continue;
          const kept = list.filter((name) => KEEP.indexOf(name) >= 0);
          if (kept.length !== list.length) {
            mods[key] = kept;
            hit = true;
          }
        }
        return hit;
      })) changed = true;
      // 导航结束页：广告时长归零，去掉加油运营按钮。
      if (editValue(data.navi_end, (end) => {
        let hit = dropKeys(end, ["operator_btns"]);
        for (const key of ["navi_end_advertisement", "collect_oil"]) {
          if (!end[key]) continue;
          end[key] = 0;
          hit = true;
        }
        return hit;
      })) changed = true;
    }
  }

  // ---------------------------------------------------------------- 我的（17.x）
  // 17.x 的「我的」页走 nodefaasv3，卡片按 dataKey 命名，和旧版 dataType 完全不同。
  // 只留「足迹」和「B 端入口」两张卡，入口列表按 id 白名单收窄。
  const PROFILE_V3 = /\/ws\/shield\/dsp\/profile\/index\/nodefaasv\d/;
  if (PROFILE_V3.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) {
      drop(data, "tipData");
      drop(data, "wallet");
      // 只有 v3 的卡片带 dataKey；旧版 nodefaas 的卡片没有这个字段，交给上面的分支处理。
      const isV3 = Array.isArray(data.cardList) && data.cardList.some((card) => card && card.dataKey);
      if (isV3) {
        const kept = data.cardList.filter((card) => card && (card.dataKey === "MineNewFootprintCard" || card.dataKey === "MineNewBEntranceCardV4"));
        if (kept.length !== data.cardList.length) {
          data.cardList = kept;
          changed = true;
        }
        for (const card of kept) {
          if (card.dataKey !== "MineNewBEntranceCardV4" || !card.content || "object" != typeof card.content) continue;
          const KEEP_1 = [7, 8, 10, 17];
          const KEEP_2 = [32, 4, 9, 16, 14];
          for (const key of ["entranceList_1", "entranceList_2"]) {
            const list = card.content[key];
            if (!Array.isArray(list)) continue;
            const keep = key === "entranceList_1" ? KEEP_1 : KEEP_2;
            const filtered = list.filter((item) => item && keep.indexOf(item.id) >= 0);
            if (filtered.length !== list.length) {
              card.content[key] = filtered;
              changed = true;
            }
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- 打车页内容
  // 打车页是 H5（h5_bundle_taxi_common），广告和营销位都挂在 content_info 的 lubanData 里。
  const ORDER_CONTENT = /\/ws\/boss\/car\/order\/content_info/;
  if (ORDER_CONTENT.test(url)) {
    const data = root.data;
    const luban = data && data.lubanData;
    if (luban && "object" == typeof luban) {
      if (dropKeys(luban, ["skin", "kingToolBoxBubble", "popup"])) changed = true;
      const KEEP_TOOLS = ["dache_toolbox_GDIntercity", "dache_toolbox_hitch", "dache_toolbox_chauffeur", "dache_toolbox_quality", "dache_toolbox_charterCar"];
      const sort = luban.kingToolSort && luban.kingToolSort.dataList;
      if (Array.isArray(sort)) {
        for (const item of sort) {
          const biz = item && item.biz;
          if (!biz || !Array.isArray(biz.kingToolIdList)) continue;
          const filtered = biz.kingToolIdList.filter((id) => KEEP_TOOLS.indexOf(id) >= 0);
          if (filtered.length !== biz.kingToolIdList.length) {
            biz.kingToolIdList = filtered;
            changed = true;
          }
        }
      }
      const box = luban.kingToolBox && luban.kingToolBox.dataList;
      if (Array.isArray(box)) {
        const filtered = box.filter((item) => item && item.biz && KEEP_TOOLS.indexOf(item.biz.id) >= 0);
        if (filtered.length !== box.length) {
          luban.kingToolBox.dataList = filtered;
          changed = true;
        }
      }
    }
  }

  // 顺风车内容页的 banner。
  if (/\/ws\/amap\/hitch\/passenger\/content_info/.test(url)) {
    const luban = root.data && root.data.lubanData;
    if (luban && "object" == typeof luban && dropKeys(luban, ["banner"])) changed = true;
  }

  // ---------------------------------------------------------------- 搜索场景推荐
  // shadingWords 是搜索框下方那块「推荐 / 榜单」，toolsRecommend 是搜索页的工具卡。
  if (/\/ws\/shield\/scene\/recommend/.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) {
      const shading = data.shadingWords && data.shadingWords.data;
      if (shading && "object" == typeof shading) {
        if (shading.regions && Array.isArray(shading.regions.content)) {
          const kept = shading.regions.content.filter((name) => ["quickLink", "history", "searchFind"].indexOf(name) >= 0);
          if (kept.length !== shading.regions.content.length) {
            shading.regions.content = kept;
            changed = true;
          }
        }
        if (shading.modules && "object" == typeof shading.modules) {
          for (const key of Object.keys(shading.modules)) {
            if (key === "searchFind") continue;
            delete shading.modules[key];
            changed = true;
          }
        }
      }
      const tools = data.toolsRecommend && data.toolsRecommend.data && data.toolsRecommend.data.default;
      if (Array.isArray(tools)) {
        const KEEP = [102, 103, 106, 151];
        const kept = tools.filter((item) => item && KEEP.indexOf(item.id) >= 0);
        if (kept.length !== tools.length) {
          data.toolsRecommend.data.default = kept;
          changed = true;
        }
      }
    }
  }

  // 搜索联想里的营销词条。
  if (/\/ws\/shield\/search_business\/process\/middleLayer\/sug/.test(url)) {
    const tipList = root.data && root.data.tip_list;
    if (Array.isArray(tipList)) {
      const kept = tipList.filter((item) => {
        const tag = item && item.tip && item.tip.task_tag;
        return tag === "common_content_general" || tag === "sp";
      });
      if (kept.length !== tipList.length) {
        root.data.tip_list = kept;
        changed = true;
      }
    }
  }

  // 搜索首页的快捷入口角标。
  if (/\/ws\/c3frontend\/af-search\/search/.test(url)) {
    const list = root.data && root.data.modules && root.data.modules.quickLink && root.data.modules.quickLink.data && root.data.modules.quickLink.data.list;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || "object" != typeof item || !item.badge || "object" != typeof item.badge) continue;
        if ("string" != typeof item.badge.text || !item.badge.text) continue;
        item.badge.text = "";
        changed = true;
      }
    }
  }

  // 消息中心会话列表里的运营卡片。
  if (/\/ws\/amc\/server\/conv\/raise_list/.test(url)) {
    const list = root.data && root.data.dataList;
    if (Array.isArray(list)) {
      const kept = list.filter((item) => item && (Object.prototype.hasOwnProperty.call(item, "categoryId") || (item.data && item.data.id === "M_100007")));
      if (kept.length !== list.length) {
        root.data.dataList = kept;
        changed = true;
      }
    }
  }

  // 附近推荐卡片里的运营位。
  if (/\/ws\/smartui\/near_recommend/.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data && dropKeys(data, ["operation_activity"])) changed = true;
  }

  // 工具列表：去掉每个工具的 tips 和「广告」工具（id 547）。
  if (/\/ws\/opc\/tools\/list/.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data && Array.isArray(data.category)) {
      for (const category of data.category) {
        if (!category || "object" != typeof category || !Array.isArray(category.tools)) continue;
        for (const tool of category.tools) {
          if (!tool || "object" != typeof tool) continue;
          if (Object.prototype.hasOwnProperty.call(tool, "tips")) {
            delete tool.tips;
            changed = true;
          }
        }
        const kept = category.tools.filter((tool) => !(tool && String(tool.id) === "547"));
        if (kept.length !== category.tools.length) {
          category.tools = kept;
          changed = true;
        }
      }
    }
  }

  // ---------------------------------------------------------------- 附近推荐
  const NEARBY = /\/ws\/shield\/search\/nearbyrec_smart/;
  if (NEARBY.test(url)) {
    const data = root.data;
    if (data && "object" == typeof data) {
      const AD_KEYS = ["coupon", "scene", "activity", "commodity_rec", "operation_activity"];
      let removed = false;
      for (const key of AD_KEYS) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          delete data[key];
          removed = true;
        }
      }
      if (removed) changed = true;
      if (Array.isArray(data.modules)) {
        const kept = data.modules.filter((name) => AD_KEYS.indexOf(name) < 0);
        if (kept.length !== data.modules.length) {
          data.modules = kept;
          changed = true;
        }
      }
    }
  }

  // 兜底：登录后「我的」页会换一套接口下发「猜你喜欢」，路径不固定，抓包也没抓到。
  // 只要响应里出现这几句推荐位文案，就把整棵树扫一遍，删掉像广告 / 推荐卡的数组元素。
  if (!changed && /猜你喜欢|好友动态|为你推荐/.test(body)) {
    if (sweepCards(root, true, 0)) changed = true;
  }

  if (!changed) {
    $done({});
    return;
  }
  $done({ body: JSON.stringify(root) });
})();
