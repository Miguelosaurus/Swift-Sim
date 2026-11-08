// Explicit publication gate, never run by setup or ordinary warm delivery.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { COMPONENTS } from "../../mac-helper/src/componentCompatibility.js";
const { engine, sdk } = COMPONENTS;
const ref = await fetch(
  `https://api.github.com/repos/Miguelosaurus/InjectionNext/git/ref/tags/${sdk.enginePackageVersion}`,
  { signal: AbortSignal.timeout(15000) },
);
assert.ok(ref.ok, "The exact SDK tag must exist before releasing Swift Sim");
const tag = await ref.json();
assert.equal(tag.object?.type, "commit", "Use an immutable lightweight engine SDK tag");
assert.equal(tag.object.sha, engine.sourceRevision, "SDK and binary must share source provenance");
const response = await fetch(engine.url, { signal: AbortSignal.timeout(60000) });
assert.ok(response.ok && response.body, "The pinned engine archive must be publicly available");
let bytes = 0;
const hash = createHash("sha256");
for await (const part of response.body) {
  bytes += part.length;
  assert.ok(bytes <= engine.maxArchiveBytes, "Engine archive exceeds its limit");
  hash.update(part);
}
assert.ok(bytes > 0);
assert.equal(hash.digest("hex"), engine.sha256);
console.log("Verified public immutable SDK tag and exact engine archive checksum");
