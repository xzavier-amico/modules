  // ------------------------------------------------------------ remote config

  const boolValue = (on) => (on ? serialize([fieldVarint(1, 1)]) : new Uint8Array(0));

  function setValue(value, replacement) {
    const kept = value.filter((f) => f.no < 3 || f.no > 5);
    kept.push(replacement);
    return kept;
  }

  function patchConfiguration(buffer, fields = parse(buffer), assigned = null) {
    if (!fields || !allCanonical(fields)) return null;
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

  // JSON 远程配置。规则语义与 protobuf 一一对应：
  //   0 -> 删掉这条 AssignedValue
  //   1 -> 只改已存在的 boolValue
  //   2 -> 强制 bool（没有就补一条）
  //   其它 -> 改成字符串枚举（enumValue）
  const JSON_CONFIG_SCALARS = ["boolValue", "enumValue", "stringValue", "intValue",
    "longValue", "doubleValue", "floatValue"];

  function jsonAssignedList(data) {
    if (!data || "object" !== typeof data) return null;
    const configuration = data.configuration;
    if (configuration && "object" === typeof configuration && Array.isArray(configuration.assignedValues)) {
      return { owner: configuration, list: configuration.assignedValues };
    }
    if (Array.isArray(data.assignedValues)) return { owner: data, list: data.assignedValues };
    return null;
  }

  function setJsonBool(entry, on) {
    for (const key of JSON_CONFIG_SCALARS) {
      if (key !== "boolValue") delete entry[key];
    }
    entry.boolValue = { value: !!on };
  }

  function setJsonEnum(entry, value) {
    for (const key of JSON_CONFIG_SCALARS) {
      if (key !== "enumValue") delete entry[key];
    }
    entry.enumValue = { value: value };
  }

  function patchConfigurationJson(data) {
    const target = jsonAssignedList(data);
    if (!target) return null;
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
    const present = Object.create(null);
    const scopes = Object.create(null);
    const kept = [];
    let changed = false;
    for (const entry of target.list) {
      const propertyId = entry && "object" === typeof entry ? entry.propertyId : null;
      const scope = propertyId && "string" === typeof propertyId.scope ? propertyId.scope : "";
      const name = propertyId && "string" === typeof propertyId.name ? propertyId.name : "";
      if (!name) {
        kept.push(entry);
        continue;
      }
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
        if (rule[2] === 0) {
          removed = true;
          break;
        }
        if (rule[2] === 1) {
          if (!entry.boolValue) continue;
          setJsonBool(entry, rule[3]);
          touched = true;
        } else if (rule[2] === 2) {
          setJsonBool(entry, rule[3]);
          touched = true;
        } else {
          setJsonEnum(entry, rule[4]);
          touched = true;
        }
      }
      if (removed) {
        changed = true;
        continue;
      }
      present[scope + "\u0000" + name] = true;
      scopes[scope] = true;
      if (touched) changed = true;
      kept.push(entry);
    }
    for (const rule of RULES) {
      if (rule[2] !== 2 || !rule[0] || !rule[1]) continue;
      if (rule[5] === "ad" && !adsOn) continue;
      // JSON 这条只补「响应里本来就有的 scope」，避免把 iOS 那批 scope 的开关
      // 塞进桌面端响应里（客户端不认，纯噪声）。
      if (!scopes[rule[0]]) continue;
      if (present[rule[0] + "\u0000" + rule[1]]) continue;
      kept.push({ propertyId: { scope: rule[0], name: rule[1] }, boolValue: { value: !!rule[3] } });
      changed = true;
    }
    if (!changed) return null;
    target.owner.assignedValues = kept;
    return data;
  }

  function patchConfigurationJsonText(text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    const patched = patchConfigurationJson(data);
    return patched ? JSON.stringify(patched) : null;
  }

  function patchAttributesJsonResponse(text) {
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return null;
    }
    if (!data || "object" !== typeof data) return null;
    const attributes = data.attributes;
    if (!attributes || "object" !== typeof attributes) return null;
    const patched = patchAttributesJson(attributes);
    return patched ? JSON.stringify(data) : null;
  }

  function patchAttributesResponse(buffer) {
    const text = asJsonText(buffer);
    if (text) {
      const out = patchAttributesJsonResponse(text);
      return out ? WIRE_TEXT.encode(out) : null;
    }
    const fields = parse(buffer);
    if (!fields || !allCanonical(fields)) return null;
    if (!looksLikeAttributes(buffer, fields)) return null;
    const patched = patchAttributes(buffer, fields);
    if (!patched || same(patched, buffer)) return null;
    return patched;
  }

  // ------------------------------------------------- JSON 远程配置 / 属性
  //
  // 新版桌面客户端把两个接口都改成了 JSON：
  //   remote-config-resolver/v3/configuration  -> {"configuration":{"assignedValues":[…]}}
  //   nebula/v1/configuration/attributes       -> {"attributes":{…}}
  // 这里按内容嗅探分流：以 { 开头的按 JSON 处理，其余仍走 protobuf，
  // iOS 的响应格式没变，走的还是原来那条路径。

  function asJsonText(buffer) {
    if (!buffer || !buffer.length) return null;
    let i = 0;
    while (i < buffer.length) {
      const b = buffer[i];
      if (b !== 32 && b !== 9 && b !== 10 && b !== 13) break;
      i++;
    }
    if (buffer[i] !== 123) return null;
    try {
      return WIRE_UTF8.decode(buffer);
    } catch (e) {
      return null;
    }
  }

  function patchConfigurationResponse(buffer) {
    const text = asJsonText(buffer);
    if (text) {
      const data = patchConfigurationJsonText(text);
      return data ? WIRE_TEXT.encode(data) : null;
    }
    const fields = parse(buffer);
    if (!fields || !allCanonical(fields)) return null;
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
