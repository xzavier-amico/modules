import test from "node:test";
import assert from "node:assert/strict";

import { createPatcher } from "../src/patcher.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const patcher = createPatcher();

function concat(parts) {
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

function varint(value) {
  const out = [];
  let v = value;
  do {
    let byte = v % 128;
    v = Math.floor(v / 128);
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Uint8Array.from(out);
}

function field(no, wire, payload) {
  const key = varint(no * 8 + wire);
  if (wire === 0) return concat([key, varint(payload)]);
  return concat([key, varint(payload.length), payload]);
}

const vi = (no, value) => field(no, 0, value);
const bytes = (no, payload) => field(no, 2, payload);
const str = (no, value) => bytes(no, encoder.encode(value));

function varintBig(value) {
  const out = [];
  let v = BigInt(value);
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v) byte |= 0x80;
    out.push(byte);
  } while (v);
  return Uint8Array.from(out);
}

const viBig = (no, value) => concat([varint(no * 8), varintBig(value)]);

function attribute(key, value) {
  const inner = typeof value === "string" ? str(4, value) : vi(2, value ? 1 : 0);
  const entry = concat([str(1, key), bytes(2, inner)]);
  return bytes(1, entry);
}

const ucs = (...entries) => bytes(3, concat(entries));
const customize = (message) => bytes(1, message);
const bootstrap = (message) => bytes(2, bytes(1, bytes(1, bytes(1, message))));

function walkMessages(buffer, visit) {
  const fields = patcher.parse(buffer);
  if (!fields) return null;
  const hit = visit(buffer, fields);
  if (hit) return hit;
  for (const f of fields) {
    if (f.w !== 2) continue;
    const found = walkMessages(f.p, visit);
    if (found) return found;
  }
  return null;
}

function findUcs(buffer) {
  return walkMessages(buffer, (candidate, fields) => {
    if (!patcher.looksLikeUcs(candidate)) return null;
    const attributes = fields.find((f) => f.no === 3 && f.w === 2);
    return attributes ? candidate : null;
  });
}

function readAttributes(buffer) {
  const message = findUcs(buffer);
  assert.ok(message, "UCS message not found");
  const fields = patcher.parse(message);
  const attributes = fields.find((f) => f.no === 3 && f.w === 2);
  const entries = patcher.parse(attributes.p);
  const out = Object.create(null);
  for (const entry of entries) {
    if (entry.no !== 1 || entry.w !== 2) continue;
    const pair = patcher.parse(entry.p);
    const keyField = pair.find((f) => f.no === 1 && f.w === 2);
    const valueField = pair.find((f) => f.no === 2 && f.w === 2);
    if (!keyField || !valueField) continue;
    const key = decoder.decode(keyField.p);
    const value = patcher.parse(valueField.p) || [];
    const text = value.find((f) => f.no === 4 && f.w === 2);
    const boolean = value.find((f) => f.no === 2 && f.w === 0);
    out[key] = text ? decoder.decode(text.p) : boolean ? boolean.v === 1n : false;
  }
  return out;
}

test("serialize(parse(x)) keeps unknown fields byte for byte", () => {
  const input = concat([vi(99, 300), str(7, "hé"), bytes(8, concat([vi(1, 1)]))]);
  const parsed = patcher.parse(input);
  assert.ok(parsed);
  assert.deepEqual(patcher.serialize(parsed), input);
});

test("malformed protobuf is rejected instead of rewritten", () => {
  const broken = Uint8Array.from([0xff]);
  assert.equal(patcher.parse(broken), null);
  assert.equal(patcher.patchBootstrap(broken), null);
  assert.equal(patcher.patchCustomize(broken), null);
  assert.equal(patcher.stripRequestEtags(broken), null);
});

test("user-customization-service becomes premium and ads are disabled", () => {
  const input = customize(ucs(attribute("name", "Free"), attribute("ads", true)));
  const patched = patcher.patchCustomize(input);
  assert.ok(patched);

  const attrs = readAttributes(patched);
  assert.equal(attrs.name, "Spotify Premium");
  assert.equal(attrs.catalogue, "premium");
  assert.equal(attrs.type, "premium");
  assert.equal(attrs.product, undefined);
  assert.equal(attrs.ads, false);
  assert.equal(attrs["player-license"], "premium");
  assert.equal(attrs.unrestricted, true);
  assert.equal(attrs["ab-ad-player-targeting"], "0");
});

test("desktop patcher defaults to display-only attributes", () => {
  const desk = createPatcher({ desktop: true });
  const input = customize(ucs(attribute("name", "Free"), attribute("ads", true)));
  const attrs = readAttributes(desk.patchCustomize(input));
  assert.equal(attrs.name, "Spotify Premium");
  assert.equal(attrs.catalogue, "premium");
  assert.equal(attrs.ads, false);
  assert.equal(attrs["player-license"], undefined);
  assert.equal(attrs["streaming-rules"], undefined);
});

test("patchCustomize is a no-op when every switch is off", () => {
  const off = createPatcher({
    spoofPremium: false,
    blockAds: false,
    unlockPlayback: false,
  });
  const input = customize(ucs(attribute("name", "Free"), attribute("ads", true)));
  const patched = off.patchCustomize(input);
  const attrs = readAttributes(patched);
  assert.equal(attrs.name, "Free");
  assert.equal(attrs.ads, true);
});

test("bootstrap reaches the nested UcsResponse", () => {
  const input = bootstrap(ucs(attribute("name", "Free"), attribute("ads", true)));
  const patched = patcher.patchBootstrap(input);
  assert.ok(patched);

  const attrs = readAttributes(patched);
  assert.equal(attrs.name, "Spotify Premium");
  assert.equal(attrs.catalogue, "premium");
  assert.equal(attrs.ads, false);
});

test("bootstrap with an unknown shape is left alone", () => {
  assert.equal(patcher.patchBootstrap(str(1, "not a bootstrap")), null);
});

test("looksLikeUcs accepts account attributes and rejects lookalikes", () => {
  assert.equal(patcher.looksLikeUcs(ucs(attribute("name", "Free"))), true);

  const lookalike = bytes(3, bytes(1, concat([str(1, "identifier"), str(2, "name")])));
  assert.equal(patcher.looksLikeUcs(lookalike), false);
});

test("patched Track preserves 64-bit varint fields", () => {
  const big = (1n << 60n) + 123n;
  const track = concat([str(1, "Song"), viBig(99, big), vi(18, 0)]);
  const any = concat([
    str(1, "type.googleapis.com/spotify.metadata.Track"),
    bytes(2, track),
  ]);
  const entity = concat([str(2, "spotify:track:abc"), bytes(3, any)]);
  const input = bytes(1, concat([vi(2, 4), bytes(3, entity)]));

  const patched = patcher.patchMeta(input, "/extended-metadata/v0/extended-metadata");
  assert.ok(patched);
  const top = patcher.parse(patched);
  const arrayFields = patcher.parse(top.find((f) => f.no === 1).p);
  const entityFields = patcher.parse(arrayFields.find((f) => f.no === 3).p);
  const anyFields = patcher.parse(entityFields.find((f) => f.no === 3).p);
  const trackFields = patcher.parse(anyFields.find((f) => f.no === 2).p);
  assert.equal(trackFields.find((f) => f.no === 99).v, big);
  assert.equal(trackFields.find((f) => f.no === 18).v, 1n);
});

test("extended-metadata Track gains has_lyrics = 18", () => {
  const track = concat([str(1, "Song"), str(2, "Artist")]);
  const any = concat([
    str(1, "type.googleapis.com/spotify.metadata.Track"),
    bytes(2, track),
  ]);
  const entity = concat([str(2, "spotify:track:abc"), bytes(3, any)]);
  const array = concat([vi(2, 4), bytes(3, entity)]);
  const input = bytes(1, array);

  const patched = patcher.patchMeta(input, "/extended-metadata/v0/extended-metadata");
  assert.ok(patched);

  const top = patcher.parse(patched);
  const arrayFields = patcher.parse(top.find((f) => f.no === 1).p);
  const entityFields = patcher.parse(arrayFields.find((f) => f.no === 3).p);
  const anyFields = patcher.parse(entityFields.find((f) => f.no === 3).p);
  const trackFields = patcher.parse(anyFields.find((f) => f.no === 2).p);
  const hasLyrics = trackFields.find((f) => f.no === 18);
  assert.ok(hasLyrics);
  assert.equal(hasLyrics.w, 0);
  assert.equal(hasLyrics.v, 1n);
});

test("context track without has_lyrics gets the metadata entry", () => {
  const contextTrack = concat([
    str(1, "spotify:track:xyz"),
    bytes(2, Uint8Array.from([1])),
    bytes(3, concat([str(1, "track_title"), str(2, "Song")])),
  ]);
  const input = bytes(1, contextTrack);

  const patched = patcher.patchMeta(input, "/context-resolve/v1/context-resolve");
  assert.ok(patched);

  const top = patcher.parse(patched);
  const trackFields = patcher.parse(top.find((f) => f.no === 1).p);
  const entries = trackFields
    .filter((f) => f.no === 3 && f.w === 2)
    .map((f) => {
      const pair = patcher.parse(f.p);
      return [decoder.decode(pair.find((x) => x.no === 1).p), decoder.decode(pair.find((x) => x.no === 2).p)];
    });
  assert.ok(entries.some(([key, value]) => key === "has_lyrics" && value === "true"));
});

test("already-true context track is not rewritten a second time", () => {
  const contextTrack = concat([
    str(1, "spotify:track:xyz"),
    bytes(2, Uint8Array.from([1])),
    bytes(3, concat([str(1, "track_title"), str(2, "Song")])),
    bytes(3, concat([str(1, "has_lyrics"), str(2, "true")])),
  ]);
  assert.equal(patcher.patchMeta(bytes(1, contextTrack), "/context-resolve/v1/context-resolve"), null);
});

test("stripRequestEtags removes only the etag field", () => {
  const query = concat([vi(1, 4), str(2, "etag-value")]);
  const entityRequest = concat([str(1, "spotify:track:abc"), bytes(2, query)]);
  const header = bytes(1, vi(1, 1));
  const input = concat([header, bytes(2, entityRequest)]);

  const stripped = patcher.stripRequestEtags(input);
  assert.ok(stripped);

  const top = patcher.parse(stripped);
  const request = patcher.parse(top.find((f) => f.no === 2).p);
  const keptQuery = patcher.parse(request.find((f) => f.no === 2).p);
  assert.equal(keptQuery.some((f) => f.no === 2), false);
  assert.equal(keptQuery.find((f) => f.no === 1).v, 4n);
});

test("a request without etags is not rewritten", () => {
  const input = concat([bytes(1, vi(1, 1)), bytes(2, concat([str(1, "spotify:track:abc")]))]);
  assert.equal(patcher.stripRequestEtags(input), null);
});

// --------------------------------------------------------------- ad surfaces

const section = (name, contentField, payload) =>
  concat([str(1, "spotify:section:" + name), bytes(contentField, payload)]);

test("home feed drops sponsored sections and keeps normal ones", () => {
  const input = bytes(
    1,
    concat([
      bytes(1, section("1|brand-ad", 2, Uint8Array.from([1]))),
      bytes(1, section("2|hpto", 4, Uint8Array.from([2]))),
      bytes(1, section("3|recently-played", 2, Uint8Array.from([3]))),
    ]),
  );

  const patched = patcher.stripHomeAds(input);
  assert.ok(patched);
  const text = decoder.decode(patched);
  assert.equal(text.includes("brand-ad"), false);
  assert.equal(text.includes("hpto"), false);
  assert.ok(text.includes("recently-played"));
});

test("home feed also drops legacy ad content fields", () => {
  const input = bytes(
    1,
    concat([
      bytes(1, section("1|made-for-you", 21, Uint8Array.from([1]))),
      bytes(1, section("2|daily-mix", 2, Uint8Array.from([2]))),
    ]),
  );

  const patched = patcher.stripHomeAds(input);
  assert.ok(patched);
  assert.equal(decoder.decode(patched).includes("made-for-you"), false);
  assert.ok(decoder.decode(patched).includes("daily-mix"));
});

test("home feed without an ad section is left untouched", () => {
  const input = bytes(1, bytes(1, section("1|recently-played", 2, Uint8Array.from([1]))));
  assert.equal(patcher.stripHomeAds(input), null);
});

test("browse hides an oversized sponsored field by renumbering it", () => {
  const sponsored = new Uint8Array(13000).fill(7);
  const input = concat([
    vi(1, 1),
    bytes(2, concat([str(1, "genre"), bytes(6, sponsored)])),
  ]);

  const patched = patcher.hideBrowseAds(input);
  assert.ok(patched);
  const top = patcher.parse(patched);
  const inner = patcher.parse(top.find((f) => f.no === 2).p);
  assert.equal(inner.some((f) => f.no === 6), false);
  assert.ok(inner.some((f) => f.no === 1000 && f.w === 2));
});

test("browse leaves a small field 6 alone", () => {
  const input = concat([
    bytes(2, new Uint8Array(13000).fill(1)),
    bytes(2, bytes(6, new Uint8Array(100).fill(2))),
  ]);
  assert.equal(patcher.hideBrowseAds(input), null);
});

test("scroll drops the section that carries field 30", () => {
  const adSection = concat([str(23, "spotify:section:ad"), bytes(30, Uint8Array.from([9, 9]))]);
  const okSection = concat([str(23, "spotify:section:ok")]);
  const input = bytes(1, concat([bytes(1, adSection), bytes(1, okSection)]));

  const patched = patcher.hideScrollAds(input);
  assert.ok(patched);
  const text = decoder.decode(patched);
  assert.equal(text.includes("spotify:section:ad"), false);
  assert.ok(text.includes("spotify:section:ok"));
});

test("scroll without field 30 is left untouched", () => {
  const input = bytes(1, bytes(1, concat([str(23, "spotify:section:ok")])));
  assert.equal(patcher.hideScrollAds(input), null);
});

const assigned = (scope, name, on) =>
  bytes(
    3,
    concat([
      bytes(1, concat([str(1, scope), str(2, name)])),
      bytes(3, on ? vi(1, 1) : new Uint8Array(0)),
    ]),
  );

function configValues(buffer) {
  const out = Object.create(null);
  for (const f of patcher.parse(buffer)) {
    if (f.no !== 3 || f.w !== 2) continue;
    const value = patcher.parse(f.p);
    const identifier = patcher.parse(value.find((x) => x.no === 1).p);
    const name = decoder.decode(identifier.find((x) => x.no === 2).p);
    const bool = value.find((x) => x.no === 3);
    const inner = bool && bool.p.length ? patcher.parse(bool.p) : [];
    out[name] = inner.some((x) => x.no === 1 && x.v === 1n);
  }
  return out;
}

test("remote configuration turns ad switches off", () => {
  const input = concat([
    assigned("core", "ads", true),
    assigned("core", "enable_home_ads", true),
    assigned("core", "unrelated", true),
  ]);

  const patched = patcher.patchConfigurationResponse(input);
  assert.ok(patched);
  const values = configValues(patched);
  assert.equal(values.ads, false);
  assert.equal(values.enable_home_ads, false);
  assert.equal(values.unrelated, true);
});

test("remote configuration leaves crossfade and AutoMix switches to the client", () => {
  const input = concat([
    assigned("ios-feature-settings", "crossfade_enabled", true),
    assigned("core-automix", "automix_enabled", true),
    assigned("ios-feature-settings", "use_playback_settings_crossfade", true),
    assigned("ios-feature-settings", "use_playback_settings_gapless", true),
    assigned("core", "ads", true),
  ]);

  const patched = patcher.patchConfigurationResponse(input);
  assert.ok(patched, "the configuration response is still patched for other switches");
  const values = configValues(patched);
  assert.equal(values.ads, false);
  // Forcing these on (and use_playback_settings_* off) made the next track start
  // 1-2 seconds before the previous one ended.
  assert.equal(values.crossfade_enabled, true);
  assert.equal(values.automix_enabled, true);
  assert.equal(values.use_playback_settings_crossfade, true);
  assert.equal(values.use_playback_settings_gapless, true);
});

test("attribute configuration does not enable crossfade product state", () => {
  const input = concat([
    attrEntry("enable-crossfade-product-state", "0"),
    attrEntry("type", "free"),
  ]);

  const patched = patcher.patchAttributesResponse(input);
  assert.ok(patched);
  const values = attributeMap(patched);
  assert.equal(values["enable-crossfade-product-state"], "0");
  assert.equal(values.type, "premium");
});

test("wrapped remote configuration is patched without losing the wrapper", () => {
  const inner = concat([assigned("core", "ads", true)]);
  const input = bytes(1, inner);

  const patched = patcher.patchConfigurationResponse(input);
  assert.ok(patched);
  const top = patcher.parse(patched);
  assert.equal(top.length, 1);
  assert.equal(top[0].no, 1);
  assert.equal(configValues(top[0].p).ads, false);
});

const attrEntry = (key, value) =>
  bytes(
    1,
    concat([str(1, key), bytes(2, typeof value === "string" ? str(4, value) : vi(2, value ? 1 : 0))]),
  );

function attributeMap(buffer) {
  const out = Object.create(null);
  for (const f of patcher.parse(buffer)) {
    if (f.no !== 1 || f.w !== 2) continue;
    const pair = patcher.parse(f.p);
    const key = decoder.decode(pair.find((x) => x.no === 1).p);
    const value = patcher.parse(pair.find((x) => x.no === 2).p);
    const bool = value.find((x) => x.no === 2);
    const string = value.find((x) => x.no === 4);
    out[key] = string ? decoder.decode(string.p) : bool ? bool.v === 1n : undefined;
  }
  return out;
}

test("attribute configuration turns ads off and keeps premium attributes", () => {
  const input = concat([
    attrEntry("ads", true),
    attrEntry("name", "Free"),
    attrEntry("unrelated", true),
  ]);

  const patched = patcher.patchAttributesResponse(input);
  assert.ok(patched);
  const values = attributeMap(patched);
  assert.equal(values.ads, false);
  assert.equal(values.name, "Spotify Premium");
  assert.equal(values.unrelated, true);
});

test("malformed ad and configuration payloads pass through", () => {
  const junk = Uint8Array.from([0xff, 0xff, 0xff]);
  assert.equal(patcher.stripHomeAds(junk), null);
  assert.equal(patcher.hideBrowseAds(junk), null);
  assert.equal(patcher.hideScrollAds(junk), null);
  assert.equal(patcher.patchConfigurationResponse(junk), null);
  assert.equal(patcher.patchAttributesResponse(junk), null);
});

test("configuration patching keeps unrelated surrounding fields", () => {
  const input = concat([
    str(1, "assignment-id"),
    vi(2, 123),
    assigned("core", "ads", true),
    vi(6, 9),
  ]);

  const patched = patcher.patchConfigurationResponse(input);
  assert.ok(patched);
  const top = patcher.parse(patched);
  assert.ok(top.some((f) => f.no === 1 && decoder.decode(f.p) === "assignment-id"));
  assert.ok(top.some((f) => f.no === 6 && f.v === 9n));
  assert.equal(configValues(patched).ads, false);
});

test("attribute patching keeps unrelated top-level fields", () => {
  const input = concat([vi(7, 1), attrEntry("ads", true)]);
  const patched = patcher.patchAttributesResponse(input);
  assert.ok(patched);
  const top = patcher.parse(patched);
  assert.ok(top.some((f) => f.no === 7 && f.v === 1n));
  assert.equal(attributeMap(patched).ads, false);
});

test("non-canonical metadata is passed through instead of re-serialized", () => {
  // field 1, varint 1, but encoded with a redundant continuation byte.
  const nonCanonical = Uint8Array.from([0x08, 0x81, 0x00]);
  const track = concat([
    str(1, "spotify:track:xyz"),
    bytes(2, Uint8Array.from([1])),
    bytes(3, concat([str(1, "track_title"), str(2, "Song")])),
  ]);
  const input = concat([nonCanonical, bytes(1, track)]);
  assert.equal(patcher.patchMeta(input, "/extended-metadata/v0/extended-metadata"), null);
});
