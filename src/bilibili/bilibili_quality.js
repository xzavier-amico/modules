// BiliBili Enhance — 画质请求改写（REST + gRPC）。
//
// 客户端请求播放地址时带 qn（清晰度编号），这里按档位参数改写（默认 4K qn=120，
// 补 fourk=1 和 fnval 对应高位）。服务端会按账号权限返回「实际能给的最高档」：
// 大会员给 4K/8K/杜比/HDR，普通账号自动落到 1080P，不会因为要不到高画质就报错。
//
// 两条路径都改：
//   REST  api/app.bilibili.com|biliapi.net 的 */playurl —— 改 query 里的 qn / fourk / fnval
//   gRPC  bilibili.app.playurl.v1.PlayURL/PlayView
//         bilibili.pgc.gateway.player.v2.PlayURL/PlayView
//         bilibili.app.playerunite.v1.Player/PlayViewUnite
//         改请求体里的 qn(3) / fnval(5) / fourk(8)；playerunite 的字段在 vod(1) 里面

  const req = (typeof $request !== "undefined" && $request) || {};
  const url = req.url || "";

  // Loon 传位置数组或对象，Egern / Shadowrocket 传 JSON 字符串或对象。
  let opt = {};
  try {
    const raw = typeof $argument !== "undefined" ? $argument : undefined;
    if (Array.isArray(raw)) opt = { auto_quality: raw[0], web: raw[1] };
    else if (typeof raw === "string") opt = JSON.parse(raw || "{}") || {};
    else if (raw && "object" == typeof raw) opt = raw;
  } catch (e) {
    opt = {};
  }
  const flag = (v, d) =>
    v === undefined || v === null ? d : !(v === false || v === "false" || v === 0 || v === "0");

  const QUALITY_TIERS = {
    "8k": { enabled: true, qn: 127, fnvalMask: 128 | 1024, fourk: 1 },
    dolby: { enabled: true, qn: 126, fnvalMask: 128 | 512, fourk: 1 },
    hdr: { enabled: true, qn: 125, fnvalMask: 128 | 64, fourk: 1 },
    "4k": { enabled: true, qn: 120, fnvalMask: 128, fourk: 1 },
    "1080p60": { enabled: true, qn: 116, fnvalMask: 0, fourk: null },
    "1080p+": { enabled: true, qn: 112, fnvalMask: 0, fourk: null },
    "1080p": { enabled: true, qn: 80, fnvalMask: 0, fourk: null },
  };
  function resolveQualityTier(v) {
    if (v === false || v === "false" || v === 0 || v === "0") return { enabled: false };
    if (v === undefined || v === null || v === "" || v === true || v === "true" || v === 1 || v === "1") {
      return QUALITY_TIERS["4k"];
    }
    const key = String(v).trim().toLowerCase();
    if (key === "off" || key === "false" || key === "0") return { enabled: false };
    return Object.prototype.hasOwnProperty.call(QUALITY_TIERS, key) ? QUALITY_TIERS[key] : QUALITY_TIERS["4k"];
  }

  const tier = resolveQualityTier(opt.auto_quality);
  if (!tier.enabled) {
    $done({});
    return;
  }
  // 网页版播放请求只改 query；关闭网页版支持时直接放行。
  const web = flag(opt.web, true);
  const isWebPlayurl = /\/x\/player\/wbi\/playurl|\/pgc\/player\/web\/playurl|\/x\/web-interface\//i.test(url);
  if (!web && isWebPlayurl) {
    $done({});
    return;
  }

  const QN_VALUES = [0, 6, 16, 32, 64, 74, 80, 112, 116, 120, 125, 126, 127];

  // 把 qn(3) 改成目标清晰度；高画质档顺带补 fnval(5) 与 fourk(8)=1。
  function patchVod(msg) {
    const fields = parseFields(msg, 0, msg.length);
    if (!fields) return null;
    let qn = null;
    let fnval = null;
    let fourk = null;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.wt !== 0) continue;
      const r = readVarint(msg, f.ds, f.de);
      if (!r) continue;
      if (f.no === 3) qn = r[0];
      else if (f.no === 5) fnval = r[0];
      else if (f.no === 8) fourk = r[0];
    }
    if (qn !== null && QN_VALUES.indexOf(qn) < 0) return null;
    if (qn === null && fnval === null && fourk === null) return null;

    const targetQn = tier.qn;
    const needFnval = tier.fnvalMask !== 0 && fnval !== null && (fnval & tier.fnvalMask) !== tier.fnvalMask;
    const needFourk = tier.fourk === 1 && fourk !== 1;
    if (qn === targetQn && !needFnval && !needFourk) return null;

    const parts = [];
    let sawQn = false;
    let sawFourk = false;
    let changed = qn !== targetQn;
    for (let i = 0; i < fields.length; i++) {
      const f = fields[i];
      if (f.no === 3 && f.wt === 0) {
        sawQn = true;
        parts.push(qn === targetQn ? msg.subarray(f.s, f.e) : encodeField(3, 0, encodeVarint(targetQn)));
        continue;
      }
      if (f.no === 5 && f.wt === 0 && needFnval) {
        parts.push(encodeField(5, 0, encodeVarint(fnval | tier.fnvalMask)));
        changed = true;
        continue;
      }
      if (f.no === 8 && f.wt === 0 && tier.fourk === 1) {
        sawFourk = true;
        if (fourk !== 1) {
          parts.push(encodeField(8, 0, encodeVarint(1)));
          changed = true;
          continue;
        }
      }
      parts.push(msg.subarray(f.s, f.e));
    }
    if (!sawQn) {
      parts.push(encodeField(3, 0, encodeVarint(targetQn)));
      changed = true;
    }
    if (tier.fourk === 1 && !sawFourk) {
      parts.push(encodeField(8, 0, encodeVarint(1)));
      changed = true;
    }
    return changed ? concat(parts) : null;
  }

  const GRPC = /\/bilibili\.(?:app\.playurl\.v1\.PlayURL|pgc\.gateway\.player\.v2\.PlayURL|app\.playerunite\.v1\.Player)\/(?:PlayView|PlayViewUnite)$/;

  function patchGrpc() {
    const headers = req.headers || {};
    const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
    if (ct.indexOf("grpc") < 0) return null;
    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") return null;

    const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    if (!GRPC.test(path)) return null;
    const nested = path.indexOf("playerunite") >= 0;

    const bytes = toBytes(req.body);
    if (!bytes || !bytes.length) return null;
    const frames = parseFrames(bytes);
    if (!frames || !frames.length) return null;

    const out = [];
    let changed = false;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];
      // 压缩帧和 trailer 帧一律不动。
      if (f.flag !== 0) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      const msg = bytes.subarray(f.start, f.end);
      const next = nested ? mapSub(msg, 1, patchVod) : patchVod(msg);
      if (!next) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      changed = true;
      out.push(frame(0, next));
    }
    return changed ? concat(out) : null;
  }

  const grpcBody = patchGrpc();
  if (grpcBody) {
    $done({ body: grpcBody });
    return;
  }

  // gRPC 请求没改成（不是目标方法 / 已是最优 / 格式不认识）就原样放行，
  // 不能落到下面的 REST 分支去拼 query。
  const ct = String((req.headers || {})["content-type"] || (req.headers || {})["Content-Type"] || "");
  if (ct.toLowerCase().indexOf("grpc") >= 0) {
    $done({});
    return;
  }

  // ---- REST -------------------------------------------------------------

  if (!/^https?:\/\/(?:api|app|bangumi)\.bili(?:bili\.com|api\.net)\//i.test(url)) {
    $done({});
    return;
  }
  if (url.indexOf("/playurl") < 0) {
    $done({});
    return;
  }

  let out = url.replace(/([?&])qn=\d*/i, "$1qn=" + tier.qn);
  if (!/[?&]qn=/i.test(out)) {
    out += (out.indexOf("?") < 0 ? "?" : "&") + "qn=" + tier.qn;
  }
  if (tier.fourk === 1) {
    if (/[?&]fourk=\d*/i.test(out)) {
      out = out.replace(/([?&])fourk=\d*/i, "$1fourk=1");
    } else {
      out += "&fourk=1";
    }
  }
  // fnval 补对应高画质位，否则服务端不会给 4K/8K/HDR/杜比档。
  if (tier.fnvalMask) {
    const fn = /([?&])fnval=(\d+)/i.exec(out);
    if (fn) {
      const v = Number(fn[2]) | tier.fnvalMask;
      if (String(v) !== fn[2]) out = out.replace(fn[0], fn[1] + "fnval=" + v);
    }
  }

  if (out === url) {
    $done({});
    return;
  }
  $done({ url: out });
