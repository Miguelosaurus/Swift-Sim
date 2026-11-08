import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { createInstallPresentationReader } from "../mac-helper/src/installPresentationReader.js";
const id = "11111111-1111-1111-1111-111111111111";
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-presentation-"));
  chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const build = {
    id,
    state: "ready",
    app: { teamID: "team", bundleIdentifier: "app", version: "1", build: "2" },
  };
  const path = join(root, "install-requests.json");
  const reader = createInstallPresentationReader({ rootPath: root, now: () => 10000 });
  return {
    root,
    path,
    build,
    read: () => reader([build]),
    write: (value) => writeFileSync(path, JSON.stringify(value), { mode: 0o600 }),
  };
}
function request(extra = {}) {
  return {
    id,
    selector: {
      bundle_id: "app",
      bundle_version: "1",
      build_number: "1",
      executable_uuid: id,
      debug_dylib_uuid: id,
    },
    value: JSON.stringify({
      buildID: id,
      bundleID: "app",
      version: "1",
      build: "2",
      sha256: "a".repeat(64),
      manifestURL: "https://private/?token=secret",
    }),
    expiresAt: 100,
    state: "waiting",
    ...extra,
  };
}
test("foreground journal gives compact hints, expires waiting, and rereads replacement generations", (t) => {
  const f = fixture(t);
  assert.equal(f.read().size, 0);
  f.write([request()]);
  assert.deepEqual(f.read().get(id), { state: "waiting" });
  assert.doesNotMatch(JSON.stringify([...f.read()]), /secret|manifest|selector|https/);
  f.write([request({ state: "prompt-requested" })]);
  assert.deepEqual(f.read().get(id), { state: "prompt-requested" });
  f.write([request({ expiresAt: 1 })]);
  assert.equal(f.read().get(id).state, "expired");
});
for (const [label, mutate] of [
  ["corrupt JSON", (f) => writeFileSync(f.path, "{")],
  ["public mode", (f) => chmodSync(f.path, 0o644)],
  [
    "symlink",
    (f) => {
      const other = join(f.root, "other.json");
      writeFileSync(other, "[]", { mode: 0o600 });
      rmSync(f.path);
      symlinkSync(other, f.path);
    },
  ],
  ["invalid selector", (f) => f.write([request({ selector: { bundle_id: "app" } })])],
  ["oversized", (f) => writeFileSync(f.path, " ".repeat(200000))],
])
  test(label + " preserves uncertainty", (t) => {
    const f = fixture(t);
    f.write([request()]);
    mutate(f);
    assert.equal(f.read().get(id).state, "unavailable");
  });
test("payload mismatch cannot select a build", (t) => {
  const f = fixture(t);
  const r = request();
  r.value = JSON.stringify({ ...JSON.parse(r.value), build: "other" });
  f.write([r]);
  assert.equal(f.read().size, 0);
});
test("native receipts stay confirming and are bound to app namespace", (t) => {
  const f = fixture(t);
  const dir = join(f.root, "native-build-delivery");
  mkdirSync(dir, { mode: 0o700 });
  const path = join(dir, createHash("sha256").update("team:app").digest("hex") + ".json");
  const write = (state) =>
    writeFileSync(
      path,
      JSON.stringify({
        schema: 1,
        entries: {
          [id]: {
            buildID: id,
            state,
            identity: { bundle: "app", version: "1", build: "2" },
            device: "secret",
            staging: "private",
          },
        },
      }),
      { mode: 0o600 },
    );
  write("installed");
  assert.deepEqual(f.read().get(id), { state: "confirming" });
  write("submitting");
  assert.deepEqual(f.read().get(id), { state: "unconfirmed" });
  f.build.app.teamID = "other";
  assert.equal(f.read().size, 0);
});
