  //=====================================================================================
  // §7 惰性解码与重编码
  //
  // 解码时不复制整棵消息树：只把字段列表挂在对象上，子消息等真正被读到才展开。
  // 改写时在对象上记 changed，重编码只重写变过的字段，其余字节原样拼回去。
  //=====================================================================================

  const WIRE_STATE = Symbol("wireState");
  const NO_FIELDS = [];

  function markChanged(state, fieldName) {
    for (; state; ) {
      (state.changed ??= new Set()).add(fieldName);
      fieldName = state.parentName;
      state = state.parent;
    }
  }

  function setField(obj, key, value) {
    const previous = obj[key];
    const unchanged =
      Array.isArray(previous) && Array.isArray(value)
        ? previous.length === value.length && previous.every((item, i) => item === value[i])
        : previous === value;
    if (unchanged) return false;
    obj[key] = value;
    if (obj[WIRE_STATE]) markChanged(obj[WIRE_STATE], key);
    return true;
  }

  function deleteField(obj, key) {
    if (void 0 === obj[key]) return false;
    delete obj[key];
    if (obj[WIRE_STATE]) markChanged(obj[WIRE_STATE], key);
    return true;
  }

  // 按 schema 把字节解成对象。depth 超过 64 层视为异常响应。
  // eager 决定哪些子类型立即展开，其余挂 getter 等第一次读取。
  function decodeMessage(typeName, bytes, depth = 0, parentState, parentName, eager = EAGER_TYPES.youtubei) {
    if (depth > 64) throw new Error("Protobuf nesting limit");

    const obj = {};
    const fields = parseFields(bytes);
    const state = { bytes, fields, parent: parentState, parentName, eager };
    const specs = SCHEMA[typeName];
    const specsByNo = (SPEC_CACHE[typeName] ??= new Map(specs.map((spec) => [spec[0], spec])));
    if (!SPEC_NAME_CACHE[typeName]) SPEC_NAME_CACHE[typeName] = new Map(specs.map((spec) => [spec[1], spec]));

    Object.defineProperty(obj, WIRE_STATE, { value: state });
    for (const [, name, , repeated] of specs) if (repeated) obj[name] = [];

    // 绑定 spec 并记录重复出现的非 repeated 字段（标量按最后一次生效，子消息按 protobuf 规范合并）。
    let seenSingular = null;
    let duplicateSingular = null;
    for (const field of fields) {
      const spec = specsByNo.get(field.no);
      if (spec && (field.wire === wireTypeOf(spec[2]) || isPackedNumeric(spec, field))) {
        field.spec = spec;
        if (!spec[3]) {
          const name = spec[1];
          if (seenSingular && seenSingular.has(name)) (duplicateSingular ??= new Set()).add(name);
          else (seenSingular ??= new Set()).add(name);
        }
      }
    }

    let deferredNames;
    let mergedHandled;
    for (const field of fields) {
      const spec = field.spec;
      if (!spec) continue;

      const [, name, valueType, repeated] = spec;
      if (isPackedNumeric(spec, field)) {
        let values;
        try {
          values = decodePackedVarints(field.data);
        } catch (e) {
          // 不是合法 packed 数据时按未知字段原样保留，避免整条响应改写失败。
          delete field.spec;
          continue;
        }
        for (const value of values) obj[name].push("bool" === valueType ? 0 !== value : value);
        continue;
      }

      // 重复出现的非 repeated 子消息：合并所有分片字节后统一解码。
      if (!repeated && duplicateSingular?.has(name) && SCHEMA[valueType]) {
        if (mergedHandled?.has(name)) continue;
        (mergedHandled ??= new Set()).add(name);
        const chunks = [];
        for (const item of fields) if (item.spec?.[1] === name) chunks.push(item.data);
        const mergedBytes = concatBytes(chunks);
        if (!eager.has(valueType)) {
          state.type = typeName;
          state.deferred = true;
          Object.defineProperty(obj, name, {
            enumerable: true,
            configurable: true,
            get() {
              const value = decodeMessage(valueType, mergedBytes, depth + 1, state, name, eager);
              Object.defineProperty(obj, name, { value, enumerable: true, writable: true, configurable: true });
              return value;
            },
          });
        } else {
          obj[name] = decodeMessage(valueType, mergedBytes, depth + 1, state, name, eager);
        }
        continue;
      }

      if (SCHEMA[valueType] && !eager.has(valueType)) {
        // 同一名字段只挂一个 getter，第一次读时才真正展开。
        if (deferredNames?.has(name)) continue;
        (deferredNames ??= new Set()).add(name);
        const group = repeated ? fields.filter((item) => item.spec?.[1] === name) : null;
        state.type = typeName;
        state.deferred = true;
        Object.defineProperty(obj, name, {
          enumerable: true,
          configurable: true,
          get() {
            const value = repeated ? group.map((item) => readFieldValue(item, depth, state, eager)) : readFieldValue(field, depth, state, eager);
            Object.defineProperty(obj, name, { value, enumerable: true, writable: true, configurable: true });
            return value;
          },
        });
      } else {
        const value = readFieldValue(field, depth, state, eager);
        if (repeated) obj[name].push(value);
        else obj[name] = value;
      }
    }
    return obj;
  }

  function wireTypeOf(valueType) {
    return "bool" === valueType || "uint" === valueType ? 0 : 2;
  }

  // proto3 的 repeated 数字字段默认 packed（wire type 2），解码时要当成一串 varint。
  function isPackedNumeric(spec, field) {
    return !!spec[3] && 2 === field.wire && ("uint" === spec[2] || "bool" === spec[2]);
  }

  function readFieldValue(field, depth, state, eager) {
    const [, name, valueType] = field.spec;
    if ("bytes" === valueType) return field.data;
    if ("string" === valueType) return looseUtf8.decode(field.data);
    if ("bool" === valueType) return 0 !== readVarintValue(field.data);
    if ("uint" === valueType) return readVarintValue(field.data);
    return decodeMessage(valueType, field.data, depth + 1, state, name, eager);
  }

  // 按 schema 把对象写回字节。没有改动时直接返回原始字节。
  function encodeMessage(typeName, obj) {
    const state = obj[WIRE_STATE];
    if (state && !state.changed) return state.bytes;

    const parts = [];
    const repeatedPool = new Map();
    const written = new Set();
    const numericWritten = new Set();
    const rawOf = (value, valueType) => (SCHEMA[valueType] ? (value[WIRE_STATE]?.bytes ?? value) : value);
    const valuesOf = (spec) => {
      const [, name, , repeated] = spec;
      return repeated ? (obj[name] ?? []) : void 0 === obj[name] ? [] : [obj[name]];
    };

    // 数组字段：按原始字节/字符串值建立 FIFO 队列索引，避免重复项被 Map 去重或 string/Uint8Array 错配。
    // 数字数组单独处理（可能 packed），不放进这个索引。
    for (const spec of SCHEMA[typeName]) {
      const [, name, valueType, repeated] = spec;
      if (repeated && state?.changed?.has(name) && "uint" !== valueType && "bool" !== valueType) {
        const pool = new Map();
        for (const value of valuesOf(spec)) {
          const key = rawOf(value, valueType);
          let queue = pool.get(key);
          if (!queue) {
            queue = [];
            pool.set(key, queue);
          }
          queue.push(value);
        }
        repeatedPool.set(name, pool);
      }
    }

    for (const field of state?.fields ?? []) {
      if (!field.spec || !state.changed.has(field.spec[1])) {
        parts.push(field.raw);
        continue;
      }
      const [, name, valueType, repeated] = field.spec;

      // repeated 数字字段可能是 packed 或 unpacked：整体按原形式重写一次；空数组不写空 tag。
      if (repeated && ("uint" === valueType || "bool" === valueType)) {
        written.add(name);
        if (!numericWritten.has(name)) {
          const values = obj[name] ?? [];
          if (values.length) {
            if (2 === field.wire) parts.push(encodePackedField(field.spec, values));
            else for (const value of values) parts.push(encodeField(field.spec, value));
          }
          numericWritten.add(name);
        }
        continue;
      }

      if (repeated) {
        written.add(name);
        const pool = repeatedPool.get(name);
        const lookupKey = "string" === valueType ? looseUtf8.decode(field.data) : field.data;
        const queue = pool.get(lookupKey);
        if (!queue?.length) continue;
        const value = queue.shift();
        if (!queue.length) pool.delete(lookupKey);
        parts.push(SCHEMA[valueType] && value[WIRE_STATE]?.changed ? encodeField(field.spec, value) : field.raw);
      } else {
        // 原消息里出现多次的 singular 字段只写出一次，避免合并/覆盖后写出重复字段。
        if (written.has(name)) continue;
        written.add(name);
        const value = obj[name];
        if (void 0 === value) continue;
        const needsWrite = rawOf(value, valueType) !== field.data || (SCHEMA[valueType] && value[WIRE_STATE]?.changed);
        parts.push(needsWrite ? encodeField(field.spec, value) : field.raw);
      }
    }

    // 新增的字段（原消息里没有、代码里刚塞进去的）统一补在后面。
    for (const spec of SCHEMA[typeName]) {
      const [, name, , repeated] = spec;
      if (state && !state.changed.has(name)) continue;
      if (repeated && repeatedPool.has(name)) {
        for (const queue of repeatedPool.get(name).values()) {
          for (const value of queue) parts.push(encodeField(spec, value));
        }
      } else if (!written.has(name)) {
        for (const value of valuesOf(spec)) parts.push(encodeField(spec, value));
      }
    }

    const encoded = concatBytes(parts);
    return state && bytesEqual(encoded, state.bytes) ? state.bytes : encoded;
  }

  // 未被 schema 建模的字段（保持原始顺序，用于局部改写）。
  function unknownFields(obj) {
    const state = obj[WIRE_STATE];
    if (!state) return NO_FIELDS;
    if (state.unknown) return state.unknown;
    if (!state.fields.length || (1 === state.fields.length && state.fields[0].spec)) return NO_FIELDS;

    let unknown;
    for (const field of state.fields) if (!field.spec) (unknown ??= []).push(field);
    return (state.unknown = unknown ?? NO_FIELDS);
  }

  // 对未建模的字段跑 rewriter，返回 undefined 表示删掉。
  function rewriteUnknownField(obj, fieldNo, rewriter) {
    let updates;
    for (const field of unknownFields(obj)) {
      if (field.no !== fieldNo || 2 !== field.wire) continue;
      const next = rewriter(field.data);
      if (next && bytesEqual(next, field.data)) continue;
      (updates ??= []).push({ field, data: next });
    }
    if (!updates) return false;

    const state = obj[WIRE_STATE];
    for (const { field, data } of updates) {
      if (data) {
        field.data = data;
        field.raw = encodeField([fieldNo, "", "bytes"], data);
      } else {
        state.fields.splice(state.fields.indexOf(field), 1);
      }
    }
    state.unknown = void 0;
    markChanged(state, "");
    return true;
  }

  const SPEC_CACHE = Object.create(null);
  const SPEC_NAME_CACHE = Object.create(null);

  function messageCodec(typeName, eager = EAGER_TYPES.youtubei) {
    return { fromBinary: (bytes) => decodeMessage(typeName, bytes, 0, undefined, undefined, eager), toBinary: (obj) => encodeMessage(typeName, obj) };
  }

  // 深度优先遍历所有对象节点（不看数组内部之外的原始字节）。
  function walkObjects(root, visit) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node || "object" != typeof node || ArrayBuffer.isView(node)) continue;
      visit(node);
      for (const value of Object.values(node)) stack.push(value);
    }
  }

  //=====================================================================================
