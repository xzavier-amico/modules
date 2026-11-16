  //=====================================================================================
  // §12 排障：把推荐流里卡片的真实结构打到日志
  //
  // 只读不改，默认关闭，靠 probe 参数打开（off / on / full）。用来回答
  // 「这张卡片在响应里到底长什么样」，好按真实字段号而不是猜的名字写规则：
  //   App（protobuf）：每个列表项一行——序号、字节数、字段号、已建模的键、
  //                    有没有视频 id、.eml 版式名、卡内出现的内部标识。
  //   full：额外打前 120 字节的 hex，可以直接按 protobuf 解出字段号。
  //   网页版（JSON）：每个列表一行——数组键 → 单键包装链。
  // 同一份签名在一次响应里只打一次，最多 40 行。
  //=====================================================================================

  const PROBE_MAX_LINES = 40;
  const PROBE_EML = /[a-z0-9_]{3,}\.eml(?:-js)?(?:-fe)?/g;
  const PROBE_IDENTIFIER = /[a-z][a-z0-9]{1,}(?:_[a-z0-9]+){1,4}/g;
  const PROBE_VIDEO_ID = /\/vi\/[A-Za-z0-9_-]{11}\//;

  function probeLog(lines, line) {
    if (lines.size >= PROBE_MAX_LINES || lines.has(line)) return;
    lines.add(line);
    console.log("[YT probe] " + line);
  }

  function probeHex(bytes, limit = 120) {
    const slice = bytes.subarray(0, Math.min(bytes.length, limit));
    let out = "";
    for (const byte of slice) out += (byte < 16 ? "0" : "") + byte.toString(16);
    return out;
  }

  // App：按列表项打印字段号与标识。
  function probeAppCards(root, options) {
    const lines = new Set();
    try {
      probeLog(lines, "platform=app route=protobuf");
      walkObjects(root, (node) => {
        for (const key of LIST_KEYS) {
          const list = node[key];
          if (!Array.isArray(list)) continue;
          for (let index = 0; index < list.length; index++) {
            const item = list[index];
            const state = item && item[WIRE_STATE];
            if (!state || !state.bytes || !state.bytes.length) continue;
            const bytes = state.bytes;
            const decoded = looseUtf8.decode(bytes);
            const eml = [...new Set(decoded.match(PROBE_EML) ?? [])].slice(0, 6);
            const ids = [...new Set(decoded.match(PROBE_IDENTIFIER) ?? [])].slice(0, 10);
            const fields = (state.fields ?? []).map((field) => field.no).slice(0, 10);
            let line = `${key}#${index} bytes=${bytes.length} videoId=${PROBE_VIDEO_ID.test(decoded) ? "yes" : "no"} fields=[${fields.join(",")}] keys=[${Object.keys(item).join(",")}] eml=[${eml.join(",")}] ids=[${ids.join(",")}]`;
            if (options.probeFull) line += ` hex=${probeHex(bytes)}`;
            probeLog(lines, line);
          }
        }
      });
    } catch (e) {
      console.log("[YT probe] app cards failed: " + (e && e.message));
    }
  }

  // 网页版：按列表打印「数组键 → 单键包装链」。
  function probeJsonCards(root, options) {
    const lines = new Set();
    const chain = (node) => {
      const keys = [];
      let current = node;
      for (let depth = 0; depth < 5 && current && "object" == typeof current && !Array.isArray(current); depth++) {
        const names = Object.keys(current);
        if (1 !== names.length) break;
        keys.push(names[0]);
        current = current[names[0]];
      }
      return keys.join(".");
    };

    try {
      probeLog(lines, "platform=web route=json");
      (function visit(node) {
        if (!node || "object" != typeof node) return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (Array.isArray(value) && value.length) {
            const signatures = [...new Set(value.filter((item) => item && "object" == typeof item).map((item) => chain(item) || "?"))].slice(0, 6);
            let line = `${key} -> ${signatures.join(" | ")}`;
            if (options.probeFull) line += ` sample=${JSON.stringify(value[0]).slice(0, 400)}`;
            if (signatures.length) probeLog(lines, line);
          }
          visit(value);
        }
      })(root);
    } catch (e) {
      console.log("[YT probe] json cards failed: " + (e && e.message));
    }
  }
