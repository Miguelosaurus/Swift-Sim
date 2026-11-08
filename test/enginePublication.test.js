import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { verifyEnginePublication } from "../scripts/release/verify-engine-publication.mjs";
function fixture() {
  const body = Buffer.from("signed archive fixture");
  const revision = "a".repeat(40);
  const contract = {
    sdk: { enginePackageVersion: "0.5.7" },
    engine: {
      sourceRevision: revision,
      url: "https://example.invalid/archive",
      maxArchiveBytes: 100,
      sha256: createHash("sha256").update(body).digest("hex"),
    },
  };
  let calls = 0;
  return {
    contract,
    run: (command, args, options) => {
      assert.equal(command, "git");
      assert.deepEqual(args.slice(0, 3), ["ls-remote", "--exit-code", "--tags"]);
      assert.equal(args.at(-1), "refs/tags/0.5.7");
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 65536);
      return { status: 0, stdout: revision + "\trefs/tags/0.5.7\n" };
    },
    request: async (url) => {
      calls++;
      assert.equal(url, contract.engine.url);
      return new Response(body);
    },
    calls: () => calls,
  };
}
test("publication gate uses the public Git ref without a GitHub API call", async () => {
  const f = fixture();
  const result = await verifyEnginePublication(f);
  assert.equal(result.verified, true);
  assert.equal(f.calls(), 1);
});
for (const [name, run] of [
  ["unreachable Git", () => ({ status: 128, stdout: "" })],
  ["wrong revision", () => ({ status: 0, stdout: "b".repeat(40) + "\trefs/tags/0.5.7\n" })],
  ["wrong tag", () => ({ status: 0, stdout: "a".repeat(40) + "\trefs/tags/other\n" })],
  ["ambiguous ref", () => ({ status: 0, stdout: "a\tb\nc\td\n" })],
])
  test(name + " fails before downloading", async () => {
    const f = fixture();
    f.run = run;
    await assert.rejects(verifyEnginePublication(f));
    assert.equal(f.calls(), 0);
  });
for (const kind of ["HTTP", "checksum", "limit"])
  test("publication rejects " + kind, async () => {
    const f = fixture();
    if (kind === "HTTP") f.request = async () => new Response("no", { status: 503 });
    if (kind === "checksum") f.contract.engine.sha256 = "b".repeat(64);
    if (kind === "limit") f.contract.engine.maxArchiveBytes = 1;
    await assert.rejects(verifyEnginePublication(f));
  });
