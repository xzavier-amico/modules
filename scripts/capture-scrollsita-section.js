// 临时抓包脚本：从 scrollsita 响应里取出 lyrics section（含 field 5 的 section）模板。
// 只读，不改响应。命中后把整段 section 以 hex 打到 Loon 日志，前缀 LYRICS_SECTION_HEX=。
//
// Loon 规则（临时，测完删除）：
//   response if ${url} ~= /scrollsita\/v\d\/scroll\//i then script("<本文件地址>", {}) with requires_body=true, binary_body_mode=true, tag="spotify.capture", timeout=10
(() => {
  "use strict";

  const res = typeof $response !== "undefined" ? $response : null;
  const url = (res && res.url) || "";

  function toBytes(value) {
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (value && ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return new Uint8Array(0);
  }

  function readVarint(bytes, pos) {
    let value = 0;
    let shift = 0;
    while (pos < bytes.length) {
      const byte = bytes[pos];
      value += (byte & 0x7f) * Math.pow(2, shift);
      pos += 1;
      if ((byte & 0x80) === 0) return { value: value, next: pos };
      shift += 7;
      if (shift > 63) break;
    }
    return { value: 0, next: -1 };
  }

  // 返回 [{ no, wire, raw, payload }]，payload 只对 wire=2 有效。
  function fields(bytes) {
    const out = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = pos;
      const key = readVarint(bytes, pos);
      if (key.next < 0 || key.value < 8) throw new Error("key");
      const no = Math.floor(key.value / 8);
      const wire = key.value % 8;
      if (wire === 0) {
        const v = readVarint(bytes, key.next);
        if (v.next < 0) throw new Error("varint");
        pos = v.next;
        out.push({ no: no, wire: 0, raw: bytes.subarray(start, pos) });
      } else if (wire === 2) {
        const len = readVarint(bytes, key.next);
        if (len.next < 0 || len.value > bytes.length - len.next) throw new Error("length");
        pos = len.next + len.value;
        out.push({ no: no, wire: 2, raw: bytes.subarray(start, pos), payload: bytes.subarray(len.next, pos) });
      } else if (wire === 5) {
        pos = key.next + 4;
        out.push({ no: no, wire: 5, raw: bytes.subarray(start, pos) });
      } else if (wire === 1) {
        pos = key.next + 8;
        out.push({ no: no, wire: 1, raw: bytes.subarray(start, pos) });
      } else {
        throw new Error("wire " + wire);
      }
      if (pos > bytes.length) throw new Error("truncated");
    }
    return out;
  }

  function hex(bytes) {
    let out = "";
    for (let i = 0; i < bytes.length; i += 1) out += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
    return out;
  }

  try {
    if (!res || url.indexOf("/scrollsita/") < 0) { $done({}); return; }
    const body = toBytes(res.body);
    const top = fields(body);
    const structure = top.find((f) => f.no === 1 && f.wire === 2);
    if (!structure) { console.log("LYRICS_CAPTURE: no top-level field 1"); $done({}); return; }

    const sections = fields(structure.payload).filter((f) => f.no === 1 && f.wire === 2);
    console.log("LYRICS_CAPTURE: sections=" + sections.length + " bytes=" + body.length + " url=" + url);

    for (const section of sections) {
      let inside;
      try { inside = fields(section.payload); } catch (e) { continue; }
      if (!inside.some((f) => f.no === 5 && f.wire === 2)) continue;
      console.log("LYRICS_SECTION_HEX=" + hex(section.raw));
      $done({});
      return;
    }

    console.log("LYRICS_CAPTURE: this list has no lyrics section (pick a track with official lyrics)");
    $done({});
  } catch (e) {
    console.log("LYRICS_CAPTURE: error " + e.message);
    $done({});
  }
})();
