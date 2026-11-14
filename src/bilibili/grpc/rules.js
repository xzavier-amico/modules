  // ---- 广告判定 ---------------------------------------------------------

  // 旧版相关推荐：goto(7) 是 cm/game，或带 cm(28) / unique_id(32) 非空。
  // 用扫描遍历字段，找到目标字段就判定，不建完整字段列表。
  function legacyRelateAd(b, s, e) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        let ds = state.i;
        if (wire === 0) {
          wireSkipVarint(sub, state);
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          ds = state.i;
          state.i += length;
          if (fn === 7) {
            const goto = ascii(sub, ds, state.i);
            if (goto === "cm" || goto === "game") return true;
          } else if (fn === 28) {
            return true;
          } else if (fn === 32 && state.i > ds) {
            return true;
          }
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 新版推荐卡：type(1) 是广告类型（4/5/11），或带 cm(6) / cm_stock(11)。
  function unifiedRelateAd(b, s, e) {
    try {
      const sub = b.subarray(s, e);
      const state = { i: 0 };
      while (state.i < sub.length) {
        const tag = wireReadCount(sub, state);
        const fn = tag >>> 3;
        const wire = tag & 7;
        if (!fn) throw new Error("Invalid protobuf field");
        if (wire === 0) {
          if (fn === 1) {
            const v = Number(wireReadVarint(sub, state));
            if (v === 4 || v === 5 || v === 11) return true;
          } else {
            wireSkipVarint(sub, state);
          }
        } else if (wire === 2) {
          const length = wireReadCount(sub, state);
          if (length > sub.length - state.i) throw new Error("Truncated protobuf field");
          state.i += length;
          if (fn === 6 || fn === 11) return true;
        } else if (wire === 1) {
          state.i += 8;
        } else if (wire === 5) {
          state.i += 4;
        } else {
          throw new Error("Unsupported protobuf wire type " + wire);
        }
        if (state.i > sub.length) throw new Error("Truncated protobuf field");
      }
    } catch (e) {
      return false;
    }
    return false;
  }

  // 评论区顶部卡片：type=3 是带货卡。
  function commercialTopCard(b, s, e) {
    return fieldVarintFast(b, s, e, 1) === 3;
  }

  // 带货评论：正文或跳转链接里出现 b23.tv/cm、b23.tv/mall、商品页。
  // 一次扫描全部 needle，不逐组扫。
  const REPLY_AD_NEEDLES = [
    asciiBytes("b23.tv/cm"),
    asciiBytes("b23.tv/mall"),
    asciiBytes("cm.bilibili.com/ad-showcase-h5"),
  ];

  function commercialReply(b, s, e) {
    return containsAnyAscii(b, s, e, REPLY_AD_NEEDLES);
  }

  // ---- 详情页模块（viewunite）------------------------------------------

  // ModuleType：18 番剧活动横幅 / 29 番剧标题下大会员横幅 / 55 up 主分享好物。
  const PROMO_MODULES = [18, 29, 55];
  const RELATED_RECOMMEND = 28;

  // Module.relates = 22，Relates.cards = 1。只处理推荐模块里的广告卡。
  // 先用 fieldVarintFast 判模块类型（不建字段列表），不是推荐模块就跳过。
  function cleanModule(mod) {
    if (fieldVarintFast(mod, 0, mod.length, 1) !== RELATED_RECOMMEND) return null;
    return mapSub(mod, 22, (relates) => filterRepeated(relates, 1, (card) => !unifiedRelateAd(card, 0, card.length)));
  }

  // 模块容器里删推广模块，并把推荐模块里的广告卡过滤掉。no 是 modules 的字段号：
  // IntroductionTab.modules = 2，AIRelateTab.modules = 1。
  // 一次解析同时做 filter + map，比分别调省一次 parseFields。
  function cleanModules(container, no) {
    return filterAndMap(
      container,
      no,
      (mod) => PROMO_MODULES.indexOf(fieldVarintFast(mod, 0, mod.length, 1)) < 0,
      cleanModule
    );
  }

  // Tab.tab_module = 1，TabModule.introduction = 2
  function cleanTab(tab) {
    return mapSub(tab, 1, (mod) => mapSub(mod, 2, (intro) => cleanModules(intro, 2)));
  }

  // 播放页定制标签：otype=3（CmURI）或带 ad_tab_info(11) 就是广告。
  function adTab(b, s, e) {
    if (fieldVarintFast(b, s, e, 2) === 3) return true;
    return hasField(b, s, e, 11);
  }

  // ---- 动态页（dynamic.v2）---------------------------------------------

  // DynamicItem.card_type = 1，DynamicType.ad = 15。
  const DYNAMIC_AD_TYPE = 15;

  // DynamicList.list = 1 / CardVideoDynList.list = 1
  function cleanDynamicList(list) {
    return filterRepeated(list, 1, (item) => fieldVarintFast(item, 0, item.length, 1) !== DYNAMIC_AD_TYPE);
  }

  // ---- 接口表 -----------------------------------------------------------

  const VIEW = "/bilibili.app.view.v1.View/";
  const UNITE = "/bilibili.app.viewunite.v1.View/";
  const REPLY = "/bilibili.main.community.reply.v1.Reply/";
  const DYNAMIC = "/bilibili.app.dynamic.v2.Dynamic/";

  const RULES = {};

  // 旧版详情页：先扫描有没有广告字段，没有就跳过。
  RULES[VIEW + "View"] = (m) => {
    let hasTarget = false;
    try {
      wireScanFields(m, (no) => {
        if (no === 30 || no === 31 || no === 34 || no === 41 || no === 48 || no === 10 || no === 32) {
          hasTarget = true;
          return true;
        }
        return false;
      });
    } catch (e) {
      return null;
    }
    if (!hasTarget) return null;
    return rewrite(m, [30, 31, 34, 41, 48], { 10: legacyRelateAd, 32: adTab });
  };
  RULES[VIEW + "RelatesFeed"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "PlayerRelates"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[VIEW + "TFInfo"] = (m) => rewrite(m, [2, 3]);

  // 新版详情页：顶层 cm(7) + 详情 Tab(5) 里的推广模块与推荐广告卡。
  // 先扫描有没有目标字段，没有就跳过完整解析。
  RULES[UNITE + "View"] = (m) => {
    let hasTarget = false;
    try {
      wireScanFields(m, (no) => {
        if (no === 7 || no === 5) {
          hasTarget = true;
          return true;
        }
        return false;
      });
    } catch (e) {
      return null;
    }
    if (!hasTarget) return null;
    const dropped = rewrite(m, [7]);
    const tabbed = mapSub(dropped || m, 5, cleanTab);
    return tabbed || dropped;
  };
  // 异步补充的详情页：cm(1) + tab(2) 里的模块（AIRelateTab.modules = 1）
  RULES[UNITE + "AIRelateAsync"] = (m) => {
    let hasTarget = false;
    try {
      wireScanFields(m, (no) => {
        if (no === 1 || no === 2) {
          hasTarget = true;
          return true;
        }
        return false;
      });
    } catch (e) {
      return null;
    }
    if (!hasTarget) return null;
    const dropped = rewrite(m, [1]);
    const tabbed = mapSub(dropped || m, 2, (tab) => cleanModules(tab, 1));
    return tabbed || dropped;
  };
  RULES[UNITE + "RelatesFeed"] = (m) => rewrite(m, null, { 1: unifiedRelateAd });
  RULES[UNITE + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[UNITE + "PlayPause"] = () => EMPTY;
  RULES[UNITE + "ViewEndPage"] = () => EMPTY;

  // 评论区：先扫描有没有目标字段（11/4/5/6/14/28），没有就跳过完整解析。
  // 大部分评论响应只有普通评论，不含广告/带货，快速扫描省一次 parseFields。
  RULES[REPLY + "MainList"] = (m) => {
    let hasTarget = false;
    try {
      wireScanFields(m, (no) => {
        if (no === 11 || no === 4 || no === 5 || no === 6 || no === 14 || no === 28) {
          hasTarget = true;
          return true;
        }
        return false;
      });
    } catch (e) {
      return null;
    }
    if (!hasTarget) return null;
    return rewrite(m, [11], {
      4: commercialReply,
      5: commercialReply,
      6: commercialReply,
      14: commercialReply,
      28: commercialTopCard,
    });
  };

  // 动态页：综合页和视频页的 dynamic_list(1) 里删广告卡。
  // 先扫描有没有字段 1，没有就跳过完整解析。
  RULES[DYNAMIC + "DynAll"] = (m) => {
    if (!hasField(m, 0, m.length, 1)) return null;
    return mapSub(m, 1, cleanDynamicList);
  };
  RULES[DYNAMIC + "DynVideo"] = (m) => {
    if (!hasField(m, 0, m.length, 1)) return null;
    return mapSub(m, 1, cleanDynamicList);
  };
