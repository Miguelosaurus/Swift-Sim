// Explicit publication gate, never run by setup or ordinary warm delivery.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { COMPONENTS } from "../../mac-helper/src/componentCompatibility.js";

export async function verifyEnginePublication({
  contract = COMPONENTS,
  run = spawnSync,
  request = fetch,
} = {}) {
  const { engine, sdk } = contract;
  // Verify the same public Git ref SwiftPM consumes. A public ref does not
  // require the GitHub REST API or its shared unauthenticated runner quota.
  const refName = `refs/tags/${sdk.enginePackageVersion}`;
  const ref = run(
    "git",
    [
      "ls-remote",
      "--exit-code",
      "--tags",
      "https://github.com/Miguelosaurus/InjectionNext.git",
      refName,
    ],
    { encoding: "utf8", timeout: 15000, maxBuffer: 65536 },
  );
  assert.equal(ref.status, 0, "The public SDK tag could not be verified through Git");
  const lines = String(ref.stdout || "")
    .trim()
    .split(/\r?\n/);
  assert.equal(lines.length, 1, "The SDK tag must be unambiguous");
  const [revision, name, extra] = lines[0].split(/\s+/);
  assert.equal(extra, undefined);
  assert.equal(name, refName);
  assert.equal(revision, engine.sourceRevision, "SDK and binary must share source provenance");
  const response = await request(engine.url, { signal: AbortSignal.timeout(60000) });
  assert.ok(
    response.ok && response.body,
    `The public engine archive could not be fetched (HTTP ${response.status})`,
  );
  let bytes = 0;
  const hash = createHash("sha256");
  for await (const part of response.body) {
    bytes += part.length;
    assert.ok(bytes <= engine.maxArchiveBytes, "Engine archive exceeds its limit");
    hash.update(part);
  }
  assert.ok(bytes > 0);
  assert.equal(hash.digest("hex"), engine.sha256);
  return { verified: true, revision, bytes };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyEnginePublication();
  console.log("Verified public immutable SDK tag and exact engine archive checksum");
}
