  //=====================================================================================
  // §10 UMP
  //
  // initplayback 的响应是分片容器：type 10 是明文头，type 11 是加密体。
  // 加密体用 AES-256-CBC + HMAC-SHA256，密钥来自 config/log_event 里的 clientKey。
  // 这里解密 -> 按 schema 改写 -> 重新加密，只动被改过的分片。
  //=====================================================================================

  // 读 UMP 分片头（可变长前缀编码，不是标准 varint）。
  class UmpReader {
    constructor(buffer) {
      this.buffer = buffer;
      this.offset = 0;
    }

    readByte() {
      if (this.offset >= this.buffer.length) throw new Error("Truncated UMP header");
      return this.buffer[this.offset++];
    }

    readVarint() {
      const first = this.readByte();
      let width = 5;
      for (let i = 1; i < 5; i++) {
        if (!(first & (128 >> (i - 1)))) {
          width = i;
          break;
        }
      }
      let shift = 5 === width ? 0 : 8 - width;
      let value = 5 === width ? 0 : first & ((1 << shift) - 1);
      for (let i = 1; i < width; i++, shift += 8) value += this.readByte() * 2 ** shift;
      return value;
    }

    readPart() {
      const start = this.offset;
      const type = this.readVarint();
      const length = this.readVarint();
      if (length > this.buffer.length - this.offset) {
        throw new Error(`Truncated UMP payload: type=${type}, offset=${this.offset}, expected=${length}, available=${this.buffer.length - this.offset}`);
      }
      const data = this.buffer.subarray(this.offset, this.offset + length);
      this.offset += length;
      return { type, data, originalData: data, raw: this.buffer.subarray(start, this.offset) };
    }

    get hasNext() {
      return this.offset < this.buffer.length;
    }
  }

  class UmpWriter {
    constructor(size = 1024) {
      this.buffer = new Uint8Array(size);
      this.length = 0;
    }

    ensureCapacity(extra) {
      if (this.length + extra <= this.buffer.length) return;
      const grown = new Uint8Array(Math.max(2 * this.buffer.length, this.length + extra));
      grown.set(this.buffer);
      this.buffer = grown;
    }

    writeByte(byte) {
      this.ensureCapacity(1);
      this.buffer[this.length++] = 255 & byte;
    }

    writeVarint(value) {
      if (!Number.isInteger(value) || value < 0 || value > 4294967295) throw new Error("Invalid UMP integer");
      const width = value < 128 ? 1 : value < 16384 ? 2 : value < 2097152 ? 3 : value < 268435456 ? 4 : 5;
      if (1 === width) return this.writeByte(value);
      5 === width ? this.writeByte(240) : this.writeByte((256 - (256 >> (width - 1))) | (value & ((1 << (8 - width)) - 1)));
      for (let i = 1, shift = 5 === width ? 0 : 8 - width; i < width; i++, shift += 8) this.writeByte(Math.floor(value / 2 ** shift));
    }

    writePart({ type, data }) {
      this.writeVarint(type);
      this.writeVarint(data.length);
      this.ensureCapacity(data.length);
      this.buffer.set(data, this.length);
      this.length += data.length;
    }

    finish() {
      return this.buffer.subarray(0, this.length);
    }
  }

  async function gzipStream(bytes, decompress) {
    const stream = decompress ? new DecompressionStream("gzip") : new CompressionStream("gzip");
    const reader = stream.readable.getReader();
    const writer = stream.writable.getWriter();

    const collected = (async () => {
      const chunks = [];
      let total = 0;
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (decompress && total > 16777216) throw new Error("UMP decompression exceeds 16 MiB");
        chunks.push(value);
      }
      return concatBytes(chunks);
    })();
    const written = (async () => {
      await writer.write(bytes);
      await writer.close();
    })();

    try {
      return (await Promise.all([collected, written]))[0];
    } catch (e) {
      await Promise.allSettled([reader.cancel(e), writer.abort(e)]);
      throw e;
    } finally {
      reader.releaseLock();
      writer.releaseLock();
    }
  }

  // ---- 内联的 @noble/ciphers + @noble/hashes（MIT，版权与许可见下方注释）----
  function createUmpCrypto() {
    /*
    Third-party components bundled below use the MIT License.

    @noble/ciphers
    Copyright (c) 2022 Paul Miller (https://paulmillr.com)
    Copyright (c) 2016 Thomas Pornin <pornin@bolet.org>

    @noble/hashes
    Copyright (c) 2022 Paul Miller (https://paulmillr.com)

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE.
    */
    return (function () {
    function g(g, ...I) {
      if (!(
        g instanceof Uint8Array ||
        (ArrayBuffer.isView(g) && "Uint8Array" === g.constructor.name)
      ))
        throw new Error("Uint8Array expected");
      if (I.length && !I.includes(g.length)) throw new Error("Invalid byte length: " + g.length);
    }
    function I(g) {
      return new Uint32Array(g.buffer, g.byteOffset, Math.floor(g.byteLength / 4));
    }
    function A(...g) {
      for (const I of g) I.fill(0);
    }
    function C(g) {
      return g.byteOffset % 4 == 0;
    }
    function E(g) {
      return Uint8Array.from(g);
    }
    if (68 !== new Uint8Array(new Uint32Array([287454020]).buffer)[0])
      throw new Error("Non little-endian hardware is not yet supported");
    function o(g) {
      return (g << 1) ^ (283 & -(g >> 7));
    }
    function e(g, I) {
      let A = 0;
      for (; I > 0; I >>= 1) ((A ^= g & -(1 & I)), (g = o(g)));
      return A;
    }
    var B = (g) => (g << 24) | (g >>> 8),
      t = (g) => (g << 8) | (g >>> 24);
    function n(g, I) {
      if (256 !== g.length) throw new Error("Wrong sbox length");
      let A = new Uint32Array(256).map((A, C) => I(g[C])),
        C = A.map(t),
        E = C.map(t),
        o = E.map(t),
        e = new Uint32Array(65536),
        B = new Uint32Array(65536),
        n = new Uint16Array(65536);
      for (let I = 0; I < 256; I++)
        for (let t = 0; t < 256; t++) {
          let S = 256 * I + t;
          ((e[S] = A[I] ^ C[t]), (B[S] = E[I] ^ o[t]), (n[S] = (g[I] << 8) | g[t]));
        }
      return { sbox2: n, T01: e, T23: B };
    }
    var S = n(
        (() => {
          let g = new Uint8Array(256);
          for (let I = 0, A = 1; I < 256; I++, A ^= o(A)) g[I] = A;
          let I = new Uint8Array(256);
          I[0] = 99;
          for (let A = 0; A < 255; A++) {
            let C = g[255 - A];
            ((C |= C << 8), (I[g[A]] = 255 & (C ^ (C >> 4) ^ (C >> 5) ^ (C >> 6) ^ (C >> 7) ^ 99)));
          }
          return (A(g), I);
        })(),
        (g) => (e(g, 3) << 24) | (g << 16) | (g << 8) | e(g, 2),
      ),
      i = (() => {
        let g = new Uint8Array(16);
        for (let I = 0, A = 1; I < 16; I++, A = o(A)) g[I] = A;
        return g;
      })();
    function r(g, I, A, C, E, o) {
      return g[((A << 8) & 65280) | ((C >>> 8) & 255)] ^ I[((E >>> 8) & 65280) | ((o >>> 24) & 255)];
    }
    function h(g, I, A, C, E) {
      return g[(255 & I) | (65280 & A)] | (g[((C >>> 16) & 255) | ((E >>> 16) & 65280)] << 16);
    }
    function a(g, I, A, C, E) {
      let { sbox2: o, T01: e, T23: B } = S,
        t = 0;
      ((I ^= g[t++]), (A ^= g[t++]), (C ^= g[t++]), (E ^= g[t++]));
      let n = g.length / 4 - 2;
      for (let o = 0; o < n; o++) {
        let o = g[t++] ^ r(e, B, I, A, C, E),
          n = g[t++] ^ r(e, B, A, C, E, I),
          S = g[t++] ^ r(e, B, C, E, I, A),
          i = g[t++] ^ r(e, B, E, I, A, C);
        ((I = o), (A = n), (C = S), (E = i));
      }
      return {
        s0: g[t++] ^ h(o, I, A, C, E),
        s1: g[t++] ^ h(o, A, C, E, I),
        s2: g[t++] ^ h(o, C, E, I, A),
        s3: g[t++] ^ h(o, E, I, A, C),
      };
    }
    function K(o, e, B) {
      const t = E(e),
        n = C(B) ? B : E(B);
      try {
        return (function (C, E, o) {
          (g(E, 16), g(o));
          let e = o.length;
          const B = new Uint8Array(e);
          let t = E,
            n = I(t),
            { s0: S, s1: i, s2: r, s3: h } = a(C, n[0], n[1], n[2], n[3]),
            K = I(o),
            s = I(B);
          for (let g = 0; g + 4 <= K.length; g += 4) {
            ((s[g + 0] = K[g + 0] ^ S),
              (s[g + 1] = K[g + 1] ^ i),
              (s[g + 2] = K[g + 2] ^ r),
              (s[g + 3] = K[g + 3] ^ h));
            let I = 1;
            for (let g = t.length - 1; g >= 0; g--)
              ((I = (I + (255 & t[g])) | 0), (t[g] = 255 & I), (I >>>= 8));
            ({ s0: S, s1: i, s2: r, s3: h } = a(C, n[0], n[1], n[2], n[3]));
          }
          let c = 16 * Math.floor(K.length / 4);
          if (c < e) {
            let g = new Uint32Array([S, i, r, h]),
              I = new Uint8Array(g.buffer);
            for (let g = c, A = 0; g < e; g++, A++) B[g] = o[g] ^ I[A];
            A(g);
          }
          return B;
        })(o, t, n);
      } finally {
        (A(t), n !== B && A(n));
      }
    }
    function s(g) {
      return new DataView(g.buffer, g.byteOffset, g.byteLength);
    }
    function c(g, I) {
      return (g << (32 - I)) | (g >>> I);
    }
    function Q(g, I, A) {
      return (g & I) ^ (~g & A);
    }
    function w(g, I, A) {
      return (g & I) ^ (g & A) ^ (I & A);
    }
    const l = Uint32Array.from([
      1779033703, 3144134277, 1013904242, 2773480762, 1359893119, 2600822924, 528734635, 1541459225,
    ]);
    var R = Uint32Array.from([
        1116352408, 1899447441, 3049323471, 3921009573, 961987163, 1508970993, 2453635748, 2870763221,
        3624381080, 310598401, 607225278, 1426881987, 1925078388, 2162078206, 2614888103, 3248222580,
        3835390401, 4022224774, 264347078, 604807628, 770255983, 1249150122, 1555081692, 1996064986,
        2554220882, 2821834349, 2952996808, 3210313671, 3336571891, 3584528711, 113926993, 338241895,
        666307205, 773529912, 1294757372, 1396182291, 1695183700, 1986661051, 2177026350, 2456956037,
        2730485921, 2820302411, 3259730800, 3345764771, 3516065817, 3600352804, 4094571909, 275423344,
        430227734, 506948616, 659060556, 883997877, 958139571, 1322822218, 1537002063, 1747873779,
        1955562222, 2024104815, 2227730452, 2361852424, 2428436474, 2756734187, 3204031479,
        3329325298,
      ]),
      M = new Uint32Array(64),
      G = class {
        constructor() {
          ((this.length = 0),
            (this.pos = 0),
            (this.buffer = new Uint8Array(64)),
            (this.view = s(this.buffer)),
            this.set(l[0], l[1], l[2], l[3], l[4], l[5], l[6], l[7]));
        }
        update(g) {
          const { view: I, buffer: C } = this,
            E = g.length;
          for (let A = 0; A < E;) {
            const o = Math.min(64 - this.pos, E - A);
            if (64 === o) {
              const I = s(g);
              for (; 64 <= E - A; A += 64) this.process(I, A);
              continue;
            }
            (C.set(g.subarray(A, A + o), this.pos),
              (this.pos += o),
              (A += o),
              64 === this.pos && (this.process(I, 0), (this.pos = 0)));
          }
          return ((this.length += g.length), A(M), this);
        }
        digest() {
          const { buffer: g, view: I, pos: C } = this;
          ((g[C] = 128),
            g.fill(0, C + 1),
            C >= 56 && (this.process(I, 0), g.fill(0)),
            I.setBigUint64(56, BigInt(8 * this.length), !1),
            this.process(I, 0));
          const E = new Uint8Array(32),
            o = s(E),
            { A: e, B, C: t, D: n, E: S, F: i, G: r, H: h } = this,
            a = [e, B, t, n, S, i, r, h];
          for (let g = 0; g < 8; g++) o.setUint32(4 * g, a[g], !1);
          return (this.set(0, 0, 0, 0, 0, 0, 0, 0), A(g), E);
        }
        set(g, I, A, C, E, o, e, B) {
          ((this.A = 0 | g),
            (this.B = 0 | I),
            (this.C = 0 | A),
            (this.D = 0 | C),
            (this.E = 0 | E),
            (this.F = 0 | o),
            (this.G = 0 | e),
            (this.H = 0 | B));
        }
        process(g, I) {
          for (let A = 0; A < 16; A++, I += 4) M[A] = g.getUint32(I, !1);
          for (let g = 16; g < 64; g++) {
            let I = M[g - 15],
              A = M[g - 2],
              C = c(I, 7) ^ c(I, 18) ^ (I >>> 3),
              E = c(A, 17) ^ c(A, 19) ^ (A >>> 10);
            M[g] = (E + M[g - 7] + C + M[g - 16]) | 0;
          }
          let { A, B: C, C: E, D: o, E: e, F: B, G: t, H: n } = this;
          for (let g = 0; g < 64; g++) {
            let I = (n + (c(e, 6) ^ c(e, 11) ^ c(e, 25)) + Q(e, B, t) + R[g] + M[g]) | 0,
              S = ((c(A, 2) ^ c(A, 13) ^ c(A, 22)) + w(A, C, E)) | 0;
            ((n = t),
              (t = B),
              (B = e),
              (e = (o + I) | 0),
              (o = E),
              (E = C),
              (C = A),
              (A = (I + S) | 0));
          }
          ((A = (A + this.A) | 0),
            (C = (C + this.B) | 0),
            (E = (E + this.C) | 0),
            (o = (o + this.D) | 0),
            (e = (e + this.E) | 0),
            (B = (B + this.F) | 0),
            (t = (t + this.G) | 0),
            (n = (n + this.H) | 0),
            this.set(A, C, E, o, e, B, t, n));
        }
      };
    return {
      CryptoContext: class {
        constructor(o) {
          ((this.expandedKey = (function (o) {
            g(o);
            let e = o.length;
            if (![16, 24, 32].includes(e))
              throw new Error("aes: invalid key size, should be 16, 24 or 32, got " + e);
            let { sbox2: t } = S,
              n = [];
            C(o) || n.push((o = E(o)));
            let r = I(o),
              a = r.length,
              K = (g) => h(t, g, g, g, g),
              s = new Uint32Array(e + 28);
            s.set(r);
            for (let g = a; g < s.length; g++) {
              let I = s[g - 1];
              (g % a === 0 ? (I = K(B(I)) ^ i[g / a - 1]) : a > 6 && g % a === 4 && (I = K(I)),
                (s[g] = s[g - a] ^ I));
            }
            return (A(...n), s);
          })(o.slice(0, 16))),
            (this.hmacKey = o.slice(16)));
        }
        signature(g) {
          const I = new Uint8Array(64);
          I.set(this.hmacKey.length > 64 ? new G().update(this.hmacKey).digest() : this.hmacKey);
          for (let g = 0; g < I.length; g++) I[g] ^= 54;
          const C = new G().update(I).update(g).update(this.iv).digest();
          for (let g = 0; g < I.length; g++) I[g] ^= 106;
          const E = new G().update(I).update(C).digest();
          return (A(I, C), E);
        }
        decrypt(g) {
          if (
            ((this.iv = g.iv),
            !(function (g, I) {
              if (g.length !== I.length) return !1;
              let A = 0;
              for (let C = 0; C < g.length; C++) A |= g[C] ^ I[C];
              return 0 === A;
            })(this.signature(g.encryptedContent), g.hmac))
          )
            throw new Error("HMAC verification failed");
          return K(this.expandedKey, this.iv, g.encryptedContent);
        }
        encrypt(g) {
          const I = K(this.expandedKey, this.iv, g);
          return { encryptedContent: I, hmac: this.signature(I) };
        }
      },
    };
  })();
  }

  async function decryptUmp(body, options, keys) {
    let contexts;
    const EncryptedPart = messageCodec("EncryptedResponsePart", EAGER_TYPES.ump);
    const Onesie = messageCodec("OnesieInnertubeResponse", EAGER_TYPES.ump);
    const reader = new UmpReader(body);
    const out = [];
    const players = [];
    let changed = false;
    let expectingEncrypted = false;

    async function processPart(partBytes) {
      const envelope = EncryptedPart.fromBinary(partBytes);
      if (!(envelope.encryptedContent instanceof Uint8Array) || 16 !== envelope.iv?.length || 32 !== envelope.hmac?.length) {
        throw new Error("Malformed encrypted UMP envelope");
      }
      if ((envelope.compressionAlgorithm ?? 0) > 1) throw new Error("Unsupported UMP compression");

      if (!contexts) {
        const { CryptoContext } = createUmpCrypto();
        contexts = keys.map((key) => new CryptoContext(key));
      }

      let plaintext;
      let context;
      for (const candidate of contexts) {
        try {
          plaintext = candidate.decrypt(envelope);
          context = candidate;
          break;
        } catch (e) {
          if ("HMAC verification failed" !== e.message) throw e;
        }
      }
      if (!plaintext || !context) throw new Error("HMAC verification failed");

      const isGzip = 31 === plaintext[0] && 139 === plaintext[1];
      if (1 === envelope.compressionAlgorithm && !isGzip) throw new Error("Invalid UMP gzip payload");

      const decoded = isGzip ? await gzipStream(plaintext, true) : plaintext;
      const response = Onesie.fromBinary(decoded);

      if (false !== options.autoHd) {
        for (const item of response.contents) if (item.player) players.push(item.player);
      }

      const modified = (function (node, opts) {
        let result = false;
        for (const item of node.contents) {
          if (item.player) result = rewritePlayer(item.player, opts) || result;
          if (item.next) result = filterBrowseTree(item.next, opts) || result;
        }
        return result;
      })(response, options);
      if (!modified) return partBytes;

      const reencoded = Onesie.toBinary(response);
      if (bytesEqual(reencoded, decoded)) return partBytes;

      const recompressed = isGzip ? await gzipStream(reencoded, false) : reencoded;
      const encrypted = context.encrypt(recompressed);
      setField(envelope, "encryptedContent", encrypted.encryptedContent);
      setField(envelope, "hmac", encrypted.hmac);
      return EncryptedPart.toBinary(envelope);
    }

    for (; reader.hasNext; ) {
      const part = reader.readPart();
      if (10 === part.type) {
        const marker = parseFields(part.data).find((field) => 1 === field.no && 0 === field.wire);
        expectingEncrypted = !!marker && 25 === readVarintValue(marker.data);
      } else if (11 === part.type && expectingEncrypted) {
        part.data = await processPart(part.data);
        expectingEncrypted = false;
      }

      if (part.data === part.originalData) {
        out.push(part.raw);
      } else {
        changed = true;
        const writer = new UmpWriter(part.data.length + 10);
        writer.writePart(part);
        out.push(writer.finish());
      }
    }

    return { body: changed ? concatBytes(out) : body, players };
  }
