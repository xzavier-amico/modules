// Spotify 请求头 / 时区伪装。
//
// 只处理请求阶段：
//   * force_zh_hans：把 Accept-Language 改成简体中文，避免曲名、歌词与元数据
//     按账号或出口地区回繁体；
//   * spoof_timezone：按账号地区选择时区（识别不到时用 Asia/Hong_Kong），
//     避免设备时区与账号地区不一致。
//
// 账号地区由 spotify.js 从 bootstrap / UCS 的账号属性里抄到
// spotify.account.region；两个开关默认开启，在模块参数里单独关闭。
(() => {
  "use strict";

  const req = typeof $request !== "undefined" && $request ? $request : null;
  if (!req || !req.url) {
    $done({});
    return;
  }

  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) {
      // Loon 位置参数：强制简体中文, 伪装时区。
      opt = { force_zh_hans: raw[0], spoof_timezone: raw[1] };
    } else if (typeof raw === "string") {
      opt = JSON.parse(raw || "{}") || {};
    } else if (raw && "object" == typeof raw) {
      opt = raw;
    }
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) => (v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0"));

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

  const forceZhHans = flag(opt.force_zh_hans, true);
  const spoofTimezone = flag(opt.spoof_timezone, true);
  let nextUrl = req.url;
  if (spoofTimezone) {
    const region = accountRegion();
    const timezone = REGION_TIMEZONES[region] || DEFAULT_TIMEZONE;
    nextUrl = String(req.url).replace(/([?&]timezone=)[^&]*/i, "$1" + timezone);
  }

  let headers = null;
  // 拿不到原始请求头时不要返回 headers：客户端会把返回的 headers 当成完整替换，
  // 只带 Accept-Language 会把 Authorization 等头丢掉。
  const source = req.headers && "object" == typeof req.headers ? req.headers : null;
  if (forceZhHans && source) {
    headers = {};
    for (const key in source) {
      if (Object.prototype.hasOwnProperty.call(source, key) && String(key).toLowerCase() !== "accept-language") {
        headers[key] = source[key];
      }
    }
    headers["Accept-Language"] = "zh-CN,zh-Hans;q=0.9,zh;q=0.8";
  }

  if (!headers && nextUrl === req.url) {
    $done({});
    return;
  }
  const out = {};
  if (nextUrl !== req.url) out.url = nextUrl;
  if (headers) out.headers = headers;
  $done(out);
})();

