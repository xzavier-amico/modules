//=======================================================================================
// Spotify Enhance — 请求头 / 时区
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


// Spotify 请求头 / 时区伪装。
//
// 只处理请求阶段：按账号地区改写 URL 里的 timezone（识别不到时用
// Asia/Hong_Kong），避免设备时区与账号地区不一致。
//
// 不改 Accept-Language：Spotify 的歌词语言由账号 / 客户端配置决定，
// 改请求头只会影响接口的本地化文案，改不了歌词文本本身。
//
// 账号地区由 spotify.js 从 bootstrap / UCS 的账号属性里抄到
// spotify.account.region。
(() => {
  "use strict";

  const req = typeof $request !== "undefined" && $request ? $request : null;
  if (!req || !req.url || !/[?&]timezone=/i.test(req.url)) {
    $done({});
    return;
  }

  const REGION_KEY = "spotify.account.region";
  const DEFAULT_TIMEZONE = "Asia/Hong_Kong";
  // 账号地区 -> 代表时区。一个国家可能有多个时区，这里取最常用的一个；
  // 识别不到地区时退回 Asia/Hong_Kong。
  const REGION_TIMEZONES = {
    HK: "Asia/Hong_Kong", MO: "Asia/Macau", TW: "Asia/Taipei", CN: "Asia/Shanghai",
    SG: "Asia/Singapore", MY: "Asia/Kuala_Lumpur", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh",
    ID: "Asia/Jakarta", PH: "Asia/Manila", JP: "Asia/Tokyo", KR: "Asia/Seoul",
    IN: "Asia/Kolkata", AE: "Asia/Dubai", SA: "Asia/Riyadh", IL: "Asia/Jerusalem",
    TR: "Europe/Istanbul", RU: "Europe/Moscow", AU: "Australia/Sydney", NZ: "Pacific/Auckland",
    US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City",
    BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires",
    GB: "Europe/London", IE: "Europe/Dublin", FR: "Europe/Paris", DE: "Europe/Berlin",
    IT: "Europe/Rome", ES: "Europe/Madrid", PT: "Europe/Lisbon", NL: "Europe/Amsterdam",
    BE: "Europe/Brussels", CH: "Europe/Zurich", AT: "Europe/Vienna", SE: "Europe/Stockholm",
    NO: "Europe/Oslo", DK: "Europe/Copenhagen", FI: "Europe/Helsinki", PL: "Europe/Warsaw",
    CZ: "Europe/Prague", ZA: "Africa/Johannesburg", EG: "Africa/Cairo",
  };

  const accountRegion = () => {
    try {
      const store = typeof $persistentStore !== "undefined" && $persistentStore ? $persistentStore : null;
      const saved = store && String(store.read(REGION_KEY) || "").trim().toUpperCase();
      if (saved && /^[A-Z]{2}$/.test(saved)) return saved;
    } catch (e) {
      // 存储读取失败时继续看请求参数。
    }
    // 部分接口带 market=XX；from_token 只有两个字母时也不会命中这个正则。
    const market = /[?&]market=([A-Za-z]{2})(?:&|$)/.exec(String(req.url));
    return market ? market[1].toUpperCase() : "";
  };

  const region = accountRegion();
  const timezone = REGION_TIMEZONES[region] || DEFAULT_TIMEZONE;
  const nextUrl = String(req.url).replace(/([?&]timezone=)[^&]*/i, "$1" + timezone);
  if (nextUrl === req.url) {
    $done({});
    return;
  }
  $done({ url: nextUrl });
})();
