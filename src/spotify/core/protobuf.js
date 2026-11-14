  // ---------------------------------------------------------------- protobuf
  //
  // 底层 varint / 字段切分 / 字段编码在 src/proto/wire.js，三端共用。
  // 这里只保留 Spotify 需要的消息级封装：parse 失败返回 null，
  // edit 在重编码前后做一次字节比对，防止把不认识的响应写坏。

  const TE = WIRE_TEXT;
  const TD = WIRE_UTF8;
  const readVarint = wireReadVarint;

  // 字节不是合法消息时返回 null。
  function parse(b) {
    let fields;
    try {
      fields = wireParseFields(b);
    } catch (e) {
      return null;
    }
    return fields.map((f) =>
      f.wire === 0
        ? { no: f.no, w: 0, v: wireReadVarint(f.data, { i: 0 }), raw: f.raw }
        : { no: f.no, w: f.wire, p: f.data, raw: f.raw },
    );
  }

  function serialize(fields) {
    return wireConcat(fields.map((f) => wireEncodeField(f.no, f.w, f.w === 0 ? wireEncodeVarint(f.v) : f.p)));
  }

  // 判断整条消息是否本来就是规范编码。等价于 same(serialize(parse(buffer)), buffer)，
  // 但只比较每个字段的 tag / 长度，不复制大 payload，避免 12MB 响应白拷贝一遍。
  function samePrefix(bytes, prefix) {
    if (bytes.length !== prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  function allCanonical(fields) {
    for (const f of fields) {
      if (!f.raw) return false;
      const tag = wireEncodeVarint(BigInt(f.no) * 8n + BigInt(f.w));
      if (f.raw.length < tag.length || !samePrefix(f.raw.subarray(0, tag.length), tag)) return false;
      if (f.w === 0) {
        const value = wireEncodeVarint(f.v);
        if (!samePrefix(f.raw.subarray(tag.length), value)) return false;
      } else if (f.w === 2) {
        const length = wireEncodeVarint(f.p.length);
        if (f.raw.length !== tag.length + length.length + f.p.length) return false;
        if (!samePrefix(f.raw.subarray(tag.length, tag.length + length.length), length)) return false;
      } else if (f.raw.length !== tag.length + (f.w === 1 ? 8 : 4)) {
        return false;
      }
    }
    return true;
  }

  const first = (fields, no) => {
    for (const f of fields) if (f.no === no) return f;
    return null;
  };
  const fieldString = (no, text) => ({ no: no, w: 2, p: TE.encode(text) });
  const fieldBytes = (no, payload) => ({ no: no, w: 2, p: payload });
  const fieldVarint = (no, value) => ({ no: no, w: 0, v: BigInt(value) });

  function text(f) {
    if (!f || f.w !== 2) return null;
    return wireDecodeText(f.p);
  }

  // 用 fn 的返回值替换 path 指向的消息；路径缺失或解析失败时返回 null。
  function edit(message, path, fn) {
    if (!path.length) return fn(message);
    const fields = parse(message);
    if (!fields || !same(serialize(fields), message)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;
