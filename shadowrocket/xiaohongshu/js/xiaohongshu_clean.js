//=======================================================================================
// Xiaohongshu Clean — 首页 / 搜索 / 评论广告清理
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
// Xiaohongshu Clean — 小红书首页 / 搜索 / 评论广告清理
//
// 只改 JSON 响应，按结构删数组元素或字段，不做全量重编码：
//
//   /api/sns/v<n>/homefeed            首页瀑布流：删 data[] 里 is_ads 为 true 的卡片
//   /api/sns/v<n>/search/notes        搜索结果：删 data.items[] 里 ads 为 true 的笔记
//   /api/sns/v<n>/note/comment/list   评论区：删带 is_ads 标记的评论与子评论
//   /api/sns/v<n>/note/widgets        视频播放页商品推广位：清空 data
//   /api/sns/v<n>/note/feed           笔记详情相关推荐：删 is_ads 条目
//   /api/sns/v<n>/system_service/splash_config
//                                     开屏：把 ads_groups 的投放时间推到 2040 年
//   /api/sns/v<n>/system_service/config
//                                     启动配置：删 splash / loading_img / app_theme 等推广字段
//
// 界面精简（clean_ui，默认关闭）：
//   /api/sns/v<n>/homefeed/categories 删「购物」「市集」「直播」三个 tab
//   /api/sns/v<n>/system_service/config 额外删 store（商城入口）
//
// 结构对不上、解析失败、响应过大、处理中抛异常都原样放行。
// 一页被删空时保留原样，客户端不会把它当成「没有内容」。
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

  const status = Number((res && (res.status || res.statusCode)) || 200);
  const body = res.body;
  if (status >= 300 || typeof body !== "string" || !body || body.length > 8388608) {
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
  if (!isObj(data)) {
    $done({});
    return;
  }

  const path = url.split("?")[0];
  const payload = data.data;

  // ---------- 广告判定 ----------

  // 首页卡片：is_ads 是主标记；ads / ads_info 是不同版本的备选写法。
  const feedAd = (x) =>
    x.is_ads === true || x.ads === true || (isObj(x.ads_info) && Object.keys(x.ads_info).length > 0);

  // 搜索结果：ads 是主标记。
  const noteAd = (x) =>
    x.ads === true || x.is_ads === true || (isObj(x.ads_info) && Object.keys(x.ads_info).length > 0);

  // 评论广告：show_tags 里带 is_ads 是常见写法，另外兼容布尔标记。
  const commentAd = (c) => {
    if (c.is_ads === true || c.ads === true) return true;
    if (isObj(c.ads_info) && Object.keys(c.ads_info).length > 0) return true;
    if (Array.isArray(c.show_tags) && c.show_tags.indexOf("is_ads") >= 0) return true;
    return c.comment_type === "ads";
  };

  // 过滤数组；没删掉东西、或者会整页删空时都返回 null，调用方保持原样。
  const filterList = (list, isAd) => {
    if (!Array.isArray(list) || !list.length) return null;
    const kept = list.filter((x) => !isObj(x) || !isAd(x));
    if (kept.length === list.length) return null;
    return kept.length ? kept : null;
  };

  let changed = false;

  try {
    if (/\/api\/sns\/v\d+\/homefeed$/.test(path)) {
      if (blockAds && Array.isArray(payload)) {
        const kept = filterList(payload, feedAd);
        if (kept) {
          data.data = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/homefeed\/categories$/.test(path)) {
      if (cleanUi && isObj(payload) && Array.isArray(payload.categories)) {
        const drop = ["homefeed.shop", "homefeed.sketch", "homefeed.live"];
        const kept = payload.categories.filter((c) => !isObj(c) || drop.indexOf(c.oid) < 0);
        if (kept.length && kept.length !== payload.categories.length) {
          payload.categories = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/search\/notes$/.test(path)) {
      if (blockAds && isObj(payload)) {
        const list = Array.isArray(payload.items)
          ? payload.items
          : Array.isArray(payload.data)
            ? payload.data
            : null;
        const kept = filterList(list, noteAd);
        if (kept) {
          if (list === payload.items) payload.items = kept;
          else payload.data = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/note\/comment\/list$/.test(path)) {
      if (blockAds && isObj(payload) && Array.isArray(payload.comments)) {
        let hit = false;
        const kept = payload.comments.filter((c) => {
          if (!isObj(c)) return true;
          if (commentAd(c)) {
            hit = true;
            return false;
          }
          if (Array.isArray(c.sub_comments)) {
            const subs = c.sub_comments.filter((s) => !isObj(s) || !commentAd(s));
            if (subs.length !== c.sub_comments.length) {
              hit = true;
              c.sub_comments = subs;
            }
          }
          return true;
        });
        if (hit && kept.length) {
          payload.comments = kept;
          changed = true;
        }
      }
    } else if (/\/api\/sns\/v\d+\/note\/widgets$/.test(path)) {
      if (blockAds && isObj(payload) && Object.keys(payload).length) {
        data.data = {};
        changed = true;
      }
    } else if (/\/api\/sns\/v\d+\/note\/(?:feed|tabfeed|videofeed|imagefeed|redtube)$/.test(path)) {
      if (blockAds) {
        if (Array.isArray(payload)) {
          const kept = filterList(payload, feedAd);
          if (kept) {
            data.data = kept;
            changed = true;
          }
        } else if (isObj(payload)) {
          const list = Array.isArray(payload.items)
            ? payload.items
            : Array.isArray(payload.data)
              ? payload.data
              : null;
          const kept = filterList(list, feedAd);
          if (kept) {
            if (list === payload.items) payload.items = kept;
            else payload.data = kept;
            changed = true;
          }
        }
      }
    } else if (/\/api\/sns\/v\d+\/system_service\/splash_config$/.test(path)) {
      if (blockAds && isObj(payload) && Array.isArray(payload.ads_groups)) {
        // 把投放窗口推到 2040 年，开屏素材永远不到期展示。
        const START = "2208963661";
        const END = "2209050061";
        for (const group of payload.ads_groups) {
          if (!isObj(group)) continue;
          group.start_time = START;
          group.end_time = END;
          if (Array.isArray(group.ads)) {
            for (const ad of group.ads) {
              if (!isObj(ad)) continue;
              ad.start_time = START;
              ad.end_time = END;
            }
          }
        }
        changed = true;
      }
    } else if (/\/api\/sns\/v\d+\/system_service\/config$/.test(path)) {
      if (isObj(payload)) {
        const drop = blockAds
          ? ["splash", "loading_img", "app_theme", "cmt_words", "highlight_tab", "watermark_pic_path"]
          : [];
        if (cleanUi) drop.push("store");
        for (const key of drop) {
          if (payload[key] !== undefined && payload[key] !== null) {
            delete payload[key];
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
  $done({ body: JSON.stringify(data) });
})();
