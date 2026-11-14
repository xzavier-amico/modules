  // ---- 广告判定 ---------------------------------------------------------

  // 旧版相关推荐：goto 是 cm/game，或带 cm / unique_id。
  function legacyRelateAd(b, s, e) {
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 7 && f.wt === 2) {
        const goto = ascii(b, f.ds, f.de);
        if (goto === "cm" || goto === "game") return true;
      } else if (f.no === 28) {
        return true;
      } else if (f.no === 32 && f.de > f.ds) {
        return true;
      }
    }
    return false;
  }

  // 新版推荐卡：B 站标成广告的类型（4/5/11），或带 cm / cm_stock。
  function unifiedRelateAd(b, s, e) {
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 1 && f.wt === 0) {
        const v = readVarint(b, f.ds, f.de);
        if (v && (v[0] === 4 || v[0] === 5 || v[0] === 11)) return true;
      } else if (f.no === 6 || f.no === 11) {
        return true;
      }
    }
    return false;
  }

  // 评论区顶部卡片：type=3 是带货卡。
  function commercialTopCard(b, s, e) {
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 1 && f.wt === 0) {
        const v = readVarint(b, f.ds, f.de);
        return !!v && v[0] === 3;
      }
    }
    return false;
  }

  // 带货评论：正文或跳转链接里出现 b23.tv/cm、b23.tv/mall、商品页。
  // 直接扫字节，不用解出字符串字段，省事也不会漏。
  const REPLY_AD_NEEDLES = [
    asciiBytes("b23.tv/cm"),
    asciiBytes("b23.tv/mall"),
    asciiBytes("cm.bilibili.com/ad-showcase-h5"),
  ];

  function commercialReply(b, s, e) {
    for (let i = 0; i < REPLY_AD_NEEDLES.length; i++) {
      if (containsAscii(b, s, e, REPLY_AD_NEEDLES[i])) return true;
    }
    return false;
  }

  // ---- 详情页模块（viewunite）------------------------------------------

  // ModuleType：18 番剧活动横幅 / 29 番剧标题下大会员横幅 / 55 up 主分享好物。
  const PROMO_MODULES = [18, 29, 55];
  const RELATED_RECOMMEND = 28;

  // Module.relates = 22，Relates.cards = 1。只处理推荐模块里的广告卡。
  function cleanModule(mod) {
    if (fieldVarint(mod, 0, mod.length, 1) !== RELATED_RECOMMEND) return null;
    return mapSub(mod, 22, (relates) => filterRepeated(relates, 1, (card) => !unifiedRelateAd(card, 0, card.length)));
  }

  // 模块容器里删推广模块，并把推荐模块里的广告卡过滤掉。no 是 modules 的字段号：
  // IntroductionTab.modules = 2，AIRelateTab.modules = 1。
  function cleanModules(container, no) {
    const mapped = mapSub(container, no, cleanModule);
    const base = mapped || container;
    const filtered = filterRepeated(base, no, (mod) => PROMO_MODULES.indexOf(fieldVarint(mod, 0, mod.length, 1)) < 0);
    return filtered || mapped;
  }

  // Tab.tab_module = 1，TabModule.introduction = 2
  function cleanTab(tab) {
    return mapSub(tab, 1, (mod) => mapSub(mod, 2, (intro) => cleanModules(intro, 2)));
  }

  // 播放页定制标签：otype=3（CmURI）或带 ad_tab_info(11) 就是广告。
  function adTab(b, s, e) {
    if (fieldVarint(b, s, e, 2) === 3) return true;
    const fields = parseFields(b, s, e);
    if (!fields) return false;
    for (let i = 0; i < fields.length; i++) {
      if (fields[i].no === 11 && fields[i].wt === 2) return true;
    }
    return false;
  }

  // ---- 动态页（dynamic.v2）---------------------------------------------

  // DynamicItem.card_type = 1，DynamicType.ad = 15。
  const DYNAMIC_AD_TYPE = 15;

  // DynamicList.list = 1 / CardVideoDynList.list = 1
  function cleanDynamicList(list) {
    return filterRepeated(list, 1, (item) => fieldVarint(item, 0, item.length, 1) !== DYNAMIC_AD_TYPE);
  }

  // ---- 接口表 -----------------------------------------------------------

  const VIEW = "/bilibili.app.view.v1.View/";
  const UNITE = "/bilibili.app.viewunite.v1.View/";
  const REPLY = "/bilibili.main.community.reply.v1.Reply/";
  const DYNAMIC = "/bilibili.app.dynamic.v2.Dynamic/";

  const RULES = {};

  // 旧版详情页
  RULES[VIEW + "View"] = (m) => rewrite(m, [30, 31, 34, 41, 48], { 10: legacyRelateAd, 32: adTab });
  RULES[VIEW + "RelatesFeed"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "PlayerRelates"] = (m) => rewrite(m, null, { 1: legacyRelateAd });
  RULES[VIEW + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[VIEW + "TFInfo"] = (m) => rewrite(m, [2, 3]);

  // 新版详情页：顶层 cm(7) + 详情 Tab 里的推广模块与推荐广告卡。
  RULES[UNITE + "View"] = (m) => {
    const dropped = rewrite(m, [7]);
    const tabbed = mapSub(dropped || m, 5, cleanTab);
    return tabbed || dropped;
  };
  // 异步补充的详情页：cm(1) + tab(2) 里的模块（AIRelateTab.modules = 1）
  RULES[UNITE + "AIRelateAsync"] = (m) => {
    const dropped = rewrite(m, [1]);
    const tabbed = mapSub(dropped || m, 2, (tab) => cleanModules(tab, 1));
    return tabbed || dropped;
  };
  RULES[UNITE + "RelatesFeed"] = (m) => rewrite(m, null, { 1: unifiedRelateAd });
  RULES[UNITE + "ViewProgress"] = (m) => rewrite(m, [1]);
  RULES[UNITE + "PlayPause"] = () => EMPTY;
  RULES[UNITE + "ViewEndPage"] = () => EMPTY;

  // 评论区
  RULES[REPLY + "MainList"] = (m) =>
    rewrite(m, [11], {
      4: commercialReply,
      5: commercialReply,
      6: commercialReply,
      14: commercialReply,
      28: commercialTopCard,
    });

  // 动态页：综合页和视频页的 dynamic_list(1) 里删广告卡。
  RULES[DYNAMIC + "DynAll"] = (m) => mapSub(m, 1, cleanDynamicList);
  RULES[DYNAMIC + "DynVideo"] = (m) => mapSub(m, 1, cleanDynamicList);
