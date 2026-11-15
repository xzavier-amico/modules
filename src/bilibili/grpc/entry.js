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

  // ---- gRPC 状态头 ------------------------------------------------------

  function headerValue(headers, name) {
    if (!headers) return undefined;
    const key = name.toLowerCase();
    for (const k in headers) {
      if (k.toLowerCase() === key) return headers[k];
    }
    return undefined;
  }

  // 复制响应头并按客户端类型补齐 / 去掉 grpc-status。
  //
  // B 站手机版 / HD / 海外版走 Moss 引擎（请求头 x-bili-moss-engine-type: 1）时，
  // 只认响应头里的 grpc-status，不读 HTTP/2 trailers；Loon 改写响应体后 trailers
  // 还可能丢失，表现就是详情页 / 评论区一直转圈。蓝版同理。国际版相反，响应头里
  // 不能带 grpc-status: 0。已有非零状态保持原值，避免把服务端错误改成成功。
  function fixHeaders(reqHeaders, resHeaders, h2Trailers) {
    const ua = String(headerValue(reqHeaders, "user-agent") || "");
    const universal =
      ua.indexOf("bili-universal/") >= 0 ||
      ua.indexOf("bili-hd2/") >= 0 ||
      ua.indexOf("bili-overseas/") >= 0;
    const blue = ua.indexOf("bili-blue/") >= 0;
    const inter = ua.indexOf("bili-inter/") >= 0;
    const status = headerValue(resHeaders, "grpc-status");
    // trailers 里已经是错误码时不能补 0，否则客户端会把失败当成功。
    const trailerStatus = headerValue(h2Trailers, "grpc-status");
    const ok = trailerStatus === undefined || String(trailerStatus) === "0";
    let out = null;
    const edit = () => out || (out = Object.assign({}, resHeaders || {}));

    // 手机版 / HD / 海外版对响应头状态是「有就必须正确，没有则回退读 trailers」，
    // 这里统一补 0；国际版去掉 0，非零状态保持原样。
    if ((universal || blue) && status === undefined && ok) {
      edit()["grpc-status"] = "0";
    } else if (inter && String(status) === "0") {
      const headers = edit();
      for (const k in headers) {
        if (k.toLowerCase() === "grpc-status") delete headers[k];
      }
    }
    return out;
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

    const fixed = fixHeaders(req.headers || {}, headers, res.h2_trailers);
    const pass = () => {
      if (fixed) $done({ headers: fixed });
      else $done({});
    };

    const ce = String(headers["content-encoding"] || headers["Content-Encoding"] || "").toLowerCase();
    if (ce && ce !== "identity") {
      pass();
      return;
    }

    const bytes = toBytes(res.body);
    if (!bytes || !bytes.length) {
      pass();
      return;
    }

    const frames = parseFrames(bytes);
    if (!frames) {
      pass();
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
        pass();
        return;
      }

      let msg = bytes.subarray(f.start, f.end);
      if (f.flag & 0x01) {
        msg = toBytes(await gunzip(msg));
        if (!msg) {
          pass();
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
      pass();
      return;
    }
    const body = concat(out);
    const result = { body: body };
    if (fixed) result.headers = fixed;
    // 显式带回 trailers；Loon 不会因为改过 body 就把 grpc-status 丢掉。
    if (res.h2_trailers !== undefined) result.h2_trailers = res.h2_trailers;
    $done(result);
  }

  run().catch((e) => {
    $done({});
  });
