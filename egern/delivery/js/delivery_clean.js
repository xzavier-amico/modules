// Delivery Clean — 保守地删掉 JSON 数组里「明确标了广告」的条目。
//
// 只认三种标记，其余一律不动：
//   is_ad / isAd 为 true
//   ad_type / adType 有值，并且同时带 ad_id / adId
//   card_type / cardType 以 ad_ / ad- 开头
//
// 只删数组元素，不删对象字段；解析失败、结构对不上、没有命中，都原样放行。
// JSON 往返会截断超过 2^53 的数字，body 里出现 18 位以上连续数字时直接放弃改写。

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || {};
  const body = res.body;
  if (typeof body !== "string" || !body) {
    $done({});
    return;
  }

  // 只处理 JSON 对象/数组；HTML、gzip、protobuf 之类直接放行。
  const first = body.charCodeAt(0);
  if (first !== 123 && first !== 91) {
    $done({});
    return;
  }

  // 超过 2^53 的数字在 JSON 往返时会丢精度（16 位起），这类响应直接放行。
  if (/\d{16,}/.test(body)) {
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
  if (!data || "object" != typeof data) {
    $done({});
    return;
  }

  const isObj = (v) => v && "object" == typeof v && !Array.isArray(v);
  const truthy = (v) => v === true || v === 1 || v === "1";

  const isAdItem = (o) => {
    if (!isObj(o)) return false;
    if (truthy(o.is_ad) || truthy(o.isAd)) return true;

    const card = o.card_type !== undefined ? o.card_type : o.cardType;
    if ("string" == typeof card && /^ad[_-]/i.test(card)) return true;

    const type = o.ad_type !== undefined ? o.ad_type : o.adType;
    const id = o.ad_id !== undefined ? o.ad_id : o.adId;
    if (
      type !== undefined && type !== null && type !== "" && type !== 0 &&
      id !== undefined && id !== null && id !== ""
    ) {
      return true;
    }
    return false;
  };

  let removed = 0;
  const walk = (node, depth) => {
    if (depth > 5 || !node || "object" != typeof node) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i -= 1) {
        if (isAdItem(node[i])) {
          node.splice(i, 1);
          removed += 1;
        } else {
          walk(node[i], depth + 1);
        }
      }
      return;
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      const value = node[key];
      if (value && "object" == typeof value) walk(value, depth + 1);
    }
  };

  walk(data, 0);
  if (!removed) {
    $done({});
    return;
  }

  $done({ body: JSON.stringify(data) });
})();
