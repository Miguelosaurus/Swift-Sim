import test from "node:test";
import assert from "node:assert/strict";
import { machoUUID, normalizedLiveBinaryIdentity, liveBinaryMatches } from "../mac-helper/src/liveBinaryIdentity.js";

const first = "01234567-89ab-cdef-0123-456789abcdef";
const second = "fedcba98-7654-3210-fedc-ba9876543210";

function thin(uuid = first, cpu = 0x0100000c) {
  const image = Buffer.alloc(56);
  image.writeUInt32LE(0xfeedfacf, 0); image.writeUInt32LE(cpu, 4);
  image.writeUInt32LE(1, 16); image.writeUInt32LE(24, 20);
  image.writeUInt32LE(0x1b, 32); image.writeUInt32LE(24, 36);
  Buffer.from(uuid.replaceAll("-", ""), "hex").copy(image, 40);
  return image;
}

function universal(images, wide = false) {
  const width = wide ? 32 : 20;
  const header = Buffer.alloc(8 + width * images.length);
  header.writeUInt32BE(wide ? 0xcafebabf : 0xcafebabe, 0); header.writeUInt32BE(images.length, 4);
  let start = header.length;
  for (const [index, image] of images.entries()) {
    const offset = 8 + index * width;
    header.writeUInt32BE(image.readUInt32LE(4), offset);
    if (wide) { header.writeBigUInt64BE(BigInt(start), offset + 8); header.writeBigUInt64BE(BigInt(image.length), offset + 16); }
    else { header.writeUInt32BE(start, offset + 8); header.writeUInt32BE(image.length, offset + 12); }
    start += image.length;
  }
  return Buffer.concat([header, ...images]);
}

test("binary identity reads LC_UUID from the actual arm64 image", () => {
  assert.equal(machoUUID(thin()), first);
  assert.equal(machoUUID(thin(second)), second);
});

test("fat and fat64 images select arm64 without borrowing another slice's UUID", () => {
  const intel = thin(second, 0x01000007);
  assert.equal(machoUUID(universal([intel, thin()])), first);
  assert.equal(machoUUID(universal([intel, thin()], true)), first);
});

test("missing, duplicate or ambiguous arm64 UUID evidence fails closed", () => {
  const duplicate = Buffer.concat([thin(), thin().subarray(32)]);
  duplicate.writeUInt32LE(2, 16); duplicate.writeUInt32LE(48, 20);
  const empty = thin(); empty.writeUInt32LE(0, 16); empty.writeUInt32LE(0, 20);
  for (const image of [Buffer.alloc(0), Buffer.alloc(32), thin(first, 0x01000007), empty, duplicate, universal([thin(), thin(second)]), universal([thin(first, 0x01000007)])]) {
    assert.throws(() => machoUUID(image), { code: "LIVE_BINARY_PROVENANCE_REQUIRED" });
  }
});

test("truncated load commands and out-of-bounds fat offsets cannot establish identity", () => {
  const malformed = thin(); malformed.writeUInt32LE(4, 36);
  const overflowing = thin(); overflowing.writeUInt32LE(100, 20);
  const fat = universal([thin()]); fat.writeUInt32BE(0xffffffff, 16);
  const fat64 = universal([thin()], true); fat64.writeBigUInt64BE(2n ** 60n, 16);
  for (const image of [thin().subarray(0, 55), malformed, overflowing, fat, fat64]) {
    assert.throws(() => machoUUID(image), { code: "LIVE_BINARY_PROVENANCE_REQUIRED" });
  }
});

test("app and both binary identities must all match; UUID casing is normalized", () => {
  const identity = { bundle_id: "com.example.fixture", bundle_version: "1.0", build_number: "23", executable_uuid: first, debug_dylib_uuid: second };
  assert.equal(liveBinaryMatches(identity, { ...identity, executable_uuid: first.toUpperCase() }), true);
  for (const [key, value] of Object.entries({ bundle_id: "com.example.other", bundle_version: "2.0", build_number: "24", executable_uuid: second, debug_dylib_uuid: first })) {
    assert.equal(liveBinaryMatches(identity, { ...identity, [key]: value }), false);
  }
  assert.deepEqual(normalizedLiveBinaryIdentity({ ...identity, executable_uuid: first.toUpperCase() }), identity);
  assert.equal(liveBinaryMatches(identity, { ...identity, debug_dylib_uuid: "filename-is-not-a-uuid" }), false);
  assert.equal(liveBinaryMatches(identity, null), false);
});
