// BiliBili Clean — 画质请求改写（Loon / Egern）。
//
// 客户端请求播放地址时带 qn（清晰度编号），这里统一改成 120（4K），并补上
// fourk=1。服务端会按账号权限返回「实际能给的最高档」：大会员给 4K，普通账号
// 自动落到 1080P，不会因为要不到 4K 就报错。
//
// 只改 api.bilibili.com / app.bilibili.com 的 playurl 请求，其余请求原样放行。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const url = req.url || "";

  let opt = {};
  try {
    opt = typeof $argument === "string" ? JSON.parse($argument || "{}") : $argument || {};
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const verbose = flag(opt.verbose_log, false);
  const log = (msg) => {
    if (verbose) console.log("bilibili: " + msg);
  };

  if (!flag(opt.auto_quality, true)) {
    $done({});
    return;
  }
  if (!/^https?:\/\/(?:api|app)\.bilibili\.com\//i.test(url)) {
    $done({});
    return;
  }
  if (url.indexOf("/playurl") < 0) {
    $done({});
    return;
  }

  let out = url.replace(/([?&])qn=\d+/i, "$1qn=120");
  if (!/[?&]qn=/i.test(out)) {
    out += (out.indexOf("?") < 0 ? "?" : "&") + "qn=120";
  }
  if (!/[?&]fourk=/i.test(out)) {
    out += "&fourk=1";
  }

  if (out === url) {
    $done({});
    return;
  }
  log("qn -> 120");
  $done({ url: out });
})();
