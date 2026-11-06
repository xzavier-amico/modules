// Spotify 歌词接口探针 —— 只用来查「客户端到底请求了哪个歌词接口」，不做任何修改。
//
// 背景：没有官方歌词的歌，客户端一条请求都不发，代理层拦不到东西。
// 这个脚本会匹配除 color-lyrics 之外、URL 里带 lyric 的所有 Spotify 请求，
// 命中就发一条通知把路径打出来。确认完就可以把这条规则删掉。

(() => {
  "use strict";

  const req = (typeof $request !== "undefined" && $request) || {};
  const url = req.url || "";

  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { verbose_log: raw[0] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const verbose = !(opt.verbose_log === false || opt.verbose_log === "false" || opt.verbose_log === 0 || opt.verbose_log === "0");

  // 自己发出去的探测请求不报，避免刷屏。
  let selfProbe = false;
  const headers = req.headers || {};
  for (const key in headers) {
    if (Object.prototype.hasOwnProperty.call(headers, key) && key.toLowerCase() === "x-xz-lyrics-probe") selfProbe = true;
  }

  if (verbose && !selfProbe) {
    try {
      if (typeof $notification !== "undefined" && $notification && "function" == typeof $notification.post) {
        $notification.post("Spotify 请求", req.method || "GET", String(url).slice(0, 100));
      }
    } catch (e) {
      // 通知失败不影响主流程
    }
    console.log("spotify-probe: " + url);
  }

  $done({});
})();
