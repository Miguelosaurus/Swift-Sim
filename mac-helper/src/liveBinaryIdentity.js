const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTITY_FIELDS = ["bundle_id", "bundle_version", "build_number", "executable_uuid", "debug_dylib_uuid"];

// Read LC_UUID, never a path/name heuristic. Universal binaries must contain one
// unambiguous arm64 image; symbols from another slice cannot grant compatibility.
export function machoUUID(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32) throw identityError();
  let image = bytes;
  const fat = bytes.readUInt32BE(0);
  if (fat === 0xcafebabe || fat === 0xcafebabf) {
    const count = bytes.readUInt32BE(4); const width = fat === 0xcafebabe ? 20 : 32;
    if (count < 1 || count > 64 || bytes.length < 8 + count * width) throw identityError();
    const slices = [];
    for (let index = 0; index < count; index += 1) {
      const offset = 8 + index * width;
      if (bytes.readUInt32BE(offset) !== 0x0100000c) continue;
      const start = width === 20 ? bytes.readUInt32BE(offset + 8) : Number(bytes.readBigUInt64BE(offset + 8));
      const size = width === 20 ? bytes.readUInt32BE(offset + 12) : Number(bytes.readBigUInt64BE(offset + 16));
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(size) || start < 8 + count * width || size < 32 || start + size > bytes.length) throw identityError();
      slices.push(bytes.subarray(start, start + size));
    }
    if (slices.length !== 1) throw identityError();
    [image] = slices;
  }
  if (image.readUInt32LE(0) !== 0xfeedfacf || image.readUInt32LE(4) !== 0x0100000c) throw identityError();
  const count = image.readUInt32LE(16); const length = image.readUInt32LE(20);
  if (count > 20_000 || 32 + length > image.length) throw identityError();
  let cursor = 32; let uuid = "";
  for (let index = 0; index < count; index += 1) {
    if (cursor + 8 > 32 + length) throw identityError();
    const command = image.readUInt32LE(cursor); const size = image.readUInt32LE(cursor + 4);
    if (size < 8 || cursor + size > 32 + length) throw identityError();
    if (command === 0x1b) {
      if (size !== 24 || uuid) throw identityError();
      const hex = image.subarray(cursor + 8, cursor + 24).toString("hex");
      uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    cursor += size;
  }
  if (!UUID_PATTERN.test(uuid)) throw identityError();
  return uuid;
}

export function normalizedLiveBinaryIdentity(value) {
  if (!value || typeof value !== "object") throw identityError();
  const identity = {};
  for (const key of IDENTITY_FIELDS) {
    if (typeof value[key] !== "string" || !value[key] || value[key].length > 256) throw identityError();
    identity[key] = key.endsWith("_uuid") ? value[key].toLowerCase() : value[key];
    if (key.endsWith("_uuid") && !UUID_PATTERN.test(identity[key])) throw identityError();
  }
  return identity;
}

export function liveBinaryMatches(expected, actual) {
  try {
    const left = normalizedLiveBinaryIdentity(expected); const right = normalizedLiveBinaryIdentity(actual);
    return IDENTITY_FIELDS.every((key) => left[key] === right[key]);
  } catch { return false; }
}

function identityError() { return Object.assign(new Error("The Debug app's exact binary identity could not be established. Rebuild its live integration before queuing edits."), { code: "LIVE_BINARY_PROVENANCE_REQUIRED" }); }
