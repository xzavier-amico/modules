  // ------------------------------------------------------------ remote config

  const boolValue = (on) => (on ? serialize([fieldVarint(1, 1)]) : new Uint8Array(0));

  function setValue(value, replacement) {
    const kept = value.filter((f) => f.no < 3 || f.no > 5);
    kept.push(replacement);
    return kept;
  }

  function patchConfiguration(buffer, fields = parse(buffer), assigned = null) {
    if (!fields || !same(serialize(fields), buffer)) return null;
    const out = [];
    const present = Object.create(null);
    // 本次响应的规则索引，只分配引用；保留原始规则顺序（包括通配规则）。
    const byName = new Map();
    const wildcard = [];
    for (let i = 0; i < RULES.length; i++) {
      const rule = RULES[i];
      if ((rule[5] === "ad" && !adsOn) || (rule[5] === "cap" && !playOn)) continue;
      if (!rule[1]) wildcard.push(i);
      else {
        if (!byName.has(rule[1])) byName.set(rule[1], []);
        byName.get(rule[1]).push(i);
      }
    }
    for (const f of fields) {
      let value = null;
      const described = assigned && assigned.get(f);
      if (f.no === 3 && f.w === 2) value = described ? described.value : parse(f.p);
      if (!value || !same(serialize(value), f.p)) {
        out.push(f);
        continue;
      }
      const identifier = first(value, 1);
      const parts = described ? described.parts : identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) {
        out.push(f);
        continue;
      }
      const scope = text(first(parts, 1)) || "";
      const name = text(first(parts, 2)) || "";
      let removed = false;
      let touched = false;
      const named = byName.get(name) || [];
      let ni = 0;
      let wi = 0;
      while (ni < named.length || wi < wildcard.length) {
        const index = wi >= wildcard.length || (ni < named.length && named[ni] < wildcard[wi]) ? named[ni++] : wildcard[wi++];
        const rule = RULES[index];
        if (rule[0] && rule[0] !== scope) continue;
        if (rule[1] && rule[1] !== name) continue;
        touched = true;
        if (rule[2] === 0) {
          removed = true;
          break;
        }
        if (rule[2] === 1) {
          if (first(value, 3)) value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else if (rule[2] === 2) {
          value = setValue(value, fieldBytes(3, boolValue(rule[3])));
        } else {
          value = setValue(value, fieldBytes(5, serialize([fieldString(1, rule[4])])));
        }
      }
      if (removed) continue;
      present[scope + "\u0000" + name] = true;
      if (touched) f.p = serialize(value);
      out.push(f);
    }
    for (const rule of RULES) {
      if (rule[2] !== 2 || !rule[0] || !rule[1]) continue;
      if (rule[5] === "ad" && !adsOn) continue;
      if (present[rule[0] + "\u0000" + rule[1]]) continue;
      const identifier = serialize([fieldString(1, rule[0]), fieldString(2, rule[1])]);
      out.push(fieldBytes(3, serialize([fieldBytes(1, identifier), fieldBytes(3, boolValue(rule[3]))])));
    }
    return serialize(out);
  }

  // 新版 App 会在 bootstrap 之后重新拉取远程配置与账号属性；
  // 这里套用同一套规则 / 属性表，避免覆盖已写入的开关。

  function describeConfiguration(fields) {
    if (!fields || !fields.length) return null;
    const assigned = new Map();
    for (const f of fields) {
      if (f.no !== 3 || f.w !== 2) continue;
      const value = parse(f.p);
      if (!value) return null;
      const identifier = first(value, 1);
      const parts = identifier && identifier.w === 2 ? parse(identifier.p) : null;
      if (!parts) return null;
      const scope = text(first(parts, 1));
      const name = text(first(parts, 2));
      if (!scope || !name) return null;
      assigned.set(f, { value, parts });
    }
    // 保留未知字段，只要求 AssignedValue 列表结构正确。
    return assigned.size ? assigned : null;
  }

  function patchConfigurationResponse(buffer) {
    const fields = parse(buffer);
    if (!fields || !same(serialize(fields), buffer)) return null;
    let target = buffer;
    let wrapper = null;
    let targetFields = fields;
    let assigned = null;
    if (fields.length === 1 && fields[0].no === 1 && fields[0].w === 2) {
      const inner = parse(fields[0].p);
      const description = inner && describeConfiguration(inner);
      if (description && same(serialize(inner), fields[0].p)) {
        wrapper = fields;
        target = fields[0].p;
        targetFields = inner;
        assigned = description;
      }
    }
    assigned = assigned || describeConfiguration(targetFields);
    if (!assigned) return null;
    const patched = patchConfiguration(target, targetFields, assigned);
    if (!patched || same(patched, target)) return null;
    if (wrapper) {
      wrapper[0].p = patched;
      return serialize(wrapper);
    }
    return patched;
  }

  function looksLikeAttributes(buffer, fields = parse(buffer)) {
    if (!fields || !fields.length) return false;
    let entries = 0;
    for (const f of fields) {
      if (f.no !== 1 || f.w !== 2) continue;
      const inner = parse(f.p);
      if (!inner) return false;
      const key = text(first(inner, 1));
      const value = first(inner, 2);
      if (!key || key.length > 64 || !value || value.w !== 2) return false;
      const parts = parse(value.p);
      if (!parts) return false;
      for (const vf of parts) {
        if (vf.no === 2 && vf.w === 0) continue;
        if (vf.no === 3 && vf.w === 0) continue;
        if (vf.no === 4 && vf.w === 2) continue;
        return false;
      }
      entries++;
    }
    // 顶层其它字段原样保留；至少有一条合法属性才按属性表处理。
    return entries > 0;
  }

  function patchAttributesResponse(buffer) {
    const fields = parse(buffer);
    if (!fields || !same(serialize(fields), buffer)) return null;
    if (!looksLikeAttributes(buffer, fields)) return null;
    const patched = patchAttributes(buffer, fields);
    if (!patched || same(patched, buffer)) return null;
    return patched;
  }
