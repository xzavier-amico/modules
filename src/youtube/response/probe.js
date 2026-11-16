  //=====================================================================================
  // §12 排障：把推荐流里卡片的真实结构打到日志
  //
  // 只读不改，默认关闭，靠 probe 参数打开。用来回答「这张卡片在响应里长什么样」：
  //   App（protobuf）：每个列表项打一行——字段号、已建模的键、.eml 版式名、
  //                    以及卡片里出现的可疑内部标识。
  //   网页版（JSON）：每个列表打一行——数组键 → 单键包装链，例如
  //                    richItemContents -> richItemRenderer.content.postRenderer
  // 同一份签名在一次响应里只打一次，避免刷屏。
  //=====================================================================================

  const PROBE_MAX_LINES = 40;
  const PROBE_EML = /[a-z0-9_]{3,}\.eml(?:-js)?(?:-fe)?/g;
  const PROBE_IDENTIFIER = /[a-z][a-z0-9]{1,}(?:_[a-z0-9]+){1,4}/g;

  function probeLog(lines, line) {
    if (lines.size >= PROBE_MAX_LINES || lines.has(line)) return;
    lines.add(line);
    console.log("[YT probe] " + line);
  }

  // App：按列表项打印字段号与标识。
  function probeAppCards(root) {
    const lines = new Set();
    try {
      walkObjects(root, (node) => {
        for (const key of LIST_KEYS) {
          const list = node[key];
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            const state = item && item[WIRE_STATE];
            if (!state || !state.bytes || !state.bytes.length) continue;
            const text = looseUtf8.decode(state.bytes);
            const eml = [...new Set(text.match(PROBE_EML) ?? [])].slice(0, 6);
            const ids = [...new Set(text.match(PROBE_IDENTIFIER) ?? [])].slice(0, 10);
            const fields = (state.fields ?? []).map((field) => field.no).slice(0, 10);
            probeLog(lines, `${key} fields=[${fields.join(",")}] keys=[${Object.keys(item).join(",")}] eml=[${eml.join(",")}] ids=[${ids.join(",")}]`);
          }
        }
      });
    } catch (e) {
      console.log("[YT probe] app cards failed: " + (e && e.message));
    }
  }

  // 网页版：按列表打印「数组键 → 单键包装链」。
  function probeJsonCards(root) {
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
      (function visit(node) {
        if (!node || "object" != typeof node) return;
        if (Array.isArray(node)) {
          for (const item of node) visit(item);
          return;
        }
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (Array.isArray(value) && value.length) {
            const chains = [...new Set(value.filter((item) => item && "object" == typeof item).map((item) => chain(item) || "?"))].slice(0, 6);
            if (chains.length) probeLog(lines, `${key} -> ${chains.join(" | ")}`);
          }
          visit(value);
        }
      })(root);
    } catch (e) {
      console.log("[YT probe] json cards failed: " + (e && e.message));
    }
  }
