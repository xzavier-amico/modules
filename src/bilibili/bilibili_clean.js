// BiliBili Enhance — Loon / Egern.
//
// 只做四件事：去广告、去会员推广、去遥测（遥测在模块规则里 REJECT）、自动最高画质
// （画质在 bilibili_quality.js 里改请求）。
//
// 广告和会员推广都在 JSON 里，按结构删，不做全量重编码：
//
//   /x/v2/splash/*            开屏：清空 list / event_list / brand_list
//   /x/v2/feed/index*         首页：只过滤 data.items 里 card_type=cm_* / card_goto=ad_* / goto=ad 的卡片
//   /x/v2/search/square       搜索：只过滤 data 数组里的广告项
//   /x/web-interface/wbi/...  网页推荐流：只过滤 data.item 里 goto=ad 的条目
//   /x/web-interface/wbi/search/type    网页搜索：过滤 data.result 里的广告项
//   /x/web-interface/archive/related    网页相关推荐：过滤 data 数组里的广告项
//   /x/web-interface/view              网页详情：删 cm_config，过滤 relates 广告
//   /x/polymer/web-dynamic/v1/feed/all 网页动态：删 DYNAMIC_TYPE_AD
//   /x/vip/ads/materials      大会员广告素材：清空
//   /pgc/view/v2/app/season   番剧页：删 data.payment（会员付费块）
//   /pgc/view/web/season      网页番剧页：删 result.payment
//   /pgc/page/bangumi         番剧页模块：删 module_style/type 为 ad 的模块
//   /xlive/app-interface/v2/index/feed  直播首页：只删 small_card_v1 里的广告卡
//   /xlive/app-interface/v2/room/recList 直播推荐：同上
//   /xlive/web-interface/v1/index/getList 网页直播首页：只删 banner 广告卡
//   /xlive/app-room/v1/index/getInfoByRoom 房间页：只删 banner / 购物位，不碰房间信息
//   /xlive/web-room/v1/index/getInfoByRoom 网页房间页：同上
//   /pgc/activity/.../receive 番剧弹窗广告：返回关闭
//   /x/resource/show/tab*     底部 tab：删「发布」+「会员购」，顶部删「游戏中心」
//   /x/v2/account/mine        我的页：删「我的服务」、大会员推广块与 VIP 分区
//
// 只处理上面这些接口，形状对不上就原样放行，最差是不生效，不会把播放改坏。

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || {};
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = res.url || req.url || "";

  // Loon 传位置数组或对象，Egern 传 JSON 字符串，三种都兼容。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { block_ads: raw[0], hide_vip: raw[1], clean_ui: raw[2], web: raw[3] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const blockAds = flag(opt.block_ads, true);
  const hideVip = flag(opt.hide_vip, true);
  const cleanUi = flag(opt.clean_ui, true);
  const web = flag(opt.web, true);

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
    path.indexOf("/x/web-interface/wbi/search/type") >= 0 ||
    path.indexOf("/x/web-interface/wbi/search/square") >= 0 ||
    path.indexOf("/x/web-interface/archive/related") >= 0 ||
    path.indexOf("/x/web-interface/view") >= 0 ||
    path.indexOf("/x/vip/ads/materials") >= 0 ||
    path.indexOf("/pgc/view/v2/app/season") >= 0 ||
    path.indexOf("/pgc/view/web/season") >= 0 ||
    path.indexOf("/pgc/page/") >= 0 ||
    path.indexOf("/pgc/activity/deliver/material/receive") >= 0 ||
    path.indexOf("/x/resource/show/tab") >= 0 ||
    path.indexOf("/x/v2/account/mine") >= 0 ||
    path.indexOf("/x/polymer/web-dynamic/v1/feed/all") >= 0 ||
    path.indexOf("/xlive/") >= 0;
  if (!handled) {
    $done({});
    return;
  }

  const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
  const str = (v) => (typeof v === "string" ? v.toLowerCase() : "");

  // 信息流广告只认这几个标记，不做全树遍历，
  // 避免把直播 tab、配置块这类正常对象误删。
  const isFeedAd = (o) => {
    if (!isObj(o)) return false;
    const ct = "string" == typeof o.card_type ? o.card_type : "";
    const cg = "string" == typeof o.card_goto ? o.card_goto : "";
    // small_cover_v10 + game 是游戏推广卡，卡片本身没有 cm_ / ad_ 标记。
    return (
      ct.indexOf("cm_") === 0 ||
      cg.indexOf("ad_") === 0 ||
      (ct === "small_cover_v10" && cg === "game") ||
      o.goto === "ad" ||
      o.is_ad === true
    );
  };

  // 竖屏短视频流里的广告卡。
  const STORY_AD_GOTOS = ["vertical_ad_av", "vertical_ad_picture", "vertical_ad_live", "vertical_pgc"];

  const keepNotAd = (arr) => {
    if (!Array.isArray(arr)) return null;
    const kept = arr.filter((item) => !isFeedAd(item));
    return kept.length === arr.length ? null : kept;
  };

  // 直播卡片的广告标记：is_ad / show_ad_icon / ad_transparent_content。
  const truthyFlag = (v) => v === true || v === 1 || v === "1";
  const isLiveCardAd = (o) => {
    if (!isObj(o)) return false;
    const mark = o.ad_transparent_content;
    const transparent =
      "string" == typeof mark ? mark.trim().length > 0 : isObj(mark) ? Object.keys(mark).length > 0 : Boolean(mark);
    return truthyFlag(o.is_ad) || truthyFlag(o.show_ad_icon) || transparent;
  };

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

  // 番剧页的会员付费块：App 在 data，网页版在 result。
  if (path.indexOf("/pgc/view/v2/app/season") >= 0 || (web && path.indexOf("/pgc/view/web/season") >= 0)) {
    [data.data, data.result].forEach((d) => {
      if (!isObj(d) || !hideVip || !d.payment) return;
      delete d.payment;
      changed = true;
    });
  }

  // 直播：只处理这三个接口。通用 walk 会顺着对象树把
  // room_info / playurl_info 里带广告字段的正常对象也删掉，导致直播打不开。
  const isLive = path.indexOf("/xlive/") >= 0;
  if (isLive && blockAds) {
    const d = isObj(data.data) ? data.data : {};
    if (path.indexOf("/xlive/app-interface/v2/index/feed") >= 0 && Array.isArray(d.card_list)) {
      const kept = d.card_list.filter((card) => !isLiveCardAd(card?.card_data?.small_card_v1));
      if (kept.length !== d.card_list.length) {
        d.card_list = kept;
        changed = true;
      }
    } else if (path.indexOf("/xlive/app-interface/v2/room/recList") >= 0 && Array.isArray(d.list)) {
      const kept = d.list.filter((card) => !isLiveCardAd(card));
      if (kept.length !== d.list.length) {
        d.list = kept;
        changed = true;
      }
    } else if (web && path.indexOf("/xlive/web-interface/v1/index/getList") >= 0 && Array.isArray(d.banner)) {
      // 网页版直播首页：banner 里带 is_ad / show_ad_icon 的卡片才删。
      const kept = d.banner.filter((card) => !isLiveCardAd(card));
      if (kept.length !== d.banner.length) {
        d.banner = kept;
        changed = true;
      }
    } else if (path.indexOf("getInfoByRoom") >= 0 && (web || path.indexOf("web-room") < 0)) {
      // App / 网页房间页只删 banner 和购物位，其余一律不碰。
      if ("activity_banner_info" in d) {
        delete d.activity_banner_info;
        changed = true;
      }
      if (isObj(d.shopping_info) && 0 !== d.shopping_info.is_show) {
        d.shopping_info = { is_show: 0 };
        changed = true;
      }
      const outer = d.new_tab_info?.outer_list;
      if (Array.isArray(outer)) {
        const kept = outer.filter((item) => 33 !== item?.biz_id);
        if (kept.length !== outer.length) {
          d.new_tab_info.outer_list = kept;
          changed = true;
        }
      }
    }
  }

  // 首页 / 推荐：只过滤 data.items；大图 banner 只删其中的广告项。
  if (blockAds && path.indexOf("/x/v2/feed/index") >= 0) {
    const items = data.data?.items;
    if (Array.isArray(items)) {
      const story = path.indexOf("/story") >= 0;
      for (const item of items) {
        if (!isObj(item) || !Array.isArray(item.banner_item)) continue;
        const kept = item.banner_item.filter((b) => !(isObj(b) && (b.type === "ad" || b.type === "ad_inline")));
        if (kept.length !== item.banner_item.length) {
          item.banner_item = kept;
          changed = true;
        }
      }
      const kept = items.filter((item) => {
        if (!isObj(item)) return true;
        if (story) return STORY_AD_GOTOS.indexOf(item.card_goto) < 0;
        return !isFeedAd(item);
      });
      if (kept.length !== items.length) {
        data.data.items = kept;
        changed = true;
      }
    }
  }

  // 网页版推荐流：只过滤 data.item 里 goto=ad 的条目。
  if (web && blockAds && path.indexOf("/x/web-interface/wbi/index/top/feed/rcmd") >= 0) {
    const kept = keepNotAd(data.data?.item);
    if (kept) {
      data.data.item = kept;
      changed = true;
    }
  }

  // 网页版搜索：/wbi/search/type 的 data.result 是视频数组；部分聚合接口
  // 会再包一层 { result_type, data: [...] }，两种都按同样的广告标记过滤。
  if (web && blockAds && (path.indexOf("/x/web-interface/wbi/search/type") >= 0 || path.indexOf("/x/web-interface/wbi/search/square") >= 0)) {
    const d = data.data;
    if (Array.isArray(d)) {
      const kept = keepNotAd(d);
      if (kept) {
        data.data = kept;
        changed = true;
      }
    } else if (isObj(d)) {
      const result = d.result;
      if (Array.isArray(result)) {
        let touched = false;
        for (const group of result) {
          if (!isObj(group) || !Array.isArray(group.data)) continue;
          const inner = keepNotAd(group.data);
          if (inner) {
            group.data = inner;
            touched = true;
          }
        }
        const kept = keepNotAd(result);
        if (kept) {
          d.result = kept;
          touched = true;
        }
        if (touched) changed = true;
      }
    }
  }

  // 网页版相关推荐：data 本身就是数组，只过滤广告项。
  if (web && blockAds && path.indexOf("/x/web-interface/archive/related") >= 0) {
    const kept = keepNotAd(data.data);
    if (kept) {
      data.data = kept;
      changed = true;
    }
  }

  // 网页版视频详情：cm_config 是播放器广告配置；relates / relates 里的广告卡
  // 只在存在时过滤，不碰播放地址和分 P。
  if (web && path.indexOf("/x/web-interface/view") >= 0 && isObj(data.data)) {
    const d = data.data;
    if (blockAds) {
      ["cm_config", "cm_ipad", "cm_under_player"].forEach((key) => {
        if (key in d) {
          delete d[key];
          changed = true;
        }
      });
      const kept = keepNotAd(d.relates);
      if (kept) {
        d.relates = kept;
        changed = true;
      }
    }
  }

  // 网页版动态流：广告条目是 DYNAMIC_TYPE_AD，部分版本放在 module_dynamic 里。
  if (web && blockAds && path.indexOf("/x/polymer/web-dynamic/v1/feed/all") >= 0 && isObj(data.data) && Array.isArray(data.data.items)) {
    const items = data.data.items;
    const kept = items.filter((item) => {
      if (!isObj(item)) return true;
      if (item.type === "DYNAMIC_TYPE_AD") return false;
      const dynamic = item.modules?.module_dynamic;
      return dynamic?.additional?.type !== "DYNAMIC_TYPE_AD" && dynamic?.major?.type !== "DYNAMIC_TYPE_AD";
    });
    if (kept.length !== items.length) {
      data.data.items = kept;
      changed = true;
    }
  }

  // 搜索广场：data 本身就是数组，只过滤广告项。
  if (blockAds && path.indexOf("/x/v2/search/square") >= 0) {
    const kept = keepNotAd(data.data);
    if (kept) {
      data.data = kept;
      changed = true;
    }
  }

  // 番剧页的广告模块（module_style / module_type / type 为 ad）。
  // App 在 data.modules，网页版在 result.modules。
  if (blockAds && path.indexOf("/pgc/page/") >= 0) {
    (web ? [data.data, data.result] : [data.data]).forEach((d) => {
      if (!isObj(d) || !Array.isArray(d.modules)) return;
      const modules = d.modules;
      const kept = modules.filter((m) => {
        if (!isObj(m)) return true;
        const style = str(m.module_style);
        const type = str(m.module_type) || str(m.type);
        const ad = style === "ad" || style.indexOf("ad_") === 0 || type === "ad" || type.indexOf("ad_") === 0;
        if (ad) changed = true;
        return !ad;
      });
      if (kept.length !== modules.length) d.modules = kept;
    });
  }

  // 底部 tab：去掉中间的「发布」按钮和「会员购」入口；顶部去掉「游戏中心」。
  // 删完要按新顺序重排 pos，否则客户端会按旧位置留空位。
  if (cleanUi && path.indexOf("/x/resource/show/tab") >= 0) {
    const d = data.data;
    if (isObj(d)) {
      const dropTab = (t) => {
        if (!isObj(t)) return false;
        const name = typeof t.name === "string" ? t.name.trim() : "";
        const id = typeof t.tab_id === "string" ? t.tab_id : "";
        return name === "发布" || name === "会员购" || name === "游戏中心" || id.indexOf("会员购") >= 0;
      };
      ["top", "tab", "bottom"].forEach((key) => {
        const list = d[key];
        if (!Array.isArray(list)) return;
        const kept = list.filter((t) => !dropTab(t));
        if (kept.length === list.length) return;
        kept.forEach((t, i) => {
          if (isObj(t) && "pos" in t) t.pos = i + 1;
        });
        d[key] = kept;
        changed = true;
      });
    }
  }

  // 我的页：大会员推广块和「我的服务」分区。
  if (path.indexOf("/x/v2/account/mine") >= 0) {
    const d = data.data;
    if (isObj(d)) {
      if (hideVip) {
        ["vip_section", "vip_section_v2"].forEach((k) => {
          if (k in d) {
            delete d[k];
            changed = true;
          }
        });
      }
      if (Array.isArray(d.sections_v2) || Array.isArray(d.sections)) {
        ["sections_v2", "sections"].forEach((key) => {
          const list = d[key];
          if (!Array.isArray(list)) return;
          const kept = list.filter((s) => {
            if (!isObj(s)) return true;
            const title = typeof s.title === "string" ? s.title : "";
            if (hideVip && /大会员|会员购/.test(title)) return false;
            if (cleanUi && /我的服务/.test(title)) return false;
            return true;
          });
          if (kept.length !== list.length) {
            d[key] = kept;
            changed = true;
          }
        });
      }
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
  $done({ body: out });
})();
