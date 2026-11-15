//=======================================================================================
// Xiaohongshu Probe — 只记录，不改写（排障专用，抓完就关）
//
// 用来确认三件在文档里查不到、只能靠真机抓包确认的事：
//
//   1. 首页瀑布流、直播推荐、底栏 tab 分别由哪个接口下发
//   2. 广告卡 / 直播卡在 JSON 里用什么字段标记（is_ads？model_type？）
//   3. 底栏 tab 那个数组叫什么名字、键在哪个层级
//
// 日志一行一条，前缀 [XHS]，三端都输出到客户端的「脚本日志」：
//
//   Q POST /api/sns/v10/homefeed          请求阶段，只记路径，不读 body
//   R /api/sns/v10/homefeed 200 48213B    响应阶段，状态码与长度
//   R keys=success,code,data              顶层字段
//   R data=array[20]                      data 是数组时的长度
//   R [0] keys=id,model_type,note_card model_type=note
//   R count model_type → note:18 live:2   同一字段的取值分布
//   R ★ bottom_tab = [{"name":"购物"...  名字像 tab / 底栏 / 直播 / 广告的字段原样带出来
//
// 每个路径最多记 3 次，翻页不会把日志刷满；存储不可用时只在单次内去重。
//=======================================================================================

(() => {
  "use strict";

  const res = (typeof $response !== "undefined" && $response) || null;
  const req = (typeof $request !== "undefined" && $request) || {};
  const url = (res && res.url) || req.url || "";
  if (!url) {
    $done({});
    return;
  }

  const say = (line) => {
    try {
      console.log("[XHS] " + line);
    } catch (e) {}
  };

  const host = (/^https?:\/\/([^/]+)/.exec(url) || ["", ""])[1];
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0] || "/";

  const store = (typeof $persistentStore !== "undefined" && $persistentStore) || null;
  const SEEN = "xhs.probe.paths";
  const seen = (() => {
    try {
      const parsed = JSON.parse((store && store.read(SEEN)) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (e) {
      return {};
    }
  })();

  const key = host + path;
  const hits = (Number(seen[key]) || 0) + 1;
  if (hits <= 3) {
    try {
      seen[key] = hits;
      const keys = Object.keys(seen);
      if (keys.length > 160) for (const k of keys.slice(0, keys.length - 160)) delete seen[k];
      if (store) store.write(JSON.stringify(seen), SEEN);
    } catch (e) {}
  }
  const quiet = hits > 3;

  // ---------- 请求阶段：只记路径 ----------

  if (!res) {
    if (!quiet) say("Q " + (req.method || "GET") + " " + path);
    $done({});
    return;
  }

  // ---------- 响应阶段：记结构，不改写 ----------

  const status = Number(res.status || res.statusCode || 200);
  const body = res.body;
  const size = typeof body === "string" ? body.length : (body && body.byteLength) || 0;

  let data = null;
  try {
    data = JSON.parse(body);
  } catch (e) {
    data = null;
  }

  if (!data || typeof data !== "object") {
    if (!quiet) say("R " + path + " " + status + " " + size + "B 非 JSON：" + String(body).slice(0, 80).replace(/\s+/g, " "));
    $done({});
    return;
  }

  if (quiet) {
    $done({});
    return;
  }

  const clip = (v, max) => {
    let s;
    try {
      s = typeof v === "string" ? v : JSON.stringify(v);
    } catch (e) {
      s = String(v);
    }
    if (s === undefined) s = "undefined";
    return s.length > max ? s.slice(0, max) + "…" : s;
  };

  const shape = (v) => {
    if (Array.isArray(v)) return "array[" + v.length + "]";
    if (v === null) return "null";
    if (typeof v === "object") return "obj{" + Object.keys(v).slice(0, 12).join(",") + "}";
    return typeof v === "string" ? '"' + clip(v, 40) + '"' : String(v);
  };

  // 单张卡片：键名 + 能区分广告 / 直播的那几个字段。
  const card = (item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return "非对象 " + clip(item, 40);
    const parts = ["keys=" + Object.keys(item).join(",")];
    for (const f of ["model_type", "type", "sub_type", "is_ads", "ads", "id", "track_id", "live_id", "room_id"]) {
      if (item[f] === undefined) continue;
      parts.push(f + "=" + clip(item[f], 24));
    }
    for (const f of ["ads_info", "live_info", "live_card"]) {
      const v = item[f];
      if (!v || typeof v !== "object") continue;
      parts.push(f + "{" + Object.keys(v).slice(0, 10).join(",") + "}");
    }
    const note = item.note_card;
    if (note && typeof note === "object") {
      parts.push("note_card{" + Object.keys(note).slice(0, 10).join(",") + "}" + (note.type ? " type=" + clip(note.type, 20) : ""));
    }
    return parts.join(" ");
  };

  const tally = (list, field) => {
    const map = {};
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const v = item[field];
      if (v === undefined) continue;
      const k = typeof v === "object" ? "obj" : String(v);
      map[k] = (map[k] || 0) + 1;
    }
    return Object.keys(map)
      .map((k) => k + ":" + map[k])
      .join(" ");
  };

  // 名字像底栏 / tab / 直播 / 广告的字段，整段带出来，方便直接看出结构。
  const INTEREST = /(?:^|[._-])(?:tab|tabs|tabbar|nav|bottom|store|shop|live|ad|ads|menu|entry|category)/i;

  say("R " + path + " " + status + " " + size + "B");
  say("R keys=" + Object.keys(data).join(","));

  const payload = data.data !== undefined ? data.data : data;

  if (Array.isArray(payload)) {
    say("R data=array[" + payload.length + "]");
    for (let i = 0; i < Math.min(payload.length, 8); i++) say("R [" + i + "] " + card(payload[i]));
    for (const f of ["model_type", "type", "is_ads", "ads"]) {
      const line = tally(payload, f);
      if (line) say("R count " + f + " → " + line);
    }
  } else if (payload && typeof payload === "object") {
    say("R data={" + Object.keys(payload).join(",") + "}");
    for (const k of Object.keys(payload)) {
      const v = payload[k];
      say("R " + k + " = " + shape(v));
      if (Array.isArray(v)) {
        for (let i = 0; i < Math.min(v.length, 3); i++) {
          if (v[i] && typeof v[i] === "object") say("R " + k + "[" + i + "] " + card(v[i]));
        }
      }
    }
    for (const k of Object.keys(payload)) {
      if (INTEREST.test(k)) say("R ★ " + k + " = " + clip(payload[k], 800));
    }
  }

  $done({});
})();
