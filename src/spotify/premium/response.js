  // ---------------------------------------------------------------- response

  function patchUcs(buffer, fields = parse(buffer)) {
    if (!fields || !same(serialize(fields), buffer)) return null;
    const resolve = first(fields, 1);
    let attributes = first(fields, 3);
    // 字段 3 也可能是 ResolveConfiguration 的 AssignedValue，需先确认结构。
    if (attributes && (attributes.w !== 2 ||
        (attributes.p.length && !looksLikeAttributes(attributes.p)))) return null;
    // 没有 resolve 也没有 attributes 时，不按 UCS 处理。
    if (!attributes) {
      const inner = resolve && resolve.w === 2 ? parse(resolve.p) : null;
      const configuration = inner ? first(inner, 1) : null;
      if (!configuration || configuration.w !== 2) return null;
      attributes = fieldBytes(3, new Uint8Array(0));
      fields.push(attributes);
    }
    if (resolve && resolve.w === 2) {
      const edited = edit(resolve.p, [1], patchConfiguration);
      if (edited) resolve.p = edited;
    }
    if (attributes.w === 2) {
      const edited = patchAttributes(attributes.p);
      if (edited) attributes.p = edited;
    }
    return serialize(fields);
  }

  const patchCustomize = (b) => edit(b, [1], patchUcs);
  const patchBootstrap = (b) => edit(b, [2, 1, 1, 1], patchUcs);

  // 桌面端的 BootstrapMessage / UcsResponseWrapper 外层可能和 iOS 不一样。
  // 这里先确认目标确实像 UcsResponse（有 AccountAttributesResponse 的 map entry），
  // 再调用 patchUcs，避免把 ResolveResponse 之类结构误当成 UCS 写坏。
  function looksLikeUcs(buffer, fields = parse(buffer)) {
    if (!fields) return false;
    const attributes = first(fields, 3);
    if (!attributes || attributes.w !== 2) return false;
    const entries = parse(attributes.p);
    if (!entries) return false;
    for (const f of entries) {
      if (f.no !== 1 || f.w !== 2) continue;
      const entry = parse(f.p);
      if (!entry) continue;
      const key = text(first(entry, 1));
      const value = first(entry, 2);
      if (!key || key.length > 64 || !value || value.w !== 2) continue;
      // AccountAttribute 的 value 是 { 2: bool | 3: long | 4: string }。
      // ResolveConfiguration 的 AssignedValue 也是「1: identifier, 2: ...」结构，
      // 但 identifier 的字段 2 是 name 字符串，不是 value message，必须排除。
      const valueFields = parse(value.p);
      if (!valueFields) continue;
      // 空 message 也是合法的 AccountAttribute（bool = false 时就是空）。
      let valid = true;
      for (const vf of valueFields) {
        if (vf.no === 2 && vf.w === 0) continue;
        if (vf.no === 3 && vf.w === 0) continue;
        if (vf.no === 4 && vf.w === 2) continue;
        valid = false;
        break;
      }
      if (valid) return true;
    }
    return false;
  }

  function editUcs(message, path) {
    if (!path.length) return looksLikeUcs(message) ? patchUcs(message) : null;
    const fields = parse(message);
    if (!fields || !same(serialize(fields), message)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = editUcs(f.p, path.slice(1));
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  function patchUcsIfChanged(buffer, fields = parse(buffer)) {
    const out = patchUcs(buffer, fields);
    return out && !same(out, buffer) ? out : null;
  }

  function patchNested(buffer) {
    const fields = parse(buffer);
    if (!fields || !same(serialize(fields), buffer)) return null;
    const walk = (fields, depth) => {
      let changed = false;
      for (const f of fields) {
        if (f.w !== 2) continue;
        const sub = parse(f.p);
        if (!sub || !same(serialize(sub), f.p)) continue;
        if (looksLikeUcs(f.p, sub)) {
          const patched = patchUcsIfChanged(f.p, sub);
          if (patched) {
            f.p = patched;
            changed = true;
            continue;
          }
        }
        if (depth < 8 && walk(sub, depth + 1)) {
          f.p = serialize(sub);
          changed = true;
        }
      }
      return changed;
    };
    return walk(fields, 0) ? serialize(fields) : null;
  }

  function patchCustomizeDesktop(buffer) {
    if (looksLikeUcs(buffer)) {
      const direct = patchUcsIfChanged(buffer);
      if (direct) return direct;
    }
    const known = editUcs(buffer, [1]);
    if (known && !same(known, buffer)) return known;
    return patchNested(buffer);
  }

  function patchBootstrapDesktop(buffer) {
    if (looksLikeUcs(buffer)) {
      const direct = patchUcsIfChanged(buffer);
      if (direct) return direct;
    }
    const known = editUcs(buffer, [2, 1, 1, 1]);
    if (known && !same(known, buffer)) return known;
    return patchNested(buffer);
  }
