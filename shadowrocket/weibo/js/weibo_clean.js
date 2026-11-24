//=======================================================================================
// Weibo Clean — 微博开屏 / 时间线 / 评论 / 热搜广告清理
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
// Weibo Clean — 微博开屏、时间线、评论区、热搜与「我的」页全方位广告清理
//
// 为什么之前微博「我的」页与部分时间线去不干净：
//   1) `clean_ui` 默认是 false，导致 `/2/profile/me` 里「我的钱包 / 借钱 / 游戏 / 热门活动」
//      等几十个营销卡片默认全部放行了！现已把 `clean_ui` 默认改为 `true`，且把横幅广告、
//      活动轮播、VIP 诱导直接归入 `block_ads`。
//   2) 新版微博「我的」页和个人主页除了 `/2/profile/me`，还会走：
//      - `/2/profile/container_timeline`（我的页下方的混合流）
//      - `/2/profile/statuses`、`/2/profile/dealatt`
//      - `/2/cardlist`、`/2/page`（containerid=100505... 或 mine_*）
//      - `/2/client/publisher_list`、`/2/checkin/show`（签到弹窗/浮层）
//   3) `/2/profile/me` 的 `items` 结构分多层：
//      - 顶层 `items[]` 里既有 `category: "card"`（带 `data.card_type`），也有 `category: "group"`
//        （内部套 `items[]` 或 `data.card_group[]`）；
//      - 保留核心功能卡片（顶栏头像 `profile_mine_header` / `100505`、我的相册/赞/收藏/历史记录
//        `mine_1` / `100505_mine`、创作中心/草稿箱），其余金融借贷、微贷、省钱卡、游戏、
//        活动横幅（`card_type: 19 / 22 / 118 / 208`、`mine_2` 活动块）全部递归剥离！
//
// 保护字符串外的 16+ 位微博 mid / uid 整数，避免 JSON.parse 丢精度。
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

  // 兼容 wbpullad.lua 有时返回非纯 JSON（前导文本 + JSON）或标准 JSON
  let rawJson = body;
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    const idx = body.indexOf("{");
    const lastIdx = body.lastIndexOf("}");
    if (idx >= 0 && lastIdx > idx && /wbpullad\.lua/.test(url)) {
      rawJson = body.slice(idx, lastIdx + 1);
    } else {
      $done({});
      return;
    }
  }

  // 微博 mid / id 都是 16~19 位整数，用占位符保护字符串外的长整数。
  const BIGINT_MARK = "__wb_bigint_";
  let hasBigInt = false;
  const safeBody = rawJson.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
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

  // ---------- 1. 微博单条状态 (mblog) 广告判定 ----------
  const isAdMblog = (m) => {
    if (!isObj(m)) return false;
    if (truthy(m.is_ad) || truthy(m.ad_state) || truthy(m.isAd)) return true;
    if (nonEmptyObj(m.promotion) || nonEmptyObj(m.ad_info) || nonEmptyObj(m.ad_data)) return true;
    if (nonEmptyObj(m.promotion_info) || nonEmptyObj(m.ad_tag)) return true;
    if (m.readtimetype === "adMblog") return true;
    const typeName = typeof m.mblogtypename === "string" ? m.mblogtypename : "";
    const mark = typeof m.mark === "string" ? m.mark : "";
    const titleText = isObj(m.title) && typeof m.title.text === "string" ? m.title.text : "";
    if (/广告|热推|推广|品牌|赞助|商业/.test(typeName)) return true;
    if (mark && /(?:^|[_|-])ad(?:$|[_|-])/i.test(mark)) return true;
    if (/广告|热推|商业推广/.test(titleText)) return true;
    if (isObj(m.content_auth_info) && /广告|热推|推广/.test(String(m.content_auth_info.content_auth_title || ""))) {
      return true;
    }
    // 顺手剥离正常微博里的商业附加挂件（同款商品、微博小店横幅、正文顶栏营销）
    for (const k of ["common_struct", "ad_struct", "semantic_brand_params", "follow_data"]) {
      if (isObj(m[k]) || (Array.isArray(m[k]) && m[k].length)) {
        delete m[k];
        changed = true;
      }
    }
    return false;
  };

  // 容器流条目（container_timeline / items）可能是 mblog，也可能是包裹了 data.mblog 的卡片
  const isAdTimelineItem = (item) => {
    if (!isObj(item)) return false;
    if (isAdMblog(item)) return true;
    if (isObj(item.data) && isAdMblog(item.data)) return true;
    if (isObj(item.mblog) && isAdMblog(item.mblog)) return true;
    if (isObj(item.data) && isObj(item.data.mblog) && isAdMblog(item.data.mblog)) return true;
    const cat = String(item.category || item.type || item.card_type_name || "");
    if (/^(?:ad|advert|feed_ad|trend_ad|hot_ad|banner_ad)$/i.test(cat)) return true;
    if (item.type === "ad" || item.category === "ad") return true;
    // 信息流里夹杂的横幅 / 推荐关注 / 商业卡片块 (trend / card)
    const d = isObj(item.data) ? item.data : item;
    if (truthy(d.is_ad) || nonEmptyObj(d.promotion) || nonEmptyObj(d.ad_data)) return true;
    if (d.card_type === 22 || d.card_type === 118 || d.card_type === 208 || d.card_type === 89) {
      if (d.is_ad || d.promotion || /广告|热推|推荐|赞助|活动/.test(String(d.title || d.card_type_name || d.itemid || ""))) {
        return true;
      }
    }
    const itemId = String(item.itemId || item.itemid || d.itemid || "");
    if (/^(?:ad_|advert_|trend_ad|feed_ad|ym_ad)/i.test(itemId)) return true;
    return false;
  };

  // ---------- 2. 发现页 / 热搜 / 通用卡片 (card / card_group) 广告判定 ----------
  const isAdCard = (card) => {
    if (!isObj(card)) return false;
    if (truthy(card.is_ad) || truthy(card.ad_state) || nonEmptyObj(card.promotion) || nonEmptyObj(card.ad_data)) {
      return true;
    }
    if (card.card_type === 22 || (card.card_type === 118 && (card.is_ad || card.promotion))) return true;
    if (isObj(card.mblog) && isAdMblog(card.mblog)) return true;
    // 热搜词条里的「商」「广告」「热推」「荐」商业角标
    const desc = String(card.small_icon_desc || card.icon_desc || card.flag_desc || card.card_type_name || "");
    if (/^(?:商|广告|热推|推广|品牌)$/.test(desc.trim())) return true;
    if (typeof card.pic === "string" && /(?:_ad_|\/ad_|commercial)/i.test(card.pic) && card.promotion) return true;
    if (isObj(card.actionlog) && (card.actionlog.source === "ad" || /ad_id|is_ad/.test(String(card.actionlog.ext || "")))) {
      return true;
    }
    const itemid = String(card.itemid || "");
    if (/ad_channel|finder_banner_ad|hotsearch_ad|commercial/i.test(itemid)) return true;
    if (isObj(card.data) && isAdCard(card.data)) return true;
    return false;
  };

  // ---------- 3. 评论区广告判定 ----------
  const isAdComment = (c) => {
    if (!isObj(c)) return false;
    if (truthy(c.is_ad) || truthy(c.ad_state) || nonEmptyObj(c.ad_info) || nonEmptyObj(c.promotion)) return true;
    if (typeof c.adType === "string" && c.adType.length > 0) return true;
    if (typeof c.adType === "number" && c.adType > 0) return true;
    if (c.type === 1 && (c.adType || (isObj(c.data) && (c.data.is_ad || c.data.adType || c.data.promotion)))) {
      return true;
    }
    // 评论区插在楼层中间的推荐话题 / 软广横幅（type === 2 或 comment_type === "ad"）
    if (c.comment_type === "ad" || c.type === "ad") return true;
    if (isObj(c.data) && isAdComment(c.data)) return true;
    return false;
  };

  // ---------- 4. 「我的」页 (/2/profile/me 及 container_timeline) 广告与营销卡片判定 ----------
  // 微博「我的」页塞满了：
  //   - 顶部会员横幅、SVIP 续费横幅 (vip_center / top_cards / profile_vip_*)
  //   - 活动轮播 banner (card_type=118 / 208 / 22，itemid="mine_banner" / "100505_-_newusertask" / "recommended_services")
  //   - 我的钱包（借钱、微贷、分期、办卡、保险、理财）
  //   - 热门服务（微博游戏、小游戏、直播、抓娃娃、商城、漫画、听书、好运签、免费小说、红包、免流量）
  const PROFILE_AD_ITEMID_RE =
    /ad|banner|vip|wallet|finance|loan|borrow|game|novel|shop|mall|live|redpacket|task|welfare|activity|recommend|promotion|hot_service|newusertask|kingcard|free_traffic|charity_ad/i;
  const PROFILE_AD_TEXT_RE =
    /借钱|微贷|贷款|分期|白条|信用卡|办卡|理财|保险|钱包|红包|领钱|提现|金币|签到领|做任务|福利|抽奖|夺宝|优惠券|省钱卡|会员中心|SVIP|VIP|游戏|小游戏|游民|电竞|商城|买好物|种草|潮物|直播|连麦|语聊|相亲|找对象|心理测试|运势|星座|算命|塔罗|占卜|免费小说|漫画|故事|短剧|听书|免流量|王卡|流量包|网盘|彩铃|壁纸|表情包|公益广告|商业推广|热推|热门活动|推荐服务/;
  // 「我的」页必须保留的核心用户功能（头像资料、我的相册/赞/收藏/浏览历史、草稿箱、创作中心、客服、设置）
  const PROFILE_KEEP_TEXT_RE =
    /^(?:我的相册|相册|我的赞|赞|收藏|浏览记录|历史记录|浏览历史|草稿箱|创作中心|客服|客服中心|设置|夜间模式|深色模式|屏蔽管理|粉丝服务)$/;

  const cleanProfileIconGrid = (list) => {
    if (!Array.isArray(list) || !list.length) return list;
    return list.filter((entry) => {
      if (!isObj(entry)) return true;
      const d = isObj(entry.data) ? entry.data : entry;
      const title = String(d.title_sub || d.title || d.desc || d.name || "").trim();
      const scheme = String(d.scheme || "");
      if (PROFILE_KEEP_TEXT_RE.test(title)) return true;
      if (isAdCard(d) || isAdTimelineItem(entry)) return false;
      if (PROFILE_AD_TEXT_RE.test(title)) return false;
      if (cleanUi && /(?:wallet|finance|game|mall|shop|novel|live|vip|task|lottery|redpacket)/i.test(scheme)) {
        return false;
      }
      return true;
    });
  };

  const isProfileTrashCard = (item) => {
    if (!isObj(item)) return false;
    if (isAdTimelineItem(item) || isAdCard(item)) return true;
    const d = isObj(item.data) ? item.data : item;
    if (isAdCard(d)) return true;

    const itemId = String(item.itemId || item.itemid || d.itemid || d.card_id || "");
    const title = String(d.title || d.card_type_name || d.desc || d.name || "").trim();
    const ct = Number(d.card_type || item.card_type || 0);

    // 保留顶部个人信息卡（头像/昵称/微博数/关注/粉丝）与核心「我的相册/赞/收藏/历史」四宫格
    if (/header|userinfo|user_info|avatar|profile_top/i.test(itemId)) return false;
    if (ct === 11 || Array.isArray(d.card_group) || Array.isArray(item.items)) {
      // 这是一个分组容器，交给递归去洗它内部的 items / card_group；如果洗完空了再删容器
    }

    // 轮播图横幅 (118)、大图活动横幅 (22 / 208 / 196) 在「我的」页 100% 是广告或营销活动
    if (blockAds && (ct === 118 || ct === 22 || ct === 208 || ct === 196 || ct === 89)) {
      return true;
    }

    if (blockAds && /(?:^|[_-])(?:ad|banner|activity_banner|vip_banner|top_ad|float)(?:$|[_-])/i.test(itemId)) {
      return true;
    }

    if (cleanUi) {
      if (PROFILE_AD_ITEMID_RE.test(itemId) && !/mine_header|user_info|my_fav|my_like|my_album|my_history/i.test(itemId)) {
        return true;
      }
      if (title && PROFILE_AD_TEXT_RE.test(title) && !PROFILE_KEEP_TEXT_RE.test(title)) {
        return true;
      }
    }
    return false;
  };

  const cleanProfileItems = (list) => {
    if (!Array.isArray(list) || !list.length) return null;
    const out = [];
    let modified = false;

    for (const item of list) {
      if (!isObj(item)) {
        out.push(item);
        continue;
      }
      if (isProfileTrashCard(item)) {
        modified = true;
        continue;
      }
      const d = isObj(item.data) ? item.data : item;

      // 处理嵌套在 item.items 里的分组
      if (Array.isArray(item.items) && item.items.length) {
        const sub = cleanProfileItems(item.items);
        if (sub) {
          modified = true;
          if (!sub.length) continue;
          item.items = sub;
        }
      }

      // 处理宫格列表 (card_type=17 / grid / elements / items)
      for (const gridKey of ["elements", "items", "menus", "entrances"]) {
        if (Array.isArray(d[gridKey]) && d[gridKey].length) {
          const filteredGrid = cleanProfileIconGrid(d[gridKey]);
          if (filteredGrid.length !== d[gridKey].length) {
            modified = true;
            if (!filteredGrid.length) {
              d[gridKey] = [];
            } else {
              d[gridKey] = filteredGrid;
            }
          }
        }
      }
      if (
        (Array.isArray(d.elements) && !d.elements.length) ||
        (Array.isArray(d.menus) && !d.menus.length)
      ) {
        modified = true;
        continue;
      }

      // 处理 card_group
      if (Array.isArray(d.card_group) && d.card_group.length) {
        const subGroup = cleanProfileItems(d.card_group);
        if (subGroup) {
          modified = true;
          if (!subGroup.length) continue;
          d.card_group = subGroup;
        }
        const gridGroup = cleanProfileIconGrid(d.card_group);
        if (gridGroup.length !== d.card_group.length) {
          modified = true;
          if (!gridGroup.length) continue;
          d.card_group = gridGroup;
        }
      }

      // 如果卡片标题是「我的钱包」「更多服务」「热门活动」，直接整块拿掉
      const sectionTitle = String(d.title || d.card_type_name || item.title || "").trim();
      if (cleanUi && /我的钱包|微博钱包|金融服务|热门活动|推荐服务|更多服务|游戏中心|福利中心|我的服务/.test(sectionTitle)) {
        modified = true;
        continue;
      }

      out.push(item);
    }

    return modified ? out : null;
  };

  // 过滤普通数组；若删完为空且 allowEmpty=false 则保留原数组
  const filterList = (holder, key, predicate, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = list.filter((x) => !isObj(x) || !predicate(x));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
    }
  };

  // 递归清理发现页 / 热搜 / cardlist 的 cards 及其内部的 card_group
  const cleanCardArray = (holder, key) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = [];
    let localChanged = false;
    for (const card of list) {
      if (!isObj(card)) {
        kept.push(card);
        continue;
      }
      if (isAdCard(card) || isAdTimelineItem(card)) {
        localChanged = true;
        continue;
      }
      if (Array.isArray(card.card_group) && card.card_group.length) {
        const groupKept = card.card_group.filter((g) => !isObj(g) || (!isAdCard(g) && !isAdTimelineItem(g)));
        if (groupKept.length !== card.card_group.length) {
          localChanged = true;
          if (!groupKept.length) {
            continue;
          }
          card.card_group = groupKept;
        }
      }
      if (isObj(card.data) && Array.isArray(card.data.card_group) && card.data.card_group.length) {
        const groupKept = card.data.card_group.filter((g) => !isObj(g) || (!isAdCard(g) && !isAdTimelineItem(g)));
        if (groupKept.length !== card.data.card_group.length) {
          localChanged = true;
          if (!groupKept.length) {
            continue;
          }
          card.data.card_group = groupKept;
        }
      }
      kept.push(card);
    }
    if (localChanged && kept.length > 0) {
      holder[key] = kept;
      changed = true;
    }
  };

  try {
    // 1. 开屏与冷启动配置 (/wbapplua/wbpullad.lua, /2/push/active, /2/client/*)
    if (/\/wbapplua\/wbpullad\.lua$|\/2\/push\/active$|\/2\/client\/|\/2\/checkin\//.test(path)) {
      if (blockAds) {
        const FUTURE = 2208960000;
        const holders = [data, data.cached_ad, data.data];
        for (const h of holders) {
          if (!isObj(h)) continue;
          for (const k of ["ads", "ad_list", "ads_list", "feed_ads", " tips", "float_ad", "popup"]) {
            if (Array.isArray(h[k]) && h[k].length) {
              for (const ad of h[k]) {
                if (!isObj(ad)) continue;
                ad.start_date = FUTURE;
                ad.end_date = FUTURE + 86400;
                ad.display_duration = 0;
              }
              h[k] = [];
              changed = true;
            } else if (isObj(h[k]) && Object.keys(h[k]).length) {
              delete h[k];
              changed = true;
            }
          }
        }
        if (data.need_ad) {
          data.need_ad = 0;
          changed = true;
        }
      }
    }

    // 2. 时间线与视频流 (/2/statuses/*, /2/groups/timeline, /2/video/*, /2/direct_messages/*)
    if (/\/2\/(?:statuses\/|groups\/timeline|video\/)/.test(path)) {
      if (blockAds) {
        filterList(data, "statuses", isAdTimelineItem);
        filterList(data, "items", isAdTimelineItem);
        filterList(data, "trends", isAdTimelineItem, true);
        cleanCardArray(data, "cards");
        for (const k of ["advertises", "ad", "ads", "feed_ads", "top_cards"]) {
          if (Array.isArray(data[k]) && data[k].length) {
            data[k] = [];
            changed = true;
          }
        }
        // 详情页 extend 接口里的推广横幅与商品卡
        if (/\/2\/statuses\/extend$/.test(path)) {
          for (const k of [
            "head_cards",
            "trend",
            "ad_info",
            "common_struct",
            "follow_data",
            "reward_info",
            " semantics_brand_params",
            "extend_info",
          ]) {
            if (data[k] !== undefined && data[k] !== null) {
              delete data[k];
              changed = true;
            }
          }
        }
      }
    }

    // 3. 评论区 (/2/comments/build_comments)
    if (/\/2\/comments\/build_comments$/.test(path)) {
      if (blockAds) {
        filterList(data, "datas", isAdComment);
        filterList(data, "root_comments", isAdComment);
        filterList(data, "comments", isAdComment);
        for (const k of ["comment_bubble", "ad_info", "header_info", "top_cards", "trend"]) {
          if (data[k] !== undefined && data[k] !== null) {
            if (k === "header_info" && isObj(data[k]) && !data[k].is_ad && !data[k].ad_type) continue;
            delete data[k];
            changed = true;
          }
        }
      }
    }

    // 4. 「我的」页与个人页 (/2/profile/me, /2/profile/container_timeline, /2/profile/statuses)
    //    以及 containerid 带 mine / profile 的 /2/page 与 /2/cardlist
    const isProfileUrl =
      /\/2\/profile\//.test(path) ||
      (/\/2\/(?:page|cardlist)$/.test(path) && /(?:mine|profile|100505)/i.test(url));

    if (isProfileUrl) {
      if (blockAds || cleanUi) {
        for (const holder of [data, data.data]) {
          if (!isObj(holder)) continue;
          for (const dropKey of [
            "vip_center",
            "vipCenter",
            "top_cards",
            "ad_info",
            "banners",
            "banner",
            "tips",
            "floating_window",
            "checkin_info",
            "pendant",
            "welfare_info",
          ]) {
            if (holder[dropKey] !== undefined && holder[dropKey] !== null) {
              delete holder[dropKey];
              changed = true;
            }
          }
          for (const arrKey of ["items", "cards", "card_group"]) {
            if (Array.isArray(holder[arrKey]) && holder[arrKey].length) {
              const cleaned = cleanProfileItems(holder[arrKey]);
              if (cleaned && cleaned.length > 0) {
                holder[arrKey] = cleaned;
                changed = true;
              }
            }
          }
          filterList(holder, "statuses", isAdTimelineItem);
        }
      }
    }

    // 5. 发现页、热搜与通用卡片流 (/2/search/*, /2/page, /2/cardlist)
    if (/\/2\/(?:search\/|page$|cardlist$)/.test(path)) {
      if (blockAds) {
        for (const holder of [data, data.data]) {
          if (!isObj(holder)) continue;
          cleanCardArray(holder, "cards");
          cleanCardArray(holder, "items");
          filterList(holder, "statuses", isAdTimelineItem);
          for (const k of ["top_cards", "banners", "ad_list", "ads"]) {
            if (Array.isArray(holder[k]) && holder[k].length) {
              holder[k] = [];
              changed = true;
            }
          }
        }
        if (isObj(data.channelInfo) && Array.isArray(data.channelInfo.channels)) {
          const kept = data.channelInfo.channels.filter(
            (ch) => !isObj(ch) || (!ch.is_ad && !/广告|推广|游戏|商城/.test(String(ch.name || "")))
          );
          if (kept.length && kept.length !== data.channelInfo.channels.length) {
            data.channelInfo.channels = kept;
            changed = true;
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

  let out = JSON.stringify(data);
  if (hasBigInt) {
    out = out.replace(new RegExp('"' + BIGINT_MARK + '(-?\\d+)"', "g"), "$1");
  }
  $done({ body: out });
})();
