import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { engineFixture, engineIO, desired, original } from "./fixtures/engine-install.js";
import {
  installEngineTransaction,
  recoverEngineInstall,
} from "../mac-helper/src/engineInstallTransaction.js";

test("verified staging precedes stop and publication keeps only the current app", async (t) => {
  const f = engineFixture();
  t.after(f.dispose);
  let stopped = 0;
  const result = await installEngineTransaction({
    ...f,
    desired,
    stop: async () => {
      stopped++;
      assert.equal(f.snapshot().marker, "old");
      assert.ok(f.io.stagedIdentity());
    },
  });
  assert.deepEqual(result, { installed: true, cleanupPending: false });
  assert.equal(stopped, 1);
  assert.equal(f.snapshot().marker, "new");
  assert.deepEqual(f.snapshot().names, ["app", "manifest.json"]);
});
for (const kind of ["prepare", "stop", "publish", "validation"])
  test(`failure at ${kind} restores the original app and exact manifest bytes`, async (t) => {
    const f = engineFixture();
    t.after(f.dispose);
    let stopped = 0;
    const io = { ...f.io };
    if (kind === "publish")
      io.publishStaged = () => {
        throw new Error("publish failure");
      };
    await assert.rejects(
      installEngineTransaction({
        desired,
        io,
        prepare:
          kind === "prepare"
            ? async () => {
                await f.prepare();
                throw new Error("staging failure");
              }
            : f.prepare,
        stop: async () => {
          stopped++;
          if (kind === "stop") throw new Error("stop failure");
        },
        verifyCurrent: kind === "validation" ? async () => false : f.verifyCurrent,
      }),
    );
    assert.equal(stopped, kind === "prepare" ? 0 : 1);
    assert.equal(f.snapshot().marker, "old");
    assert.deepEqual(f.snapshot().manifest, original);
    assert.deepEqual(f.snapshot().names, ["app", "manifest.json"]);
  });
for (const point of [
  "journal:preparing",
  "prepare",
  "journal:swapping",
  "backup",
  "publish",
  "manifest",
  "journal:committed",
  "removeBackup",
  "removeStage",
])
  test(`real child exit at ${point} is recoverable without a second install`, async (t) => {
    const f = engineFixture();
    t.after(f.dispose);
    const fixture = pathToFileURL(
      fileURLToPath(new URL("./fixtures/engine-install.js", import.meta.url)),
    ).href;
    const transaction = pathToFileURL(
      fileURLToPath(new URL("../mac-helper/src/engineInstallTransaction.js", import.meta.url)),
    ).href;
    const script = `import{engineIO,desired}from ${JSON.stringify(fixture)};import{installEngineTransaction}from ${JSON.stringify(transaction)};const f=engineIO(${JSON.stringify(f.root)},point=>{if(point===${JSON.stringify(point)})process.exit(73);});await installEngineTransaction({...f,desired,stop:async()=>{}});`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8",
      timeout: 10000,
    });
    assert.equal(result.status, 73, result.stderr);
    await recoverEngineInstall({ io: f.io, verifyCurrent: f.verifyCurrent });
    const committed = ["journal:committed", "removeBackup", "removeStage"].includes(point);
    assert.equal(f.snapshot().marker, committed ? "new" : "old");
    if (!committed) assert.deepEqual(f.snapshot().manifest, original);
    assert.deepEqual(f.snapshot().names, ["app", "manifest.json"]);
  });
test("one failed cleanup stays bounded and finishes on the next explicit setup", async (t) => {
  const f = engineFixture();
  t.after(f.dispose);
  let first = true,
    stops = 0;
  const io = {
    ...f.io,
    removeBackup: () => {
      if (first) {
        first = false;
        throw new Error("busy");
      }
      return f.io.removeBackup();
    },
  };
  const result = await installEngineTransaction({
    ...f,
    io,
    desired,
    stop: async () => {
      stops++;
    },
  });
  assert.equal(result.cleanupPending, true);
  assert.equal(f.snapshot().marker, "new");
  assert.ok(f.io.readJournal());
  await recoverEngineInstall({ io, verifyCurrent: f.verifyCurrent });
  assert.equal(stops, 1);
  assert.deepEqual(f.snapshot().names, ["app", "manifest.json"]);
});
test("corrupted recovery bytes are preserved without changing the current app", async (t) => {
  const f = engineFixture();
  t.after(f.dispose);
  let journal;
  const io = { ...f.io, readJournal: () => journal };
  journal = {
    version: 1,
    phase: "swapping",
    desired,
    previousIdentity: "1:2",
    targetIdentity: "1:3",
    previousManifestPresent: true,
    previousManifest: "corrupt",
    previousManifestHash: "a".repeat(64),
  };
  await assert.rejects(recoverEngineInstall({ io, verifyCurrent: f.verifyCurrent }), {
    code: "ENGINE_INSTALL_RECOVERY_REQUIRED",
  });
  assert.equal(f.snapshot().marker, "old");
  assert.deepEqual(f.snapshot().manifest, original);
});

test("recovery preserves an unrelated replacement backup rather than deleting it", async (t) => {
  const f = engineFixture();
  t.after(f.dispose);
  const interrupted = engineIO(f.root, (point) => {
    if (point === "backup") throw new Error("stop");
  });
  // Prevent the caller's in-process rollback so this models persisted interrupted state.
  const io = { ...interrupted.io, readJournal: () => null };
  let reads = 0;
  io.readJournal = () =>
    ++reads <= 2
      ? null
      : (() => {
          throw new Error("process gone");
        })();
  await assert.rejects(
    installEngineTransaction({ ...interrupted, io, desired, stop: async () => {} }),
  );
  renameSync(join(f.root, "backup"), join(f.root, "original-preserved"));
  mkdirSync(join(f.root, "backup"));
  await assert.rejects(recoverEngineInstall({ io: f.io, verifyCurrent: f.verifyCurrent }), {
    code: "ENGINE_INSTALL_RECOVERY_REQUIRED",
  });
  assert.equal(f.io.currentIdentity(), null);
  assert.ok(f.io.backupIdentity());
  assert.deepEqual(f.io.readManifest(), original);
});
