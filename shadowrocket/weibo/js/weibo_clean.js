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
// Weibo Clean — 微博开屏、时间线、评论区与热搜广告清理
//
// 只改 JSON 响应，按结构删数组元素或字段，不碰图片与视频流：
//
//   /wbapplua/wbpullad.lua | /2/push/active
//     开屏与冷启动广告：清空 ads / cached_ad，把投放时间推到 2040 年
//   /2/statuses/(unread_hot_timeline|friends_timeline|container_timeline|bilateral_timeline|extend)
//   /2/groups/timeline | /2/video/tiny_stream_video_list
//     时间线与详情：过滤 statuses / items / trends 里带 promotion / ad_state / mblogtypename="广告"|"热推"
//     或 readtimetype="adMblog" 的推广微博，剥离正文下方的商业卡片
//   /2/comments/build_comments
//     评论区：过滤 datas / root_comments 里带 adType / is_ad / type=1(广告评论) 的推广条目與评论文案气泡广告
//   /2/search/(finder|container_timeline|container_discover) | /2/page | /2/cardlist
//     发现页与热搜：过滤 cards / card_group / items 里带 promotion / is_ad / "商"|"广告"|"热推" 角标的商业热搜与横幅
//   /2/profile/me (clean_ui=true 时)
//     我的页：隐藏会员中心横幅、钱包借钱、游戏推广等营销卡片
//
// 保护字符串外的 16+ 位微博 mid / uid 整数，避免 JSON.parse 丢精度。
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

  // 预提取 JSON（兼容 wbpullad.lua 有时包在文本里或标准 JSON）
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    $done({});
    return;
  }

  // 微博 mid / id 都是 16~19 位整数，用占位符保护字符串外的长整数。
  const BIGINT_MARK = "__wb_bigint_";
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

  // ---------- 微博单条状态 (mblog) 广告判定 ----------
  const isAdMblog = (m) => {
    if (!isObj(m)) return false;
    if (truthy(m.is_ad) || truthy(m.ad_state) || truthy(m.isAd)) return true;
    if (nonEmptyObj(m.promotion) || nonEmptyObj(m.ad_info) || nonEmptyObj(m.ad_data)) return true;
    if (m.readtimetype === "adMblog") return true;
    const typeName = typeof m.mblogtypename === "string" ? m.mblogtypename : "";
    const mark = typeof m.mark === "string" ? m.mark : "";
    if (/广告|热推|推广|品牌/.test(typeName)) return true;
    if (mark && /(?:^|[_|-])ad(?:$|[_|-])/i.test(mark)) return true;
    if (isObj(m.title) && typeof m.title.text === "string" && /广告|热推|推荐/.test(m.title.text) && m.promotion_info) {
      return true;
    }
    if (isObj(m.content_auth_info) && /广告|热推/.test(String(m.content_auth_info.content_auth_title || ""))) {
      return true;
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
    if (/^(?:ad|advert|feed_ad|trend_ad)$/i.test(cat)) return true;
    if (isObj(item.data) && (truthy(item.data.is_ad) || nonEmptyObj(item.data.promotion) || item.data.card_type === 22)) {
      return true;
    }
    return false;
  };

  // ---------- 发现页 / 热搜卡片 (card / card_group) 广告判定 ----------
  const isAdCard = (card) => {
    if (!isObj(card)) return false;
    if (truthy(card.is_ad) || truthy(card.ad_state) || nonEmptyObj(card.promotion) || nonEmptyObj(card.ad_data)) {
      return true;
    }
    if (card.card_type === 22 || card.card_type === 118 && card.is_ad) return true;
    if (isObj(card.mblog) && isAdMblog(card.mblog)) return true;
    // 热搜词条里的「商」「广告」「热推」角标
    const desc = String(card.small_icon_desc || card.icon_desc || card.flag_desc || card.card_type_name || "");
    if (/^(?:商|广告|热推|推广|品牌)$/.test(desc.trim())) return true;
    if (typeof card.pic === "string" && /(?:_ad_|\/ad_|commercial)/i.test(card.pic) && card.promotion) return true;
    if (typeof card.actionlog === "object" && card.actionlog && card.actionlog.source === "ad") return true;
    if (isObj(card.data) && isAdCard(card.data)) return true;
    return false;
  };

  // ---------- 评论区广告判定 ----------
  const isAdComment = (c) => {
    if (!isObj(c)) return false;
    if (truthy(c.is_ad) || truthy(c.ad_state) || nonEmptyObj(c.ad_info) || nonEmptyObj(c.promotion)) return true;
    if (typeof c.adType === "string" && c.adType.length > 0) return true;
    if (typeof c.adType === "number" && c.adType > 0) return true;
    // build_comments 里的 datas 元素：{ type: 1, data: ... } 或 adType="广告"
    if (c.type === 1 && (c.adType || (isObj(c.data) && (c.data.is_ad || c.data.adType || c.data.promotion)))) {
      return true;
    }
    if (isObj(c.data) && isAdComment(c.data)) return true;
    return false;
  };

  // 过滤数组；若删完为空且 allowEmpty=false 则保留原数组
  const filterList = (holder, key, predicate, allowEmpty = false) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = list.filter((x) => !isObj(x) || !predicate(x));
    if (kept.length !== list.length && (allowEmpty || kept.length > 0)) {
      holder[key] = kept;
      changed = true;
    }
  };

  // 递归清理 cards 及其内部的 card_group
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
      if (isAdCard(card)) {
        localChanged = true;
        continue;
      }
      if (Array.isArray(card.card_group) && card.card_group.length) {
        const groupKept = card.card_group.filter((g) => !isObj(g) || !isAdCard(g));
        if (groupKept.length !== card.card_group.length) {
          localChanged = true;
          if (!groupKept.length) {
            continue;
          }
          card.card_group = groupKept;
        }
      }
      if (isObj(card.data) && Array.isArray(card.data.card_group) && card.data.card_group.length) {
        const groupKept = card.data.card_group.filter((g) => !isObj(g) || !isAdCard(g));
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
    // 1. 开屏与冷启动配置 (/wbapplua/wbpullad.lua, /2/push/active)
    if (/\/wbapplua\/wbpullad\.lua$|\/2\/push\/active$/.test(path)) {
      if (blockAds) {
        const FUTURE = 2208960000;
        const holders = [data, data.cached_ad, data.data];
        for (const h of holders) {
          if (!isObj(h)) continue;
          for (const k of ["ads", "ad_list", "ads_list", "feed_ads"]) {
            if (Array.isArray(h[k]) && h[k].length) {
              for (const ad of h[k]) {
                if (!isObj(ad)) continue;
                ad.start_date = FUTURE;
                ad.end_date = FUTURE + 86400;
                ad.display_duration = 0;
              }
              h[k] = [];
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

    // 2. 时间线与视频流 (/2/statuses/*, /2/groups/timeline, /2/video/tiny_stream_video_list)
    if (/\/2\/(?:statuses\/|groups\/timeline|video\/tiny_stream_video_list)/.test(path)) {
      if (blockAds) {
        filterList(data, "statuses", isAdTimelineItem);
        filterList(data, "items", isAdTimelineItem);
        filterList(data, "trends", isAdTimelineItem, true);
        if (Array.isArray(data.advertises) && data.advertises.length) {
          data.advertises = [];
          changed = true;
        }
        if (Array.isArray(data.ad) && data.ad.length) {
          data.ad = [];
          changed = true;
        }
        // 详情页 extend 接口里的推广横幅与商品卡
        if (/\/2\/statuses\/extend$/.test(path)) {
          for (const k of ["head_cards", "trend", "ad_info", "common_struct", "follow_data"]) {
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
        for (const k of ["comment_bubble", "ad_info", "header_info"]) {
          if (isObj(data[k]) && (data[k].is_ad || data[k].ad_type || k === "comment_bubble")) {
            delete data[k];
            changed = true;
          }
        }
      }
    }

    // 4. 发现页、热搜与卡片流 (/2/search/*, /2/page, /2/cardlist)
    if (/\/2\/(?:search\/|page$|cardlist$)/.test(path)) {
      if (blockAds) {
        cleanCardArray(data, "cards");
        cleanCardArray(data, "items");
        if (isObj(data.data)) {
          cleanCardArray(data.data, "cards");
          cleanCardArray(data.data, "items");
        }
        if (isObj(data.channelInfo) && Array.isArray(data.channelInfo.channels)) {
          const kept = data.channelInfo.channels.filter(
            (ch) => !isObj(ch) || (!ch.is_ad && !/广告|推广/.test(String(ch.name || "")))
          );
          if (kept.length && kept.length !== data.channelInfo.channels.length) {
            data.channelInfo.channels = kept;
            changed = true;
          }
        }
      }
    }

    // 5. 我的页精简 (/2/profile/me)
    if (/\/2\/profile\/me$/.test(path)) {
      if (blockAds && data.vip_center) {
        delete data.vip_center;
        changed = true;
      }
      if (cleanUi && Array.isArray(data.items)) {
        const UI_CLUTTER_RE = /钱包|借钱|游戏|微贷|信用|商城|漫画|免流量|任务中心|红包/;
        const kept = data.items.filter((item) => {
          if (!isObj(item)) return true;
          if (isAdTimelineItem(item)) return false;
          const text = JSON.stringify(item.data || item);
          return !UI_CLUTTER_RE.test(text);
        });
        if (kept.length && kept.length !== data.items.length) {
          data.items = kept;
          changed = true;
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
