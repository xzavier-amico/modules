//=======================================================================================
// NetEase Music Clean — 网易云音乐开屏 / 首页横幅 / 搜索 / 评论广告清理
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
// NetEase Music Clean — 网易云音乐开屏、首页横幅、左滑抽屉侧边栏、搜索热词与评论区广告清理
//
// 只改明文 JSON 响应（遇到二进制或 eapi 密文自动原样放行），不碰音频流与歌单正文：
//
//   /(eapi|api)/(ad|sp/loading)/
//     开屏与贴片配置：清空 data / ads / adInfo
//   /(eapi|api)/batch | /homepage/block/page | /v1/discovery/
//     首页发现流与聚合 batch 接口：
//     - 过滤 blocks[] 里 blockCode="HOMEPAGE_BANNER" 内部的商业广告图 (adid / adInfo / adSource)
//     - 过滤 blockCode 为 AD_BANNER / HOMEPAGE_AD_* 的纯广告模块
//     - clean_ui=true（默认开启）时额外移除直播间 / 语音房 / 播客推广模块
//   左滑抽屉侧边栏（商城、云村有票、云推歌、彩铃、游戏、直播、装扮、借钱等）：
//     - 网易云左滑菜单由 `/eapi/batch` 或独立接口 `/eapi/sidebar/`、`/eapi/entrance/`、
//       `/eapi/v1/user/detail`、`/eapi/music-main-sidebar/`、`/eapi/resource/exposure` 下发；
//     - 清洗 `sidebar` / `sideBar` / `menus` / `sections` / `entranceList` / `modules` 数组，
//       剔除「商城」「云村有票」「云推歌」「云贝中心」「游戏专区」「直播」「彩铃」「免费听歌」
//       「音乐推广」「热歌助推」等营销项，仅保留消息中心、创作者中心、黑胶会员（可选）、
//       设置、夜间模式、定时关闭、音乐闹钟、边听边存等核心工具！
//   /(eapi|api)/search/(hot|default|suggest)
//     搜索热词与默认占位词：过滤带 adInfo / alg="ad" / isAd 的商业买榜词
//   /(eapi|api)/(v1/resource/comments|v2/resource/comments|comment/)
//     评论区：清理评论顶部的 banner / adInfo 与带 adMark 的推广评论
//
// 保护字符串外的 16+ 位歌曲/评论 ID 整数，防止 JSON.parse 丢精度。
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
  // 网易云部分 eapi 走 AES 密文（非 '{' 或 '[' 开头），此处只处理明文 JSON 响应，密文直接安全放行。
  const first = body.charCodeAt(0);
  if (first !== 0x7b && first !== 0x5b) {
    $done({});
    return;
  }

  const BIGINT_MARK = "__ne_bigint_";
  let hasBigInt = false;
  const safeBody = body.replace(/"(?:\\.|[^"\\])*"|(-?\d{16,})/g, (m, num) => {
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

  const isBannerAd = (b) => {
    if (!isObj(b)) return false;
    if (truthy(b.isAd) || truthy(b.is_ad)) return true;
    if (b.adid || b.adId || nonEmptyObj(b.adInfo) || nonEmptyStr(b.adSource) || nonEmptyStr(b.adurlV2)) return true;
    if (b.targetType === 3000 && (b.adid || b.typeTitle === "广告" || b.typeTitle === "推广")) return true;
    if (/^(?:广告|推广|商业|赞助)$/.test(String(b.typeTitle || "").trim())) return true;
    return false;
  };

  const AD_BLOCK_CODE_RE = /(?:^|_)(?:AD|ADVERT|COMMERCIAL|PROMOTION)(?:_|$)/i;
  const UI_CLUTTER_BLOCK_RE = /(?:LIVE|VOICE|PODCAST|LOOK|KTV|MALL|GAME|YUNBEI|VIP_GUIDE|TICKET|PUSH_SONG)/i;

  const isAdBlock = (block) => {
    if (!isObj(block)) return false;
    const code = String(block.blockCode || block.showType || "");
    if (blockAds) {
      if (AD_BLOCK_CODE_RE.test(code)) return true;
      if (truthy(block.isAd) || nonEmptyObj(block.adInfo) || block.adid) return true;
    }
    if (cleanUi && UI_CLUTTER_BLOCK_RE.test(code)) return true;
    return false;
  };

  // ---------- 左滑抽屉侧边栏 (Sidebar / Drawer) 营销项判定 ----------
  // 目标剔除：商城、云村有票、云推歌、热歌助推、音乐推、云贝中心、游戏专区、云村直播/LOOK直播、
  // 彩铃专区、口袋彩铃、免费听歌、借钱/金融、网盘推广、在线听歌免流量、优惠券/我的订单等。
  const SIDEBAR_CLUTTER_TITLE_RE =
    /商城|有票|演出|云推歌|推歌|音乐推|热歌助推|火前留名|云贝|游戏|直播|语音房|K歌|歌房|相亲|交友|彩铃|免费听|领会员|赚云贝|做任务|福利|抽奖|借钱|贷款|白条|信用卡|王卡|免流量|优惠券|礼品卡|周边|黑胶时光机|听歌识曲推广|多多|特惠/;
  const SIDEBAR_CLUTTER_CODE_RE =
    /(?:^|_|-)(?:mall|store|shop|ticket|show|yuntuige|push_song|song_push|yunbei|game|live|look|voice|ktv|ringtone|cailing|free_listen|task|welfare|loan|finance|free_flow|coupon|order|ad|banner|promo)(?:$|_|-)/i;

  const isSidebarClutterItem = (item) => {
    if (!isObj(item)) return false;
    if (blockAds && (truthy(item.isAd) || truthy(item.is_ad) || nonEmptyObj(item.adInfo) || item.adid)) {
      return true;
    }
    if (!cleanUi) return false;
    const title = String(
      item.title || item.name || item.text || item.mainTitle || item.label || item.showName || item.desc || ""
    ).trim();
    const code = String(
      item.id || item.code || item.itemType || item.bizType || item.type || item.actionType || item.key || ""
    ).trim();
    const urlStr = String(item.url || item.actionUrl || item.scheme || item.orpheus || item.targetUrl || "");

    if (title && SIDEBAR_CLUTTER_TITLE_RE.test(title)) return true;
    if (code && SIDEBAR_CLUTTER_CODE_RE.test(code)) return true;
    if (
      urlStr &&
      /(?:store\/product|music\.163\.com\/store|show\/detail|ticket|yuntuige|pushsong|yunbei|look\.163\.com|game\.163)/i.test(
        urlStr
      )
    ) {
      return true;
    }
    return false;
  };

  // 递归清理左滑侧边栏的分组列表与子菜单
  const cleanSidebarArray = (holder, key) => {
    if (!isObj(holder) || !Array.isArray(holder[key]) || !holder[key].length) return;
    const list = holder[key];
    const kept = [];
    let modified = false;

    for (const item of list) {
      if (!isObj(item)) {
        kept.push(item);
        continue;
      }
      if (isSidebarClutterItem(item)) {
        modified = true;
        continue;
      }
      // 如果 item 是一个分组（如「音乐服务」「其他」分组，内部带 items / list / children / entrances / menus）
      for (const subKey of ["items", "list", "children", "entrances", "entranceList", "menus", "cells", "services"]) {
        if (Array.isArray(item[subKey]) && item[subKey].length) {
          const subKept = item[subKey].filter((sub) => !isObj(sub) || !isSidebarClutterItem(sub));
          if (subKept.length !== item[subKey].length) {
            modified = true;
            item[subKey] = subKept;
          }
        }
      }
      // 如果某个分组（「音乐服务」那栏本身就是商城/有票/云推歌/彩铃）被删空了，整个分组壳子也一并拿掉
      const hasEmptySubList = ["items", "list", "children", "entrances", "entranceList", "menus", "cells", "services"].some(
        (k) => Array.isArray(item[k]) && item[k].length === 0
      );
      if (hasEmptySubList) {
        modified = true;
        continue;
      }
      kept.push(item);
    }

    if (modified) {
      holder[key] = kept;
      changed = true;
    }
  };

  // 处理单个数据节点（支持直接接口响应，也支持 /batch 接口里每个子路径对应的字典值）
  const cleanNode = (node) => {
    if (!isObj(node)) return;

    // 1. 纯广告字段清理
    if (blockAds) {
      for (const k of [
        "ads",
        "adInfo",
        "adList",
        "loadingAd",
        "splashAd",
        "pendantData",
        "topAd",
        "floatAd",
        "vipPro",
        "redPacket",
      ]) {
        if (Array.isArray(node[k]) && node[k].length) {
          node[k] = [];
          changed = true;
        } else if (nonEmptyObj(node[k])) {
          node[k] = {};
          changed = true;
        }
      }
    }

    // 2. 首页 banners 数组过滤
    if (blockAds && Array.isArray(node.banners) && node.banners.length) {
      const kept = node.banners.filter((b) => !isBannerAd(b));
      if (kept.length && kept.length !== node.banners.length) {
        node.banners = kept;
        changed = true;
      }
    }

    // 3. 首页 blocks 数组（/homepage/block/page）
    const d = isObj(node.data) ? node.data : node;
    if (Array.isArray(d.blocks) && d.blocks.length) {
      const keptBlocks = [];
      let blockModified = false;
      for (const block of d.blocks) {
        if (!isObj(block)) {
          keptBlocks.push(block);
          continue;
        }
        if (isAdBlock(block)) {
          blockModified = true;
          continue;
        }
        if (blockAds && isObj(block.extInfo) && Array.isArray(block.extInfo.banners)) {
          const bList = block.extInfo.banners;
          const bKept = bList.filter((b) => !isBannerAd(b));
          if (bKept.length !== bList.length) {
            if (!bKept.length) {
              blockModified = true;
              continue;
            }
            block.extInfo.banners = bKept;
            blockModified = true;
          }
        }
        if (blockAds && Array.isArray(block.creatives) && block.creatives.length) {
          const cKept = block.creatives.filter(
            (c) => !isObj(c) || (!c.adInfo && !c.adid && !truthy(c.isAd) && c.creativeType !== "AD")
          );
          if (cKept.length !== block.creatives.length) {
            if (!cKept.length) {
              blockModified = true;
              continue;
            }
            block.creatives = cKept;
            blockModified = true;
          }
        }
        keptBlocks.push(block);
      }
      if (blockModified && keptBlocks.length) {
        d.blocks = keptBlocks;
        changed = true;
      }
    }

    // 4. 左滑抽屉侧边栏 (Sidebar / Drawer: 商城、云村有票、云推歌、彩铃、直播、游戏)
    for (const sHolder of [node, d, isObj(d.data) ? d.data : null]) {
      if (!isObj(sHolder)) continue;
      for (const sKey of [
        "sidebar",
        "sideBar",
        "sidebarList",
        "menus",
        "menuList",
        "sections",
        "sectionList",
        "entranceList",
        "entrances",
        "modules",
        "moduleList",
        "services",
        "cells",
        "items",
      ]) {
        cleanSidebarArray(sHolder, sKey);
      }
      // 侧边栏顶部的黑胶 VIP 续费广告横幅或活动推广卡
      if (blockAds || cleanUi) {
        for (const bannerKey of ["topBanner", "bannerInfo", "adBanner", "vipBanner", "activityBanner"]) {
          if (sHolder[bannerKey] !== undefined && sHolder[bannerKey] !== null) {
            delete sHolder[bannerKey];
            changed = true;
          }
        }
      }
    }

    // 5. 搜索热词与默认搜索词
    if (blockAds && Array.isArray(d.trendingList || d.hot)) {
      const key = Array.isArray(d.trendingList) ? "trendingList" : "hot";
      const list = d[key];
      const kept = list.filter(
        (w) => !isObj(w) || (!w.adInfo && !truthy(w.isAd) && w.alg !== "ad" && w.iconType !== 5)
      );
      if (kept.length && kept.length !== list.length) {
        d[key] = kept;
        changed = true;
      }
    }
    if (blockAds && Array.isArray(node.data) && node.data.length && /\/search\/hot/.test(url)) {
      const kept = node.data.filter(
        (w) => !isObj(w) || (!w.adInfo && !truthy(w.isAd) && w.alg !== "ad" && w.iconType !== 5)
      );
      if (kept.length && kept.length !== node.data.length) {
        node.data = kept;
        changed = true;
      }
    }

    // 6. 评论区推广条目与顶部横幅
    for (const cHolder of [node, d]) {
      if (!isObj(cHolder)) continue;
      if (blockAds) {
        for (const k of ["banner", "adInfo", "topAd", "activityInfo"]) {
          if (cHolder[k] !== undefined && cHolder[k] !== null) {
            delete cHolder[k];
            changed = true;
          }
        }
        for (const listKey of ["comments", "hotComments", "topComments"]) {
          if (Array.isArray(cHolder[listKey]) && cHolder[listKey].length) {
            const kept = cHolder[listKey].filter(
              (c) => !isObj(c) || (!truthy(c.isAd) && !c.adInfo && !c.adMark)
            );
            if (kept.length && kept.length !== cHolder[listKey].length) {
              cHolder[listKey] = kept;
              changed = true;
            }
          }
        }
      }
    }
  };

  try {
    // 若是开屏/纯广告接口，直接清空 data / ads
    if (blockAds && /\/(?:e?api\/)?(?:ad|sp\/loading)\b/i.test(url)) {
      for (const k of ["data", "ads", "adInfo", "adList"]) {
        if (Array.isArray(root[k]) && root[k].length) {
          root[k] = [];
          changed = true;
        } else if (nonEmptyObj(root[k])) {
          root[k] = {};
          changed = true;
        }
      }
    }

    cleanNode(root);

    // /batch 接口的顶层键是以 "/api/..." 或 "/eapi/..." 开头的子响应对象
    for (const key of Object.keys(root)) {
      if (key.indexOf("/api/") === 0 || key.indexOf("/eapi/") === 0) {
        if (blockAds && /\/(?:ad|sp\/loading)\b/i.test(key) && isObj(root[key])) {
          for (const k of ["data", "ads", "adInfo", "banners"]) {
            if (Array.isArray(root[key][k]) && root[key][k].length) {
              root[key][k] = [];
              changed = true;
            } else if (nonEmptyObj(root[key][k])) {
              root[key][k] = {};
              changed = true;
            }
          }
        }
        cleanNode(root[key]);
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
  $done({ body: out });
})();
