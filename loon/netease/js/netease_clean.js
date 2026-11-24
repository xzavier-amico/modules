//=======================================================================================
// NetEase Music Clean — 网易云音乐开屏 / 首页横幅 / 搜索 / 评论广告清理
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


//=======================================================================================
// NetEase Music Clean — 网易云音乐开屏、首页横幅、搜索热词与评论区广告清理
//
// 只改明文 JSON 响应（遇到二进制或 eapi 密文自动原样放行），不碰音频流与歌单正文：
//
//   /(eapi|api)/(ad|sp/loading)/
//     开屏与贴片配置：清空 data / ads / adInfo
//   /(eapi|api)/batch | /homepage/block/page | /v1/discovery/
//     首页发现流与聚合 batch 接口：
//     - 过滤 blocks[] 里 blockCode="HOMEPAGE_BANNER" 内部的商业广告图 (adid / adInfo / adSource)
//     - 过滤 blockCode 为 AD_BANNER / HOMEPAGE_AD_* 的纯广告模块
//     - clean_ui=true 时额外移除直播间 / 语音房 / 播客推广模块 (HOMEPAGE_PODCAST* / *_LIVE* / *_VOICELIST*)
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
  const UI_CLUTTER_BLOCK_RE = /(?:LIVE|VOICE|PODCAST|LOOK|KTV|MALL|GAME|YUNBEI|VIP_GUIDE)/i;

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

  // 处理单个数据节点（支持直接接口响应，也支持 /batch 接口里每个子路径对应的字典值）
  const cleanNode = (node) => {
    if (!isObj(node)) return;

    // 1. 纯广告字段清理
    if (blockAds) {
      for (const k of ["ads", "adInfo", "adList", "loadingAd", "splashAd", "pendantData", "topAd", "floatAd"]) {
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
        // HOMEPAGE_BANNER 内部裝在 extInfo.banners 里
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
        // creatives 数组里的推广卡
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

    // 4. 搜索热词与默认搜索词
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

    // 5. 评论区推广条目与顶部横幅
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

    // /batch 接口的顶层键是以 "/api/..." 开头的子响应对象
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
