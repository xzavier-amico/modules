  // ---- 解压 -------------------------------------------------------------

  async function gunzip(b) {
    try {
      if (typeof $utils !== "undefined" && $utils && typeof $utils.ungzip === "function") {
        const r = $utils.ungzip(b);
        return r && typeof r.then === "function" ? await r : r;
      }
      if (typeof ctx !== "undefined" && ctx && ctx.compress && typeof ctx.compress.gunzip === "function") {
        return await ctx.compress.gunzip(b);
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  // ---- 主流程 -----------------------------------------------------------

  async function run() {
    // gRPC 的方法名就在 URL 的 path 上，去掉 scheme / host / query。
    const m = /^[a-z]+:\/\/[^/]+(\/[^?#]*)/i.exec(url);
    const path = m ? m[1] : url.split("?")[0];
    const rule = RULES[path];
    if (!rule) {
      $done({});
      return;
    }

    const headers = res.headers || {};
    const ct = String(headers["content-type"] || headers["Content-Type"] || "").toLowerCase();
    if (ct && ct.indexOf("grpc") < 0) {
      $done({});
      return;
    }
    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") {
      $done({});
      return;
    }

    const bytes = toBytes(res.body);
    if (!bytes || !bytes.length) {
      $done({});
      return;
    }

    const frames = parseFrames(bytes);
    if (!frames) {
      $done({});
      return;
    }

    const out = [];
    let changed = false;
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i];

      // 0x80 是 gRPC-Web 的 trailer 帧，原样保留。
      if (f.flag & 0x80) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      // 只认识 0x00 和 0x01（gzip），别的 flag 一律放行。
      if (f.flag & 0x7e) {
        $done({});
        return;
      }

      let msg = bytes.subarray(f.start, f.end);
      if (f.flag & 0x01) {
        msg = toBytes(await gunzip(msg));
        if (!msg) {
          $done({});
          return;
        }
      }

      const next = rule(msg);
      if (next === null) {
        out.push(bytes.subarray(f.hdr, f.end));
        continue;
      }
      changed = true;
      out.push(frame(0, next));
    }

    if (!changed) {
      $done({});
      return;
    }
    const body = concat(out);
    $done({ body: body });
  }

  run().catch((e) => {
    $done({});
  });
