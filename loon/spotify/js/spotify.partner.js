//=======================================================================================
// Spotify Enhance — 界面名称字形（Pathfinder JSON + spclient protobuf）
// 自动生成，请勿直接编辑。源文件在 src/，构建：node scripts/build.js
//=======================================================================================


(() => {
  "use strict";

  //=====================================================================================
  // protobuf wire —— 三端脚本共用的底层编解码
  //
  // 只做「把一段字节拆成字段列表」「按字段号编码」「varint 读写」，
  // 不建模具体消息。未建模的字段按 raw 原样保留，改不动时最多不生效，
  // 不会把响应写坏。
  //=====================================================================================

  const WIRE_TEXT = new TextEncoder();
  const WIRE_UTF8 = new TextDecoder("utf-8", { fatal: true });

  // varint 用 BigInt 读，避免 64 位字段（时间戳、ID）超过 2^53 后丢低位。
  function wireReadVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    let value = 0n;
    let shift = 0n;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      value |= BigInt(byte & 0x7f) << shift;
      if (!(byte & 0x80)) return value;
      shift += 7n;
      if (shift > 63n) throw new Error("Invalid protobuf varint");
    }
    throw new Error("Truncated protobuf varint");
  }

  // 字段号 / 长度这类小整数走 Number，避免每个字段都分配 BigInt；
  // 真的超过 4 字节时退回 BigInt 保证正确（实际只有超长字段才可能）。
  function wireReadCount(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    const start = state.i;
    let value = 0;
    let shift = 0;
    while (state.i < limit) {
      const byte = bytes[state.i++];
      if (shift < 28) {
        value |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) return value >>> 0;
        shift += 7;
        continue;
      }
      // 超过 4 字节：退回去用 BigInt 重读整个 varint。
      state.i = start;
      return Number(wireReadVarint(bytes, state, limit));
    }
    throw new Error("Truncated protobuf varint");
  }

  // 只跳过 wire 0 的 varint，不构造 BigInt。字段切分 / 扫描时不需要这个值，
  // 大响应里能省掉每个数值字段一次 BigInt 分配。
  function wireSkipVarint(bytes, state, end) {
    const limit = end === undefined ? bytes.length : end;
    while (state.i < limit) {
      if (!(bytes[state.i++] & 0x80)) return;
    }
    throw new Error("Truncated protobuf varint");
  }

  function wireVarintLength(value) {
    let length = 1;
    while (value >= 0x80n) {
      length++;
      value >>= 7n;
    }
    return length;
  }

  function wireEncodeVarint(value) {
    if ("number" == typeof value && value >= 0 && value <= 0x7fffffff) {
      let n = value | 0;
      const len = n < 0x80 ? 1 : n < 0x4000 ? 2 : n < 0x200000 ? 3 : n < 0x10000000 ? 4 : 5;
      const out = new Uint8Array(len);
      let at = 0;
      while (n >= 0x80) {
        out[at++] = (n & 0x7f) | 0x80;
        n >>>= 7;
      }
      out[at] = n;
      return out;
    }
    let rest = BigInt(value);
    const out = new Uint8Array(wireVarintLength(rest));
    let at = 0;
    while (rest >= 0x80n) {
      out[at++] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    out[at] = Number(rest);
    return out;
  }

  function wireConcat(parts) {
    let size = 0;
    for (const part of parts) size += part.length;
    const out = new Uint8Array(size);
    let at = 0;
    for (const part of parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }

  function wireEqual(left, right) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
  }

  // 旧式 group（wire type 3）：从 start 之后开始找匹配的 end group，返回结束位置。
  // Spotify 的元数据响应里偶尔会带 group，不认它的话整条响应只能原样放行。
  function wireSkipGroup(bytes, from, no) {
    const state = { i: from };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const inner = tag >>> 3;
      const wire = tag & 7;
      if (!inner) throw new Error("Invalid protobuf field");
      if (wire === 4) {
        if (inner !== no) throw new Error("Mismatched protobuf end group");
        return state.i;
      }
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, inner);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
    }
    throw new Error("Truncated protobuf group");
  }

  // 返回 [{ no, wire, data, raw }]；data 是字段值，raw 是含 tag 的整段字节。
  function wireParseFields(bytes) {
    const fields = [];
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const rawStart = state.i;
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");

      let dataStart = state.i;
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        dataStart = state.i;
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        // group：整段（含起止 tag）当 opaque 值保留，重新编码时原样写回。
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");

      fields.push({
        no: no,
        wire: wire,
        data: bytes.subarray(dataStart, state.i),
        raw: bytes.subarray(rawStart, state.i),
      });
    }
    return fields;
  }

  // 只扫字段号、不建对象、不切子数组；onField(no) 返回 true 时提前结束。
  // 用于大响应里判断「有没有某个字段」，比完整 parse 快很多。
  function wireScanFields(bytes, onField) {
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no)) return true;
    }
    return false;
  }

  // 流式遍历字段，不分配字段对象与子数组；回调返回 true 时提前停止。
  function wireForEachField(bytes, onField) {
    const state = { i: 0 };
    while (state.i < bytes.length) {
      const rawStart = state.i;
      const tag = wireReadCount(bytes, state);
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) throw new Error("Invalid protobuf field");

      let dataStart = state.i;
      if (wire === 2) {
        const length = wireReadCount(bytes, state);
        if (length > bytes.length - state.i) throw new Error("Truncated protobuf field");
        dataStart = state.i;
        state.i += length;
      } else if (wire === 1) {
        state.i += 8;
      } else if (wire === 5) {
        state.i += 4;
      } else if (wire === 0) {
        wireSkipVarint(bytes, state);
      } else if (wire === 3) {
        state.i = wireSkipGroup(bytes, state.i, no);
      } else {
        throw new Error("Unsupported protobuf wire type " + wire);
      }
      if (state.i > bytes.length) throw new Error("Truncated protobuf field");
      if (onField(no, wire, dataStart, state.i, rawStart, state.i)) return true;
    }
    return false;
  }

  // 按 no / wire 编码一个字段；payload 对 wire 0 是 varint 字节，其余是字段值。
  function wireEncodeField(no, wire, payload) {
    const tag = wireEncodeVarint(BigInt(no) * 8n + BigInt(wire));
    return wire === 2 ? wireConcat([tag, wireEncodeVarint(payload.length), payload]) : wireConcat([tag, payload]);
  }

  function wireDecodeText(bytes) {
    try {
      return WIRE_UTF8.decode(bytes);
    } catch (e) {
      return null;
    }
  }

  // ---------------------------------------------------------------- protobuf
  //
  // 底层 varint / 字段切分 / 字段编码在 src/proto/wire.js，三端共用。
  // 这里只保留 Spotify 需要的消息级封装：parse 失败返回 null，
  // edit 在重编码前后做一次字节比对，防止把不认识的响应写坏。

  const TE = WIRE_TEXT;
  const TD = WIRE_UTF8;
  const readVarint = wireReadVarint;

  // 小整数 varint（字段号 / 长度）：失败（截断 / 超长 / 越界）返回 -1，不抛异常。
  // 元数据响应里大量字符串会被拿来试探「是不是子消息」，绝大多数会在这里失败；
  // 用异常处理失败既慢又会反复捕获调用栈。
  function readCount(bytes, state) {
    const start = state.i;
    const limit = bytes.length;
    let at = start;
    let value = 0;
    let shift = 0;
    while (at < limit) {
      const byte = bytes[at++];
      if (shift < 28) {
        value |= (byte & 0x7f) << shift;
        if (!(byte & 0x80)) {
          state.i = at;
          return value >>> 0;
        }
        shift += 7;
        continue;
      }
      // 超过 4 字节：退回 BigInt 路径，拒绝超出 32 位范围的非法 tag / 长度。
      try {
        const big = wireReadVarint(bytes, state, limit);
        return big <= 0xffffffffn ? Number(big) : -1;
      } catch (e) {
        return -1;
      }
    }
    return -1;
  }

  // 字节不是合法消息时返回 null。一趟扫描直接产出字段对象，不经过中间数组。
  function parse(b) {
    const fields = [];
    const state = { i: 0 };
    const total = b.length;
    while (state.i < total) {
      const rawStart = state.i;
      const tag = readCount(b, state);
      if (tag < 0) return null;
      const no = tag >>> 3;
      const wire = tag & 7;
      if (!no) return null;

      let dataStart = state.i;
      let end;
      let varintValue;
      if (wire === 2) {
        const length = readCount(b, state);
        if (length < 0 || length > total - state.i) return null;
        dataStart = state.i;
        end = dataStart + length;
      } else if (wire === 0) {
        // 单趟解码 varint：1-4 字节小整数直接位运算，避免 subarray 与逐字节 BigInt 分配。
        let at = dataStart;
        let small = 0;
        let shift = 0;
        let resolved = false;
        while (at < total && shift < 28) {
          const byte = b[at++];
          small |= (byte & 0x7f) << shift;
          if (!(byte & 0x80)) {
            const u = small >>> 0;
            varintValue = u === 0 ? 0n : u === 1 ? 1n : BigInt(u);
            end = at;
            resolved = true;
            break;
          }
          shift += 7;
        }
        if (!resolved) {
          state.i = dataStart;
          try {
            varintValue = wireReadVarint(b, state, total);
          } catch (e) {
            return null;
          }
          end = state.i;
        }
      } else if (wire === 1) {
        end = dataStart + 8;
      } else if (wire === 5) {
        end = dataStart + 4;
      } else if (wire === 3) {
        // group：整段（含起止 tag）当 opaque 值保留，重新编码时原样写回。
        try {
          end = wireSkipGroup(b, dataStart, no);
        } catch (e) {
          return null;
        }
      } else {
        return null;
      }
      if (end > total) return null;
      state.i = end;

      const raw = b.subarray(rawStart, end);
      if (wire === 0) {
        fields.push({ no: no, w: 0, v: varintValue, raw: raw });
      } else if (wire === 3) {
        // group 原样保留：p 存的是含起止 tag 的整段，serialize 直接写回。
        fields.push({ no: no, w: 3, p: raw, raw: raw });
      } else {
        fields.push({ no: no, w: wire, p: b.subarray(dataStart, end), raw: raw });
      }
    }
    return fields;
  }

  // varint 的 Number 版：字段号 / 长度 / 常见数值都远小于 2^31，用常数分支和位运算
  // 避开浮点除法；超过 2^53 的 64 位值仍走 BigInt 保证不丢位。
  const MAX_SAFE_BIG = 9007199254740991n;
  function varintSize(n) {
    if (n < 128) return 1;
    if (n < 16384) return 2;
    if (n < 2097152) return 3;
    if (n < 268435456) return 4;
    if (n <= 0xffffffff) return 5;
    let size = 1;
    while (n >= 128) {
      n = Math.floor(n / 128);
      size += 1;
    }
    return size;
  }

  function writeVarint(out, at, n) {
    if (n <= 0x7fffffff) {
      while (n >= 128) {
        out[at++] = (n & 0x7f) | 0x80;
        n >>>= 7;
      }
      out[at++] = n;
      return at;
    }
    while (n >= 128) {
      out[at++] = (n % 128) | 128;
      n = Math.floor(n / 128);
    }
    out[at++] = n;
    return at;
  }

  function writeVarintBig(out, at, value) {
    let rest = value;
    while (rest >= 0x80n) {
      out[at++] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    out[at++] = Number(rest);
    return at;
  }

  const isBigValue = (v) => typeof v === "bigint" && v > MAX_SAFE_BIG;

  // 一次算好总长度、一次分配、直接写入；输出字节与逐字段 wireEncodeField + wireConcat 完全一致。
  function serialize(fields) {
    let size = 0;
    for (const f of fields) {
      if (f.w === 3) {
        size += f.p.length;
        continue;
      }
      size += varintSize(f.no * 8 + f.w);
      if (f.w === 0) size += isBigValue(f.v) ? wireVarintLength(f.v) : varintSize(Number(f.v));
      else if (f.w === 2) size += varintSize(f.p.length) + f.p.length;
      else size += f.p.length;
    }
    const out = new Uint8Array(size);
    let at = 0;
    for (const f of fields) {
      if (f.w === 3) {
        out.set(f.p, at);
        at += f.p.length;
        continue;
      }
      at = writeVarint(out, at, f.no * 8 + f.w);
      if (f.w === 0) {
        at = isBigValue(f.v) ? writeVarintBig(out, at, f.v) : writeVarint(out, at, Number(f.v));
      } else {
        if (f.w === 2) at = writeVarint(out, at, f.p.length);
        out.set(f.p, at);
        at += f.p.length;
      }
    }
    return out;
  }

  // 判断整条消息是否本来就是规范编码。等价于 same(serialize(parse(buffer)), buffer)，
  // 但只比较每个字段的 tag / 长度，不复制大 payload，避免 12MB 响应白拷贝一遍。
  function samePrefix(bytes, prefix) {
    if (bytes.length !== prefix.length) return false;
    for (let i = 0; i < prefix.length; i += 1) if (bytes[i] !== prefix[i]) return false;
    return true;
  }

  // raw[at..at+len) 是否恰好是 n 的最短 varint 编码（不分配）。
  function matchesVarint(raw, at, n, len) {
    if (len === 1) return raw[at] === n;
    if (n <= 0x7fffffff) {
      for (let i = 0; i < len - 1; i += 1) {
        if (raw[at + i] !== ((n & 0x7f) | 0x80)) return false;
        n >>>= 7;
      }
      return raw[at + len - 1] === n;
    }
    for (let i = 0; i < len; i += 1) {
      const byte = i < len - 1 ? (n % 128) | 128 : n;
      if (raw[at + i] !== byte) return false;
      n = Math.floor(n / 128);
    }
    return true;
  }

  function allCanonical(fields) {
    for (const f of fields) {
      const raw = f.raw;
      if (!raw) return false;
      const tag = f.no * 8 + f.w;
      const tagLen = varintSize(tag);
      if (raw.length < tagLen || !matchesVarint(raw, 0, tag, tagLen)) return false;
      if (f.w === 0) {
        if (isBigValue(f.v)) {
          if (!samePrefix(raw.subarray(tagLen), wireEncodeVarint(f.v))) return false;
        } else {
          const value = Number(f.v);
          const valueLen = varintSize(value);
          if (raw.length !== tagLen + valueLen || !matchesVarint(raw, tagLen, value, valueLen)) return false;
        }
      } else if (f.w === 2) {
        const lengthLen = varintSize(f.p.length);
        if (raw.length !== tagLen + lengthLen + f.p.length) return false;
        if (!matchesVarint(raw, tagLen, f.p.length, lengthLen)) return false;
      } else if (f.w === 3) {
        // group 按 raw 原样写回，只要保留着就认为是规范编码。
        if (!f.raw || f.raw.length !== f.p.length) return false;
      } else if (raw.length !== tagLen + (f.w === 1 ? 8 : 4)) {
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
  function edit(message, path, fn, fields = parse(message)) {
    if (!path.length) return fn(message, fields);
    if (!fields || !allCanonical(fields)) return null;
    const f = first(fields, path[0]);
    if (!f || f.w !== 2) return null;
    const inner = edit(f.p, path.slice(1), fn);
    if (!inner) return null;
    f.p = inner;
    return serialize(fields);
  }

  const same = wireEqual;

// 繁 → 简折叠表（OpenCC t2s，Apache-2.0）。
//
// 只包含 BMP 内、繁简写法不同的字，以及 TSPhrases 里真正偏离字级映射的短语。
// 生成方式：
//   curl -O https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSCharacters.txt
//   curl -O https://raw.githubusercontent.com/BYVoid/OpenCC/master/data/dictionary/TSPhrases.txt
//   再按 TSCharacters / TSPhrases 的首选项生成。
//
// 用法：
//   SPOTIFY_HAN_VARIANTS.fold(text)          无条件繁→简，用于曲名 / 歌手匹配
//   SPOTIFY_HAN_VARIANTS.isTraditional(text) 判断是否是繁体文本（含日文假名时视为否）
//
// 性能：字符表和短语表在第一次 fold 时才构建（约 3.4k 项，< 1ms）；
// 不含汉字的文本直接返回，不建表、不逐字扫描。
const SPOTIFY_HAN_VARIANTS = (() => {
  "use strict";

  // 两条字符串一一对应：TRAD[i] → SIMP[i]。
  const TRAD = [
    "㑯㑳㑶㓨㘚㜄㜏㠏㥮㩜㩳㩵䁻䃮䊷䋙䋚䋹䋻䍦䎱䙡䜀䝼䥇䥑䥱䦛䦟䯀䰾䱷䱽䲁䲘䴉丟並乾亂亙亞佇佈佔併來侖侶侷俁係俔俠俥俬倀倆倈倉個們倖倫倲偉偑側偵偽傌傑傖傘備傢傭傯傳傴",
    "債傷傾僂僅僉僑僕僞僥僨僱價儀儁儂億儈儉儎儐儔儕儘償優儲儷儸儺儻儼兇兌兒兗內兩冊冑冪凈凍凜凱別刪剄則剋剎剗剛剝剮剴創剷劃劄劇劉劊劌劍劏劑劚勁動務勛勝勞勢勩勱勳勵勸",
    "勻匭匯匱區協卹卻卽厙厠厤厭厲厴參叄叢吒吳吶呂咼員唄唸問啓啞啟啢喎喚喪喫喬單喲嗆嗇嗊嗎嗚嗩嗶嘆嘍嘓嘔嘖嘗嘜嘩嘮嘯嘰嘵嘸嘽噁噓噚噝噠噥噦噯噲噴噸噹嚀嚇嚌嚐嚕嚙嚥嚦嚨",
    "嚮嚲嚳嚴嚶囀囁囂囅囈囉囌囑囪圇國圍園圓圖團垻埡埰執堅堊堖堝堯報場塊塋塏塒塗塚塢塤塵塹墊墜墮墰墳墶墻墾壇壋壎壓壘壙壚壜壞壟壠壢壩壪壯壺壼壽夠夢夥夾奐奧奩奪奬奮奼妝",
    "姍姦娛婁婦婭媧媯媰媼媽嫋嫗嫵嫺嫻嫿嬀嬃嬈嬋嬌嬙嬡嬤嬪嬰嬸孃孋孌孫學孿宮寀寢實寧審寫寬寵寶將專尋對導尷屆屍屓屜屢層屨屬岡峯峴島峽崍崑崗崙崢崬嵐嵗嵾嶁嶄嶇嶔嶗嶠嶢嶧",
    "嶨嶮嶸嶺嶼嶽巋巒巔巖巰巹帥師帳帶幀幃幓幗幘幟幣幫幬幷幹幾庫廁廂廄廈廎廕廚廝廟廠廡廢廣廩廬廳弒弔弳張強彆彈彌彎彔彙彠彥彫彲彿後徑從徠復徵徹恆恥悅悞悵悶悽惡惱惲惻愛",
    "愜愨愴愷愾慄態慍慘慚慟慣慤慪慫慮慳慶慺慼慾憂憊憐憑憒憖憚憤憫憮憲憶懇應懌懍懞懟懣懤懨懲懶懷懸懺懼懾戀戇戔戧戩戰戱戲戶扞拋拚挩挱挾捨捫捱捲掃掄掆掗掙掛採揀揚換揮揯",
    "損搖搗搧搵搶摑摜摟摯摳摶摺摻撈撏撐撓撝撟撣撥撫撲撳撻撾撿擁擄擇擊擋擓擔據擠擡擣擬擯擰擱擲擴擷擺擻擼擽擾攄攆攏攔攖攙攛攜攝攢攣攤攪攬敎敓敗敘敵數斂斃斆斕斬斷於旂旣",
    "昇時晉晝暈暉暘暢暫曄曆曇曉曏曖曠曨曬書會朧朮東枴柵柺査桿梔梘條梟梲棄棊棖棗棟棡棧棲棶椏椲楊楓楨業極榘榦榪榮榲榿構槍槓槤槧槨槮槳槶槼樁樂樅樑樓標樞樢樣樧樫樳樸樹樺",
    "樿橈橋機橢橫檁檉檔檜檟檢檣檮檯檳檸檻櫃櫓櫚櫛櫝櫞櫟櫥櫧櫨櫪櫫櫬櫱櫳櫸櫻欄欅權欏欒欖欞欽歎歐歟歡歲歷歸歿殘殞殤殨殫殭殮殯殰殲殺殻殼毀毆毿氂氈氌氣氫氬氳氾汎汙決沒沖",
    "況泝洩洶浹涇涗涼淒淚淥淨淩淪淵淶淺渙減渢渦測渾湊湞湧湯溈準溝溫溮溳溼滄滅滌滎滙滬滯滲滷滸滻滾滿漁漊漚漢漣漬漲漵漸漿潁潑潔潙潚潛潤潯潰潷潿澀澆澇澐澗澠澤澦澩澮澱澾",
    "濁濃濄濕濘濚濛濜濟濤濧濫濰濱濺濼濾瀂瀅瀆瀇瀉瀋瀏瀕瀘瀝瀟瀠瀦瀧瀨瀰瀲瀾灃灄灑灕灘灝灡灣灤灧灩災為烏烴無煉煒煙煢煥煩煬煱熅熒熗熱熲熾燁燈燉燒燙燜營燦燬燭燴燶燻燼燾",
    "爍爐爛爭爲爺爾牀牆牘牴牽犖犛犢犧狀狹狽猙猶猻獁獃獄獅獎獨獪獫獮獰獱獲獵獷獸獺獻獼玀現琱琺琿瑋瑒瑣瑤瑩瑪瑲璉璡璣璦璫璯環璵璸璽璿瓊瓏瓔瓚甌甕產産畝畢畫異畵當疇疊痙",
    "痠痾瘂瘋瘍瘓瘞瘡瘧瘮瘲瘺瘻療癆癇癉癒癘癟癡癢癤癥癧癩癬癭癮癰癱癲發皁皚皰皸皺盃盜盞盡監盤盧盪眞眥眾睏睜睞瞘瞜瞞瞶瞼矇矓矚矯硃硜硤硨硯碕碩碭碸確碼碽磑磚磠磣磧磯磽",
    "磾礄礎礙礦礪礫礬礱祕祿禍禎禕禡禦禪禮禰禱禿秈稅稈稏稜稟種稱穀穇穌積穎穠穡穢穩穫穭窩窪窮窯窵窶窺竄竅竇竈竊竪競筆筍筧筴箇箋箏箚節範築篋篔篠篤篩篳簀簍簑簞簡簣簫簹簽",
    "簾籃籌籔籙籛籜籟籠籤籩籪籬籮籲粵糉糝糞糧糰糲糴糶糹糾紀紂約紅紆紇紈紉紋納紐紓純紕紖紗紘紙級紛紜紝紡紬紮細紱紲紳紵紹紺紼紿絀終絃組絅絆絎結絕絛絝絞絡絢給絨絰統絲絳",
    "絶絹綁綃綆綈綉綌綏綐綑經綜綞綠綢綣綫綬維綯綰綱網綳綴綵綸綹綺綻綽綾綿緄緇緊緋緑緒緓緔緗緘緙線緝緞締緡緣緦編緩緬緯緱緲練緶緹緻緼縈縉縊縋縐縑縕縗縛縝縞縟縣縧縫縭縮",
    "縱縲縳縴縵縶縷縹總績繃繅繆繒織繕繚繞繡繢繩繪繫繭繮繯繰繳繸繹繼繽繾繿纇纈纊續纍纏纓纔纖纘纜缽罃罈罌罎罰罵罷羅羆羈羋羣羥羨義羶習翫翬翹翽耬耮聖聞聯聰聲聳聵聶職聹聽",
    "聾肅脅脈脛脣脩脫脹腎腖腡腦腫腳腸膃膕膚膞膠膩膽膾膿臉臍臏臘臚臟臠臢臥臨臺與興舉舊舖舘艙艤艦艫艱艷芻苧茲荊莊莖莢莧華菴菸萇萊萬萴萵葉葒葤葦葯葷蒐蒓蒔蒕蒞蒼蓀蓆蓋蓮",
    "蓯蓴蓽蔔蔘蔞蔣蔥蔦蔭蕁蕆蕎蕒蕓蕕蕘蕢蕩蕪蕭蕷薀薈薊薌薑薔薘薟薦薩薴薵薹薺藍藎藝藥藪藭藴藶藹藺蘀蘄蘆蘇蘊蘋蘚蘞蘢蘭蘺蘿虆處虛虜號虧虯蛺蛻蜆蝕蝟蝦蝨蝸螄螞螢螮螻螿蟄",
    "蟈蟎蟣蟬蟯蟲蟶蟻蠁蠅蠆蠍蠐蠑蠔蠟蠣蠨蠱蠶蠻衆衊術衕衚衛衝袞袷裊裏補裝裡製複褌褘褲褳褸褻襇襉襏襖襝襠襤襪襬襯襲襴覈見覎規覓視覘覡覥覦親覬覯覲覷覺覽覿觀觴觶觸訁訂訃",
    "計訊訌討訐訒訓訕訖託記訛訝訟訢訣訥訩訪設許訴訶診註証詁詆詎詐詒詔評詖詗詘詛詞詠詡詢詣試詩詫詬詭詮詰話該詳詵詼詿誄誅誆誇誌認誑誒誕誘誚語誠誡誣誤誥誦誨說説誰課誶誹",
    "誼誾調諂諄談諉請諍諏諑諒論諗諛諜諝諞諡諢諤諦諧諫諭諮諱諳諶諷諸諺諼諾謀謁謂謄謅謊謎謐謔謖謗謙謚講謝謠謡謨謫謬謭謳謹謾譁證譎譏譖識譙譚譜譟譫譭譯議譴護譸譽譾讀讅變",
    "讋讌讎讒讓讕讖讚讜讞谿豈豎豐豔豬豶貍貓貙貝貞貟負財貢貧貨販貪貫責貯貰貲貳貴貶買貸貺費貼貽貿賀賁賂賃賄賅資賈賊賑賒賓賕賙賚賜賞賠賡賢賣賤賦賧質賫賬賭賰賴賵賺賻購賽",
    "賾贄贅贇贈贊贋贍贏贐贓贔贖贗贛贜赬趕趙趨趲跡踐踰踴蹌蹕蹟蹠蹣蹤蹺躂躉躊躋躍躎躑躒躓躕躚躡躥躦躪軀車軋軌軍軑軒軔軛軟軤軫軲軸軹軺軻軼軾較輅輇輈載輊輒輓輔輕輛輜輝輞",
    "輟輥輦輩輪輬輯輳輸輻輼輾輿轀轂轄轅轆轉轍轎轔轟轡轢轤辦辭辮辯農迴逕這連週進遊運過達違遙遜遞遠遡適遲遶遷選遺遼邁還邇邊邏邐郟郵鄆鄉鄒鄔鄖鄧鄭鄰鄲鄴鄶鄺酇酈醃醖醜醞",
    "醟醣醫醬醱釀釁釃釅釋釐釒釓釔釕釗釘釙針釣釤釦釧釩釵釷釹釺釾鈀鈁鈃鈄鈅鈈鈉鈍鈎鈐鈑鈒鈔鈕鈞鈡鈣鈥鈦鈧鈮鈰鈳鈴鈷鈸鈹鈺鈽鈾鈿鉀鉅鉆鉈鉉鉋鉍鉑鉕鉗鉚鉛鉞鉢鉤鉦鉬鉭鉳鉶",
    "鉸鉺鉻鉿銀銃銅銍銑銓銖銘銚銛銜銠銣銥銦銨銩銪銫銬銱銳銷銹銻銼鋁鋃鋅鋇鋌鋏鋒鋙鋝鋟鋣鋤鋥鋦鋨鋩鋪鋭鋮鋯鋰鋱鋶鋸鋼錁錄錆錇錈錏錐錒錕錘錙錚錛錟錠錡錢錦錨錩錫錮錯録錳",
    "錶錸錼鍀鍁鍃鍅鍆鍇鍈鍊鍋鍍鍔鍘鍚鍛鍠鍤鍥鍩鍬鍰鍵鍶鍺鍼鍾鎂鎄鎇鎊鎌鎔鎖鎘鎚鎛鎡鎢鎣鎦鎧鎩鎪鎬鎭鎮鎰鎲鎳鎵鎶鎸鎿鏃鏇鏈鏌鏍鏐鏑鏗鏘鏜鏝鏞鏟鏡鏢鏤鏨鏰鏵鏷鏹鏺鏽鐃鐋",
    "鐐鐒鐓鐔鐘鐙鐝鐠鐥鐦鐧鐨鐫鐮鐯鐲鐳鐵鐶鐸鐺鐿鑄鑊鑌鑑鑒鑔鑕鑞鑠鑣鑥鑭鑰鑱鑲鑷鑹鑼鑽鑾鑿钁钂長門閂閃閆閈閉開閌閎閏閑閒間閔閘閡閣閤閥閨閩閫閬閭閱閲閶閹閻閼閽閾閿闃",
    "闆闇闈闊闋闌闍闐闒闓闔闕闖關闞闠闡闢闤闥陘陝陞陣陰陳陸陽隉隊階隕際隨險隯隱隴隸隻雋雖雙雛雜雞離難雲電霑霢霧霽靂靄靆靈靉靚靜靝靦靨鞏鞝鞦鞽韁韃韆韉韋韌韍韓韙韜韝韞",
    "韻響頁頂頃項順頇須頊頌頎頏預頑頒頓頗領頜頡頤頦頭頮頰頲頴頷頸頹頻頽顆題額顎顏顒顓顔願顙顛類顢顥顧顫顬顯顰顱顳顴風颭颮颯颱颳颶颸颺颻颼飀飄飆飈飛飠飢飣飥飩飪飫飭飯",
    "飱飲飴飼飽飾飿餃餄餅餈餉養餌餎餏餑餒餓餕餖餘餚餛餜餞餡館餬餱餳餵餶餷餺餼餾餿饁饃饅饈饉饊饋饌饑饒饗饜饞饢馬馭馮馱馳馴馹駁駐駑駒駔駕駘駙駛駝駟駡駢駭駰駱駸駿騁騂騅",
    "騌騍騎騏騖騙騤騧騫騭騮騰騶騷騸騾驀驁驂驃驄驅驊驌驍驏驕驗驚驛驟驢驤驥驦驪驫骯髏髒體髕髖髮鬆鬍鬚鬢鬥鬧鬨鬩鬮鬱鬹魎魘魚魛魢魨魯魴魷魺鮁鮃鮊鮋鮍鮎鮐鮑鮒鮓鮚鮜鮝鮞鮣",
    "鮦鮪鮫鮭鮮鮳鮶鮺鯀鯁鯇鯉鯊鯒鯔鯕鯖鯗鯛鯝鯡鯢鯤鯧鯨鯪鯫鯰鯴鯷鯽鯿鰁鰂鰃鰆鰈鰉鰌鰍鰏鰐鰒鰓鰛鰜鰟鰠鰣鰥鰧鰨鰩鰭鰮鰱鰲鰳鰵鰷鰹鰺鰻鰼鰾鱂鱅鱈鱉鱒鱔鱖鱗鱘鱝鱟鱠鱣鱤鱧",
    "鱨鱭鱯鱷鱸鱺鳥鳧鳩鳬鳲鳳鳴鳶鳾鴆鴇鴉鴒鴕鴛鴝鴞鴟鴣鴦鴨鴯鴰鴴鴷鴻鴿鵁鵂鵃鵐鵑鵒鵓鵜鵝鵠鵡鵪鵬鵮鵯鵰鵲鵷鵾鶄鶇鶉鶊鶓鶖鶘鶚鶡鶥鶩鶪鶬鶯鶲鶴鶹鶺鶻鶼鶿鷀鷁鷂鷄鷉鷊鷓",
    "鷖鷗鷙鷚鷥鷦鷫鷯鷲鷳鷴鷸鷹鷺鷽鸂鸇鸊鸌鸏鸕鸘鸚鸛鸝鸞鹵鹹鹺鹼鹽麗麥麩麪麫麯麴麵麼麽黃黌點黨黲黴黶黷黽黿鼂鼉鼕鼴齊齋齎齏齒齔齕齗齙齜齟齠齡齣齦齧齪齬齲齶齷龍龎龐龑",
    "龔龕龜鿁鿓妳衞",
  ].join("");
  const SIMP = [
    "㑔㑇㐹刾㘎㚯㛣㟆㤘㨫㧐擜䀥鿎䌶䌺䌻䌿䌾䍠䎬䙌䜧䞍䦂鿏䥾䦶䦷䯅鲃䲣䲝鳚鳤鹮丢并干乱亘亚伫布占并来仑侣局俣系伣侠伡私伥俩俫仓个们幸伦㑈伟㐽侧侦伪㐷杰伧伞备家佣偬传伛",
    "债伤倾偻仅佥侨仆伪侥偾雇价仪俊侬亿侩俭傤傧俦侪尽偿优储俪㑩傩傥俨凶兑儿兖内两册胄幂净冻凛凯别删刭则克刹刬刚剥剐剀创铲划札剧刘刽刿剑㓥剂㔉劲动务勋胜劳势勚劢勋励劝",
    "匀匦汇匮区协恤却即厍厕历厌厉厣参叁丛咤吴呐吕呙员呗念问启哑启唡㖞唤丧吃乔单哟呛啬唝吗呜唢哔叹喽啯呕啧尝唛哗唠啸叽哓呒啴恶嘘㖊咝哒哝哕嗳哙喷吨当咛吓哜尝噜啮咽呖咙",
    "向亸喾严嘤啭嗫嚣冁呓啰苏嘱囱囵国围园圆图团坝垭采执坚垩垴埚尧报场块茔垲埘涂冢坞埙尘堑垫坠堕坛坟垯墙垦坛垱埙压垒圹垆坛坏垄垅坜坝塆壮壶壸寿够梦伙夹奂奥奁夺奖奋姹妆",
    "姗奸娱娄妇娅娲妫㛀媪妈袅妪妩娴娴婳妫媭娆婵娇嫱嫒嬷嫔婴婶娘㛤娈孙学孪宫采寝实宁审写宽宠宝将专寻对导尴届尸屃屉屡层屦属冈峰岘岛峡崃昆岗仑峥岽岚岁㟥嵝崭岖嵚崂峤峣峄",
    "峃崄嵘岭屿岳岿峦巅岩巯卺帅师帐带帧帏㡎帼帻帜币帮帱并干几库厕厢厩厦庼荫厨厮庙厂庑废广廪庐厅弑吊弪张强别弹弥弯录汇彟彦雕彨佛后径从徕复征彻恒耻悦悮怅闷凄恶恼恽恻爱",
    "惬悫怆恺忾栗态愠惨惭恸惯悫怄怂虑悭庆㥪戚欲忧惫怜凭愦慭惮愤悯怃宪忆恳应怿懔蒙怼懑㤽恹惩懒怀悬忏惧慑恋戆戋戗戬战戯戏户捍抛拼捝挲挟舍扪挨卷扫抡㧏挜挣挂采拣扬换挥搄",
    "损摇捣扇揾抢掴掼搂挚抠抟折掺捞挦撑挠㧑挢掸拨抚扑揿挞挝捡拥掳择击挡㧟担据挤抬捣拟摈拧搁掷扩撷摆擞撸㧰扰摅撵拢拦撄搀撺携摄攒挛摊搅揽教敚败叙敌数敛毙敩斓斩断于旗既",
    "升时晋昼晕晖旸畅暂晔历昙晓向暧旷昽晒书会胧术东拐栅拐查杆栀枧条枭棁弃棋枨枣栋㭎栈栖梾桠㭏杨枫桢业极矩干杩荣榅桤构枪杠梿椠椁椮桨椢椝桩乐枞梁楼标枢㭤样榝㭴桪朴树桦",
    "椫桡桥机椭横檩柽档桧槚检樯梼台槟柠槛柜橹榈栉椟橼栎橱槠栌枥橥榇蘖栊榉樱栏榉权椤栾榄棂钦叹欧欤欢岁历归殁残殒殇㱮殚僵殓殡㱩歼杀壳壳毁殴毵牦毡氇气氢氩氲泛泛污决没冲",
    "况溯泄汹浃泾涚凉凄泪渌净凌沦渊涞浅涣减沨涡测浑凑浈涌汤沩准沟温浉涢湿沧灭涤荥汇沪滞渗卤浒浐滚满渔溇沤汉涟渍涨溆渐浆颍泼洁沩㴋潜润浔溃滗涠涩浇涝沄涧渑泽滪泶浍淀㳠",
    "浊浓㳡湿泞溁蒙浕济涛㳔滥潍滨溅泺滤澛滢渎㲿泻沈浏濒泸沥潇潆潴泷濑弥潋澜沣滠洒漓滩灏㳕湾滦滟滟灾为乌烃无炼炜烟茕焕烦炀㶽煴荧炝热颎炽烨灯炖烧烫焖营灿毁烛烩㶶熏烬焘",
    "烁炉烂争为爷尔床墙牍抵牵荦牦犊牺状狭狈狰犹狲犸呆狱狮奖独狯猃狝狞㺍获猎犷兽獭献猕猡现雕珐珲玮玚琐瑶莹玛玱琏琎玑瑷珰㻅环玙瑸玺璇琼珑璎瓒瓯瓮产产亩毕画异画当畴叠痉",
    "酸疴痖疯疡痪瘗疮疟瘆疭瘘瘘疗痨痫瘅愈疠瘪痴痒疖症疬癞癣瘿瘾痈瘫癫发皂皑疱皲皱杯盗盏尽监盘卢荡真眦众困睁睐眍䁖瞒瞆睑蒙眬瞩矫朱硁硖砗砚埼硕砀砜确码䂵硙砖硵碜碛矶硗",
    "䃅硚础碍矿砺砾矾砻秘禄祸祯祎祃御禅礼祢祷秃籼税秆䅉棱禀种称谷䅟稣积颖秾穑秽稳获穞窝洼穷窑窎窭窥窜窍窦灶窃竖竞笔笋笕䇲个笺筝札节范筑箧筼筿笃筛筚箦篓蓑箪简篑箫筜签",
    "帘篮筹䉤箓篯箨籁笼签笾簖篱箩吁粤粽糁粪粮团粝籴粜纟纠纪纣约红纡纥纨纫纹纳纽纾纯纰纼纱纮纸级纷纭纴纺䌷扎细绂绁绅纻绍绀绋绐绌终弦组䌹绊绗结绝绦绔绞络绚给绒绖统丝绛",
    "绝绢绑绡绠绨绣绤绥䌼捆经综缍绿绸绻线绶维绹绾纲网绷缀彩纶绺绮绽绰绫绵绲缁紧绯绿绪绬绱缃缄缂线缉缎缔缗缘缌编缓缅纬缑缈练缏缇致缊萦缙缢缒绉缣缊缞缚缜缟缛县绦缝缡缩",
    "纵缧䌸纤缦絷缕缥总绩绷缫缪缯织缮缭绕绣缋绳绘系茧缰缳缲缴䍁绎继缤缱䍀颣缬纩续累缠缨才纤缵缆钵䓨坛罂坛罚骂罢罗罴羁芈群羟羡义膻习玩翚翘翙耧耢圣闻联聪声耸聩聂职聍听",
    "聋肃胁脉胫唇修脱胀肾胨脶脑肿脚肠腽腘肤䏝胶腻胆脍脓脸脐膑腊胪脏脔臜卧临台与兴举旧铺馆舱舣舰舻艰艳刍苎兹荆庄茎荚苋华庵烟苌莱万荝莴叶荭荮苇药荤搜莼莳蒀莅苍荪席盖莲",
    "苁莼荜卜参蒌蒋葱茑荫荨蒇荞荬芸莸荛蒉荡芜萧蓣蕰荟蓟芗姜蔷荙莶荐萨苧䓓苔荠蓝荩艺药薮䓖蕴苈蔼蔺萚蕲芦苏蕴苹藓蔹茏兰蓠萝蔂处虚虏号亏虬蛱蜕蚬蚀猬虾虱蜗蛳蚂萤䗖蝼螀蛰",
    "蝈螨虮蝉蛲虫蛏蚁蚃蝇虿蝎蛴蝾蚝蜡蛎蟏蛊蚕蛮众蔑术同胡卫冲衮夹袅里补装里制复裈袆裤裢褛亵裥裥袯袄裣裆褴袜摆衬袭襕核见觃规觅视觇觋觍觎亲觊觏觐觑觉览觌观觞觯触讠订讣",
    "计讯讧讨讦讱训讪讫托记讹讶讼䜣诀讷讻访设许诉诃诊注证诂诋讵诈诒诏评诐诇诎诅词咏诩询诣试诗诧诟诡诠诘话该详诜诙诖诔诛诓夸志认诳诶诞诱诮语诚诫诬误诰诵诲说说谁课谇诽",
    "谊訚调谄谆谈诿请诤诹诼谅论谂谀谍谞谝谥诨谔谛谐谏谕咨讳谙谌讽诸谚谖诺谋谒谓誊诌谎谜谧谑谡谤谦谥讲谢谣谣谟谪谬谫讴谨谩哗证谲讥谮识谯谭谱噪谵毁译议谴护诪誉谫读谉变",
    "詟䜩雠谗让谰谶赞谠谳溪岂竖丰艳猪豮狸猫䝙贝贞贠负财贡贫货贩贪贯责贮贳赀贰贵贬买贷贶费贴贻贸贺贲赂赁贿赅资贾贼赈赊宾赇赒赉赐赏赔赓贤卖贱赋赕质赍账赌䞐赖赗赚赙购赛",
    "赜贽赘赟赠赞赝赡赢赆赃赑赎赝赣赃赪赶赵趋趱迹践逾踊跄跸迹跖蹒踪跷跶趸踌跻跃䟢踯跞踬蹰跹蹑蹿躜躏躯车轧轨军轪轩轫轭软轷轸轱轴轵轺轲轶轼较辂辁辀载轾辄挽辅轻辆辎辉辋",
    "辍辊辇辈轮辌辑辏输辐辒辗舆辒毂辖辕辘转辙轿辚轰辔轹轳办辞辫辩农回径这连周进游运过达违遥逊递远溯适迟绕迁选遗辽迈还迩边逻逦郏邮郓乡邹邬郧邓郑邻郸邺郐邝酂郦腌酝丑酝",
    "蒏糖医酱酦酿衅酾酽释厘钅钆钇钌钊钉钋针钓钐扣钏钒钗钍钕钎䥺钯钫钘钭钥钚钠钝钩钤钣钑钞钮钧钟钙钬钛钪铌铈钶铃钴钹铍钰钸铀钿钾巨钻铊铉铇铋铂钷钳铆铅钺钵钩钲钼钽锫铏",
    "铰铒铬铪银铳铜铚铣铨铢铭铫铦衔铑铷铱铟铵铥铕铯铐铞锐销锈锑锉铝锒锌钡铤铗锋铻锊锓铘锄锃锔锇铓铺锐铖锆锂铽锍锯钢锞录锖锫锩铔锥锕锟锤锱铮锛锬锭锜钱锦锚锠锡锢错录锰",
    "表铼镎锝锨锪钫钔锴锳炼锅镀锷铡钖锻锽锸锲锘锹锾键锶锗针钟镁锿镅镑镰镕锁镉锤镈镃钨蓥镏铠铩锼镐镇镇镒镋镍镓鿔镌镎镞旋链镆镙镠镝铿锵镗镘镛铲镜镖镂錾镚铧镤镪䥽锈铙铴",
    "镣铹镦镡钟镫镢镨䦅锎锏镄镌镰䦃镯镭铁镮铎铛镱铸镬镔鉴鉴镲锧镴铄镳镥镧钥镵镶镊镩锣钻銮凿镢镋长门闩闪闫闬闭开闶闳闰闲闲间闵闸阂阁合阀闺闽阃阆闾阅阅阊阉阎阏阍阈阌阒",
    "板暗闱阔阕阑阇阗阘闿阖阙闯关阚阓阐辟阛闼陉陕升阵阴陈陆阳陧队阶陨际随险陦隐陇隶只隽虽双雏杂鸡离难云电沾霡雾霁雳霭叇灵叆靓静靔腼靥巩绱秋鞒缰鞑千鞯韦韧韨韩韪韬鞲韫",
    "韵响页顶顷项顺顸须顼颂颀颃预顽颁顿颇领颌颉颐颏头颒颊颋颕颔颈颓频颓颗题额颚颜颙颛颜愿颡颠类颟颢顾颤颥显颦颅颞颧风飐飑飒台刮飓飔飏飖飕飗飘飙飚飞饣饥饤饦饨饪饫饬饭",
    "飧饮饴饲饱饰饳饺饸饼糍饷养饵饹饻饽馁饿馂饾余肴馄馃饯馅馆糊糇饧喂馉馇馎饩馏馊馌馍馒馐馑馓馈馔饥饶飨餍馋馕马驭冯驮驰驯驲驳驻驽驹驵驾骀驸驶驼驷骂骈骇骃骆骎骏骋骍骓",
    "骔骒骑骐骛骗骙䯄骞骘骝腾驺骚骟骡蓦骜骖骠骢驱骅骕骁骣骄验惊驿骤驴骧骥骦骊骉肮髅脏体髌髋发松胡须鬓斗闹哄阋阄郁鬶魉魇鱼鱽鱾鲀鲁鲂鱿鲄鲅鲆鲌鲉鲏鲇鲐鲍鲋鲊鲒鲘鲞鲕䲟",
    "鲖鲔鲛鲑鲜鲓鲪鲝鲧鲠鲩鲤鲨鲬鲻鲯鲭鲞鲷鲴鲱鲵鲲鲳鲸鲮鲰鲶鲺鳀鲫鳊鳈鲗鳂䲠鲽鳇䲡鳅鲾鳄鳆鳃鳁鳒鳑鳋鲥鳏䲢鳎鳐鳍鳁鲢鳌鳓鳘鲦鲣鲹鳗鳛鳔鳉鳙鳕鳖鳟鳝鳜鳞鲟鲼鲎鲙鳣鳡鳢",
    "鲿鲚鳠鳄鲈鲡鸟凫鸠凫鸤凤鸣鸢䴓鸩鸨鸦鸰鸵鸳鸲鸮鸱鸪鸯鸭鸸鸹鸻䴕鸿鸽䴔鸺鸼鹀鹃鹆鹁鹈鹅鹄鹉鹌鹏鹐鹎雕鹊鹓鹍䴖鸫鹑鹒鹋鹙鹕鹗鹖鹛鹜䴗鸧莺鹟鹤鹠鹡鹘鹣鹚鹚鹢鹞鸡䴘鹝鹧",
    "鹥鸥鸷鹨鸶鹪鹔鹩鹫鹇鹇鹬鹰鹭鸴㶉鹯䴙鹱鹲鸬鹴鹦鹳鹂鸾卤咸鹾碱盐丽麦麸面面曲曲面么么黄黉点党黪霉黡黩黾鼋鼌鼍冬鼹齐斋赍齑齿龀龁龂龅龇龃龆龄出龈啮龊龉龋腭龌龙厐庞䶮",
    "龚龛龟䜤鿒你卫",
  ].join("");

  // 字级映射有歧义的短语（乾隆 / 乾坤 / 著名 / 藉口 / 慰藉…），优先于单字。
  const PHRASES = [
    "一坏 一坯",
    "一目瞭然 一目了然",
    "七逕 七迳",
    "上逕 上迳",
    "上鍊 上链",
    "不瞭解 不了解",
    "么麼 幺麽",
    "么麽 幺麽",
    "九逕山 九迳山",
    "乾亨 乾亨",
    "乾佑縣 乾佑县",
    "乾元 乾元",
    "乾化三年 乾化三年",
    "乾化二年 乾化二年",
    "乾化五年 乾化五年",
    "乾化元年 乾化元年",
    "乾化四年 乾化四年",
    "乾化年間 乾化年间",
    "乾卦 乾卦",
    "乾嘉 乾嘉",
    "乾圖 乾图",
    "乾坤 乾坤",
    "乾坤一擲 乾坤一掷",
    "乾坤再造 乾坤再造",
    "乾坤大挪移 乾坤大挪移",
    "乾宅 乾宅",
    "乾安縣 乾安县",
    "乾安鎮 乾安镇",
    "乾定 乾定",
    "乾寧 乾宁",
    "乾封 乾封",
    "乾州 乾州",
    "乾德 乾德",
    "乾斷 乾断",
    "乾旦 乾旦",
    "乾明 乾明",
    "乾曜 乾曜",
    "乾清宮 乾清宫",
    "乾盛世 乾盛世",
    "乾祐 乾祐",
    "乾符 乾符",
    "乾統 乾统",
    "乾綱 乾纲",
    "乾縣 乾县",
    "乾興 乾兴",
    "乾象 乾象",
    "乾造 乾造",
    "乾道 乾道",
    "乾闥婆 乾闼婆",
    "乾陵 乾陵",
    "乾隆 乾隆",
    "乾隆年間 乾隆年间",
    "乾隆皇帝 乾隆皇帝",
    "以免藉口 以免借口",
    "傢俱 家具",
    "允祕 允祕",
    "八濛山 八濛山",
    "其陰多蒐 其阴多蒐",
    "凌藉 凌借",
    "函覆 函复",
    "剋架 剋架",
    "剋毒 剋毒",
    "千鍾粟 千锺粟",
    "南氾 南氾",
    "南逕 南迳",
    "反反覆覆 反反复复",
    "反覆 反复",
    "反覆思維 反复思维",
    "反覆思量 反复思量",
    "反覆性 反复性",
    "名覆金甌 名复金瓯",
    "吳祕 吴祕",
    "吳育昇 吴育昇",
    "哪吒 哪吒",
    "回覆 回复",
    "土坏 土坯",
    "坏土 坯土",
    "坏子 坯子",
    "坏布 坯布",
    "坏戶 坯户",
    "墨沈沈 墨沉沉",
    "壺裏乾坤 壶里乾坤",
    "夥多 夥多",
    "夥頤 夥颐",
    "大目乾連冥間救母變文 大目乾连冥间救母变文",
    "宫商角徵羽 宫商角徵羽",
    "尼乾子 尼乾子",
    "尼乾陀 尼乾陀",
    "年釐 年釐",
    "幺麼 幺麽",
    "幺麼小丑 幺麽小丑",
    "幺麼小醜 幺麽小丑",
    "康乾 康乾",
    "張昇 张昇",
    "張法乾 张法乾",
    "彷彿 仿佛",
    "後梁乾化 后梁乾化",
    "徐胤昇 徐胤昇",
    "復甦 复苏",
    "徵弦 徵弦",
    "徵絃 徵弦",
    "徵羽摩柯 徵羽摩柯",
    "徵聲 徵声",
    "徵調 徵调",
    "徵音 徵音",
    "意志消沈 意志消沉",
    "憑藉 凭借",
    "憑藉着 凭借着",
    "懷釐 怀釐",
    "手鍊 手链",
    "打坏 打坯",
    "扞格 扞格",
    "扭轉乾坤 扭转乾坤",
    "批覆 批复",
    "找藉口 找借口",
    "折戟沈沙 折戟沉沙",
    "折戟沈河 折戟沉河",
    "拉坏 拉坯",
    "拉鍊 拉链",
    "拉鍊工程 拉链工程",
    "拜覆 拜复",
    "挨剋 挨剋",
    "捏坏 捏坯",
    "擊沈 击沉",
    "據瞭解 据了解",
    "於世成 於世成",
    "於乎 於乎",
    "於仲完 於仲完",
    "於倫 於伦",
    "於其一 於其一",
    "於則 於则",
    "於勇明 於勇明",
    "於呼哀哉 於呼哀哉",
    "於單 於单",
    "於坦 於坦",
    "於崇文 於崇文",
    "於忠祥 於忠祥",
    "於惟一 於惟一",
    "於戲 於戏",
    "於敖 於敖",
    "於梨華 於梨华",
    "於清言 於清言",
    "於潛 於潜",
    "於琳 於琳",
    "於穆 於穆",
    "於竹屋 於竹屋",
    "於菟 於菟",
    "於邑 於邑",
    "於陵子 於陵子",
    "旋乾轉坤 旋乾转坤",
    "旋轉乾坤 旋转乾坤",
    "旋轉乾坤之力 旋转乾坤之力",
    "明瞭 明了",
    "明覆 明复",
    "昏沈 昏沉",
    "春蒐 春蒐",
    "春釐 春釐",
    "暗沈沈 暗沉沉",
    "書中自有千鍾粟 书中自有千锺粟",
    "朝乾夕惕 朝乾夕惕",
    "木吒 木吒",
    "李乾德 李乾德",
    "李昇 李昇",
    "李昇勳 李昇勋",
    "李澤鉅 李泽钜",
    "李祕 李祕",
    "李鍊福 李链福",
    "李鍾郁 李锺郁",
    "束脩 束脩",
    "東氾 东氾",
    "梁乾化 梁乾化",
    "梁昇卿 梁昇卿",
    "梁章鉅 梁章钜",
    "楊聯陞 杨联陞",
    "樊於期 樊於期",
    "死氣沈沈 死气沉沉",
    "段脩 段脩",
    "毛坏 毛坯",
    "水逕 水迳",
    "氾勝之 氾胜之",
    "氾南 氾南",
    "氾國 氾国",
    "氾水 氾水",
    "沈下 沉下",
    "沈不住氣 沉不住气",
    "沈住氣 沉住气",
    "沈冤 沉冤",
    "沈厚 沉厚",
    "沈吟 沉吟",
    "沈寂 沉寂",
    "沈得住氣 沉得住气",
    "沈思 沉思",
    "沈思往事 沉思往事",
    "沈悶 沉闷",
    "沈沒 沉没",
    "沈沒成本 沉没成本",
    "沈浮 沉浮",
    "沈浸 沉浸",
    "沈浸於 沉浸于",
    "沈淪 沉沦",
    "沈湎 沉湎",
    "沈湎酒色 沉湎酒色",
    "沈溺 沉溺",
    "沈滯 沉滞",
    "沈滯性 沉滞性",
    "沈澱 沉淀",
    "沈澱出來 沉淀出来",
    "沈澱劑 沉淀剂",
    "沈澱法 沉淀法",
    "沈澱物 沉淀物",
    "沈濁 沉浊",
    "沈甸甸 沉甸甸",
    "沈痛 沉痛",
    "沈痼 沉痼",
    "沈痾 沉疴",
    "沈睡 沉睡",
    "沈睡不醒 沉睡不醒",
    "沈砂池 沉砂池",
    "沈積 沉积",
    "沈積岩 沉积岩",
    "沈積石 沉积石",
    "沈筒 沉筒",
    "沈船 沉船",
    "沈落 沉落",
    "沈迷 沉迷",
    "沈迷不醒 沉迷不醒",
    "沈醉 沉醉",
    "沈重 沉重",
    "沈降 沉降",
    "沈陷 沉陷",
    "沈靜 沉静",
    "沈靜下來 沉静下来",
    "沈香 沉香",
    "沈鬱 沉郁",
    "沈魚落雁 沉鱼落雁",
    "沈默 沉默",
    "沈默不語 沉默不语",
    "沈默寡言 沉默寡言",
    "沙逕 沙迳",
    "河逕 河迳",
    "流徵 流徵",
    "浪蕩乾坤 浪荡乾坤",
    "浮沈 浮沉",
    "海哩 海里",
    "深沈 深沉",
    "深沈不露 深沉不露",
    "溫昇豪 温昇豪",
    "滑藉 滑借",
    "烏昇 乌昇",
    "烏沈沈 乌沉沉",
    "烏逕 乌迳",
    "狐藉虎威 狐借虎威",
    "王彥昇 王彦昇",
    "珍珠項鍊 珍珠项链",
    "甚夥 甚夥",
    "甚鉅 甚钜",
    "甦生 苏生",
    "甦醒 苏醒",
    "申昇勳 申昇勋",
    "申覆 申复",
    "畢昇 毕昇",
    "盧象昇 卢象昇",
    "目劄 目劄",
    "瞭如 了如",
    "瞭如指掌 了如指掌",
    "瞭然 了然",
    "瞭然於心 了然于心",
    "瞭若指掌 了若指掌",
    "瞭解 了解",
    "瞭解到 了解到",
    "破釜沈舟 破釜沉舟",
    "磚坏 砖坯",
    "示覆 示复",
    "社逕 社迳",
    "祕丕笈 祕丕笈",
    "祕彭祖 祕彭祖",
    "祕瓊 祕琼",
    "祝釐 祝釐",
    "稟覆 禀复",
    "竺乾 竺乾",
    "答覆 答复",
    "篤麼 笃麽",
    "簡單明瞭 简单明了",
    "籌畫 筹划",
    "素藉 素借",
    "耳沈 耳沉",
    "肉脩 肉脩",
    "肘手鍊足 肘手链足",
    "胤祕 胤祕",
    "脩敬 脩敬",
    "脩炳 脩炳",
    "脩脡 脩脡",
    "脩脯 脩脯",
    "脩金 脩金",
    "脫坏 脱坯",
    "腶脩 腶脩",
    "英哩 英里",
    "茅蒐 茅蒐",
    "茵藉 茵借",
    "萬鍾 万锺",
    "落雁沈魚 落雁沉鱼",
    "蒐于紅 蒐于红",
    "蒐於紅 蒐于红",
    "蒐狩 蒐狩",
    "蒐獮 蒐狝",
    "蒐獵 蒐猎",
    "蒐田 蒐田",
    "蒐畋 蒐畋",
    "蒐苗 蒐苗",
    "蒜薹 蒜薹",
    "蔣昇 蒋昇",
    "蕓薹 芸薹",
    "蕭乾 萧乾",
    "藉代 借代",
    "藉以 借以",
    "藉助 借助",
    "藉助於 借助于",
    "藉卉 借卉",
    "藉口 借口",
    "藉喻 借喻",
    "藉寇兵 借寇兵",
    "藉寇兵齎盜糧 借寇兵赍盗粮",
    "藉手 借手",
    "藉據 借据",
    "藉故 借故",
    "藉故推辭 借故推辞",
    "藉方 借方",
    "藉條 借条",
    "藉槁 借槁",
    "藉機 借机",
    "藉此 借此",
    "藉此機會 借此机会",
    "藉甚 借甚",
    "藉由 借由",
    "藉着 借着",
    "藉端 借端",
    "藉端生事 借端生事",
    "藉箸代籌 借箸代筹",
    "藉草枕塊 借草枕块",
    "藉詞 借词",
    "藉讀 借读",
    "藉資 借资",
    "衹得 只得",
    "衹見樹木 只见树木",
    "衹見樹木不見森林 只见树木不见森林",
    "袁祕 袁祕",
    "袖裏乾坤 袖里乾坤",
    "袷袢 袷袢",
    "製坏 制坯",
    "覆信 复信",
    "覆呈 复呈",
    "覆命 复命",
    "覆墓 复墓",
    "覆帳 复帐",
    "覆按 复按",
    "覆文 复文",
    "覆校 复校",
    "覆電 复电",
    "見覆 见复",
    "角徵 角徵",
    "角徵羽 角徵羽",
    "計畫 计划",
    "變徵 变徵",
    "變徵之聲 变徵之声",
    "變徵之音 变徵之音",
    "谿工 谿工",
    "赤石逕 赤石迳",
    "踅門瞭戶 踅门了户",
    "躪藉 躏借",
    "載沈載浮 载沉载浮",
    "載浮載沈 载浮载沉",
    "辛祕 辛祕",
    "逆釐 逆釐",
    "逕口 迳口",
    "逕聯 迳联",
    "逕頭 迳头",
    "郭子乾 郭子乾",
    "酒逢知己千鍾少 酒逢知己千锺少",
    "醞藉 酝借",
    "重覆 重复",
    "金吒 金吒",
    "金昇玟 金昇玟",
    "金鍊 金链",
    "鈞覆 钧复",
    "鉅子 钜子",
    "鉅萬 钜万",
    "鉅防 钜防",
    "鉸鍊 铰链",
    "銀鍊 银链",
    "鋼坏 钢坯",
    "錢鍾書 钱锺书",
    "鍊墜 链坠",
    "鍊子 链子",
    "鍊形 链形",
    "鍊條 链条",
    "鍊錘 链锤",
    "鍊鎖 链锁",
    "鍛鍾 锻锺",
    "鍾繇 锺繇",
    "鍾萬梅 锺万梅",
    "鍾重發 锺重发",
    "鍾鍛 锺锻",
    "鍾馗 锺馗",
    "鎖鍊 锁链",
    "鐵鍊 铁链",
    "鑽石項鍊 钻石项链",
    "鑿坏 凿坯",
    "閻鶴昇 阎鹤昇",
    "陰沈 阴沉",
    "陰沈沈 阴沉沉",
    "陰陰沈沈 阴阴沉沉",
    "陳志昇 陈志昇",
    "陳昇 陈昇",
    "陶坏 陶坯",
    "雁杳魚沈 雁杳鱼沉",
    "電覆 电复",
    "韓昇延 韩昇延",
    "項鍊 项链",
    "頸鍊 颈链",
    "顛乾倒坤 颠乾倒坤",
    "顛倒乾坤 颠倒乾坤",
    "顧藉 顾借",
    "魏徵 魏徵",
    "魚沈雁杳 鱼沉雁杳",
    "麪坏兒 面坯儿",
    "麼些族 麽些族",
    "黃鍾公 黄锺公",
    "黑沈沈 黑沉沉",
    "龔昇 龚昇",
  ];

  const HAN = /[\u3400-\u9fff]/;
  const KANA = /[\u3040-\u30ff]/;
  // 常用繁体特征字（含港台歌词高频异体 妳 / 裏 / 爲 / 衞）。
  // 刻意不含 乾 / 著 / 藉 / 徵 / 祇 / 瞭 / 於 这类简体文本里也会出现的字，
  // 避免把简体歌词误判成繁体后改坏。
  const TRAD_HINT = /[這說們時為爲對來後裡裏國學愛聽聲讓誰覺邊過還開關點電話語詞寫讀書車馬鳥魚龍門問間陽陰雲風飛飯飲湯鹽醬麵髮鬆鬍鬥鐘錶週遊準製衝麼係個樣兒兩從會見現樂動嗎妳衞]/;

  let dict = null;

  function build() {
    if (dict) return dict;
    const characters = Object.create(null);
    for (let i = 0; i < TRAD.length; i += 1) characters[TRAD.charAt(i)] = SIMP.charAt(i);
    const byFirst = Object.create(null);
    for (let i = 0; i < PHRASES.length; i += 1) {
      const line = PHRASES[i];
      const at = line.indexOf(" ");
      const key = line.slice(0, at);
      const first = key.charAt(0);
      if (!byFirst[first]) byFirst[first] = [];
      byFirst[first].push([key, line.slice(at + 1)]);
    }
    // 长短语优先，否则「乾坤」会先于「乾坤大挪移」命中。
    for (const first in byFirst) {
      if (byFirst[first].length > 1) byFirst[first].sort((a, b) => b[0].length - a[0].length);
    }
    dict = { characters: characters, phrases: byFirst };
    return dict;
  }

  function isTraditional(value) {
    const text = Array.isArray(value) ? value.slice(0, 40).join("") : String(value || "");
    return !!text && TRAD_HINT.test(text) && !KANA.test(text);
  }

  function fold(value) {
    const text = String(value || "");
    if (!HAN.test(text)) return text;
    const table = build();
    let out = "";
    let i = 0;
    while (i < text.length) {
      const ch = text.charAt(i);
      const bucket = table.phrases[ch];
      let matched = null;
      if (bucket) {
        for (let j = 0; j < bucket.length; j += 1) {
          if (text.startsWith(bucket[j][0], i)) {
            matched = bucket[j][1];
            i += bucket[j][0].length;
            break;
          }
        }
      }
      if (matched !== null) {
        out += matched;
        continue;
      }
      out += table.characters[ch] || ch;
      i += 1;
    }
    return out;
  }

  // 只在判定为繁体时转换，简体 / 日文歌词原样返回。
  function toHans(value) {
    return isTraditional(value) ? fold(value) : String(value || "");
  }

  return { fold: fold, toHans: toHans, isTraditional: isTraditional };
})();

//======
// Spotify Names — 界面名称字形（Pathfinder JSON + spclient 列表 protobuf）
//
// 新版客户端里，歌单 / 专辑 / 歌手 / 搜索 / 资料库并不只走 metadata map：
//   - api-partner.spotify.com/pathfinder 是 GraphQL JSON
//   - spclient 的 playlist/v2、collection/v2、searchview、album/v2、
//     artist/v2、metadata/4/album|artist 等是 protobuf
// 这里统一把它们里面的名称转成简体。
//
// 只改「看起来是文本」的字段：能按 UTF-8 严格解码、且没有控制字符。
// 这样 URI / ID / 图片 / 二进制块不会被误改；含日文假名的文本整段跳过。
// fold() 繁→简保持 UTF-8 字节长度，所以 protobuf 可以原地重写，不用重排长度。
//======

(() => {
  "use strict";

  // 只接收一个参数：meta_script。Loon 传位置数组，Egern 传 env 对象，
  // 手写 JSON 参数时是字符串，三种都兼容。
  const raw = typeof $argument !== "undefined" ? $argument : undefined;
  let value = "";
  if (Array.isArray(raw)) {
    value = raw[0];
  } else if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw || "{}");
      value = parsed && parsed.meta_script;
    } catch (e) {
      value = "";
    }
  } else if (raw && "object" == typeof raw) {
    value = raw.meta_script;
  }
  const mode = value === undefined || value === null ? "" : String(value).trim().toLowerCase();
  const metaHans =
    mode === "hans" || mode === "simplified" || mode === "zh-hans" || mode === "true" || mode === "1";
  if (!metaHans || typeof SPOTIFY_HAN_VARIANTS === "undefined") {
    $done({});
    return;
  }

  const res = (typeof $response !== "undefined" && $response) || null;
  if (!res) {
    $done({});
    return;
  }

  // 统一拿字节：JSON 与 protobuf 都从字节判断。
  let bytes;
  const body = res.body;
  if (typeof body === "string") {
    bytes = WIRE_TEXT.encode(body);
  } else if (body instanceof ArrayBuffer) {
    bytes = new Uint8Array(body);
  } else if (body && body.buffer instanceof ArrayBuffer) {
    bytes = new Uint8Array(body.buffer, body.byteOffset || 0, body.byteLength);
  } else {
    $done({});
    return;
  }
  if (!bytes || !bytes.length || bytes.length > 12 * 1024 * 1024) {
    $done({});
    return;
  }

  const KANA = /[\u3040-\u30ff]/;
  const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

  function foldText(text) {
    if (!text || KANA.test(text)) return text;
    return SPOTIFY_HAN_VARIANTS.fold(text);
  }

  // ---------------- JSON（Pathfinder / playlist attributes） ----------------
  // 只改名称类字段，避免碰描述、简介、HTML 等其它文本。
  const NAME_KEY = /^(?:name|title)$|(?:Name|Title)$/;
  const SKIP_KEY = { uri: 1, url: 1, id: 1, shareUrl: 1, image: 1, src: 1, href: 1 };

  function walkJson(node) {
    if (!node || "object" != typeof node) return false;
    let changed = false;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i += 1) {
        if (walkJson(node[i])) changed = true;
      }
      return changed;
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (typeof val === "string") {
        if (SKIP_KEY[key] || !NAME_KEY.test(key)) continue;
        const next = foldText(val);
        if (next !== val) {
          node[key] = next;
          changed = true;
        }
      } else if (val && "object" == typeof val) {
        if (walkJson(val)) changed = true;
      }
    }
    return changed;
  }

  const asJson = () => {
    const text = new TextDecoder("utf-8").decode(bytes);
    const trimmed = text.replace(/^[\s\uFEFF]+/, "");
    if (!trimmed || (trimmed.charAt(0) !== "{" && trimmed.charAt(0) !== "[")) return null;
    try {
      return JSON.parse(text);
    } catch (e) {
      return null;
    }
  };

  const isJsonUrl = /\/pathfinder\//.test(res.url || (typeof $request !== "undefined" && $request && $request.url) || "");
  const json = asJson();
  if (json) {
    if (walkJson(json)) $done({ body: JSON.stringify(json) });
    else $done({});
    return;
  }
  if (isJsonUrl) {
    // pathfinder 只处理 JSON；解析失败（gzip / zstd 未解压）原样放行。
    $done({});
    return;
  }

  // ---------------- protobuf（spclient 列表 / 实体） ----------------
  const fields = parse(bytes);
  if (!fields || !allCanonical(fields)) {
    $done({});
    return;
  }

  // 严格 UTF-8 且无控制字符才当作文本；URI / ID / 图片 / 二进制都不会命中。
  function asText(payload) {
    let text;
    try {
      text = WIRE_UTF8.decode(payload);
    } catch (e) {
      return null;
    }
    if (!text || CONTROL.test(text)) return null;
    return text;
  }

  function foldFields(list) {
    let changed = false;
    for (const f of list) {
      if (f.w !== 2 || !f.p || !f.p.length) continue;
      const text = asText(f.p);
      if (text !== null) {
        const next = foldText(text);
        if (next === text) continue;
        const encoded = WIRE_TEXT.encode(next);
        // 理论上等长；万一不等就跳过，绝不改写长度字段。
        if (encoded.length !== f.p.length) continue;
        f.p = encoded;
        changed = true;
        continue;
      }
      const sub = parse(f.p);
      if (sub && foldFields(sub)) {
        f.p = serialize(sub);
        changed = true;
      }
    }
    return changed;
  }

  if (!foldFields(fields)) {
    $done({});
    return;
  }
  $done({ body: serialize(fields) });
})();

})();
