  //=====================================================================================
  // §4 protobuf 基础
  //
  // 字段切分、varint 与字段编码在 src/proto/wire.js，三端共用。
  // 这里只做 YouTube 需要的路径查找、按字段替换与深度替换；
  // 未建模的字段原样保留，所以改不动的接口最多是不生效，不会把响应写坏。
  //=====================================================================================

  // 返回 [{ no, wire, data, raw }]，data 是字段值，raw 是含 tag 的整段字节。
  const parseFields = wireParseFields;

  // 取第一个（或最后一个）指定 wire-2 字段的值；走流式扫描避免构建完整字段数组。
  function fieldData(bytes, fieldNo, last = false) {
    let foundStart = -1;
    let foundEnd = -1;
    wireForEachField(bytes, (no, wire, dataStart, dataEnd) => {
      if (no === fieldNo && 2 === wire) {
        foundStart = dataStart;
        foundEnd = dataEnd;
        if (!last) return true;
      }
      return false;
    });
    return foundStart >= 0 ? bytes.subarray(foundStart, foundEnd) : undefined;
  }

  // 取第一个指定 wire-0 字段的 varint 数值；找不到返回 undefined。
  function firstVarintField(bytes, fieldNo) {
    let result;
    wireForEachField(bytes, (no, wire, dataStart, dataEnd) => {
      if (no === fieldNo && 0 === wire) {
        result = readVarintValue(bytes.subarray(dataStart, dataEnd));
        return true;
      }
      return false;
    });
    return result;
  }

  // 按字段号逐层往下钻，任意一层缺失就返回 undefined。
  function descendPath(bytes, path) {
    let current = bytes;
    for (const fieldNo of path) {
      current = fieldData(current, fieldNo, true);
      if (!current) return;
    }
    return current;
  }

  // 把值编码成单字段：number -> uint，string -> string，其余按 bytes。
  function encodeScalarField(fieldNo, value) {
    const kind = "number" == typeof value ? "uint" : "string" == typeof value ? "string" : "bytes";
    return encodeField([fieldNo, "", kind], value);
  }

  // 从里往外套：D([1,2,3], v) 等价于 field 1 { field 2 { field 3 = v } }。
  function encodePathValue(path, value) {
    for (let i = path.length - 1; i >= 0; i--) value = encodeScalarField(path[i], value);
    return value;
  }

  function encodeField(spec, value) {
    const [fieldNo, , kind] = spec;
    const wireType = "bool" === kind || "uint" === kind ? 0 : 2;
    const encoded =
      "bytes" === kind
        ? value
        : "string" === kind
          ? textEncoder.encode(value)
          : "bool" === kind
            ? encodeVarint(value ? 1 : 0)
            : "uint" === kind
              ? encodeVarint(value)
              : encodeMessage(kind, value);
    return concatBytes(
      2 === wireType ? [encodeVarint(8 * fieldNo + wireType), encodeVarint(encoded.length), encoded] : [encodeVarint(8 * fieldNo), encoded],
    );
  }

  // 把一组数字编码成 packed repeated 字段（wire type 2）。
  function encodePackedField(spec, values) {
    const [fieldNo, , kind] = spec;
    const payload = concatBytes(values.map((value) => encodeVarint("bool" === kind ? (value ? 1 : 0) : value)));
    return concatBytes([encodeVarint(8 * fieldNo + 2), encodeVarint(payload.length), payload]);
  }

  // 判断某条嵌套路径上的最后一个值是否等于 marker（prefixOnly 时只比前缀）。
  // 默认匹配 ASK_AI_MARKER（PAyouchat），用于识别 Ask AI 的命令/面板路径。
  function matchesPath(bytes, path, marker = ASK_AI_MARKER, prefixOnly = false, depth = 0) {
    if (depth >= path.length) {
      if (prefixOnly) return bytes.length >= marker.length && bytesEqual(bytes.subarray(0, marker.length), marker);
      return bytesEqual(bytes, marker);
    }
    const targetNo = path[depth];
    return wireForEachField(
      bytes,
      (no, wire, dataStart, dataEnd) => no === targetNo && 2 === wire && matchesPath(bytes.subarray(dataStart, dataEnd), path, marker, prefixOnly, depth + 1),
    );
  }

  // 对某个字段的每个出现位置跑一次 rewriter，返回 undefined 表示整条删掉。
  function rewriteRepeatedField(bytes, fieldNo, rewriter) {
    let changed = false;
    const fields = parseFields(bytes);
    const parts = [];
    for (const field of fields) {
      if (field.no !== fieldNo || 2 !== field.wire) {
        parts.push(field.raw);
        continue;
      }
      const next = rewriter(field.data);
      if (next && bytesEqual(next, field.data)) {
        parts.push(field.raw);
      } else {
        changed = true;
        if (next) parts.push(encodeField([fieldNo, "", "bytes"], next));
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }

  // 按路径下钻，对命中位置的字节跑 rewriter。
  function rewritePath(bytes, path, rewriter, depth = 0) {
    if (depth >= path.length) return rewriter(bytes);
    const targetNo = path[depth];
    let changed = false;
    const fields = parseFields(bytes);
    const parts = new Array(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      if (field.no !== targetNo || 2 !== field.wire) {
        parts[i] = field.raw;
        continue;
      }
      const next = rewritePath(field.data, path, rewriter, depth + 1);
      if (bytesEqual(next, field.data)) {
        parts[i] = field.raw;
      } else {
        changed = true;
        parts[i] = encodeField([field.no, "", "bytes"], next);
      }
    }
    return changed ? concatBytes(parts) : bytes;
  }
