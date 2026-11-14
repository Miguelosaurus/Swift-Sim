import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync as readFixtureBytes,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeviceBuildStore, deviceAppIdentity } from "../mac-helper/src/deviceBuildStore.js";
import { createCompilerCacheRetention } from "../mac-helper/src/deviceBuildCompilerCacheRetention.js";
import {
  createNodeCompilerCacheStorage,
  createNodeCompilerCacheReferences,
} from "../mac-helper/src/infrastructure/nodeCompilerCacheRetention.js";
import { createLiveDeliveryQueue } from "../mac-helper/src/liveDeliveryQueue.js";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-cache-retention-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new DeviceBuildStore({
    path: join(root, "device-builds.json"),
    maintenance: false,
  });
  let queueSnapshot = { records: [], desires: [] };
  let live = {};
  let open = [];
  const queue = {
    pollingSnapshot: () => structuredClone(queueSnapshot),
    withRetentionSnapshot: async (operation) => operation(structuredClone(queueSnapshot)),
  };
  const storage = createNodeCompilerCacheStorage();
  const options = {
    store,
    artifactDirectory: join(root, "device-builds"),
    queue,
    references: { read: () => structuredClone(live), openPaths: async () => open },
    storage,
    withEngineLock: async (operation) => operation(),
  };
  let counter = 0;
  function build(overrides = {}) {
    counter += 1;
    const value = store.create({
      project: "/private/tmp/Example.xcodeproj",
      scheme: "Example",
      configuration: "Debug",
    });
    value.app = {
      bundleIdentifier: "com.example.fixture",
      teamID: "FIXTURE",
      version: "1.0",
      build: String(counter),
    };
    value.app.identity = deviceAppIdentity(value.app);
    value.createdAt = new Date(Date.parse("2026-10-01T00:00:00Z") + counter * 60_000).toISOString();
    value.state = "ready";
    value.liveReload = { compilerReady: true };
    Object.assign(value, overrides);
    value.artifacts.ipaPath = join(value.artifacts.root, "export", "Example.ipa");
    value.artifacts.exportPath = join(value.artifacts.root, "export");
    mkdirSync(join(value.artifacts.root, "DerivedData"), { recursive: true, mode: 0o700 });
    mkdirSync(value.artifacts.exportPath, { mode: 0o700 });
    writeFileSync(value.artifacts.ipaPath, "signed-install-payload");
    writeFileSync(join(value.artifacts.root, "DerivedData", "cache"), "generated-cache");
    store.save(value);
    return value;
  }
  return {
    root,
    store,
    build,
    storage,
    options,
    service: createCompilerCacheRetention(options),
    setQueue: (value) => {
      queueSnapshot = value;
    },
    setLive: (value) => {
      live = value;
    },
    setOpen: (value) => {
      open = value;
    },
  };
}
const cached = (build) => existsSync(join(build.artifacts.root, "DerivedData"));

test("legacy 0755 Xcode build roots remain eligible only beneath a private owned state root", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  chmodSync(old.artifacts.root, 0o755);
  assert.equal((await f.service.reconcile()).pruned, 1);
  const second = f.build();
  f.build();
  f.build();
  chmodSync(f.root, 0o755);
  assert.equal((await f.service.reconcile()).pruned, 0);
  assert.equal(cached(second), true);
});

test("a pin acquired between retirement claim and detach prevents removal", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  const retire = f.store.retireCompilerCache.bind(f.store);
  f.store.retireCompilerCache = (input) => {
    const result = retire(input);
    if (input.phase === "claim" && result.status === "accepted") {
      const current = f.store.get(old.id);
      current.pinned = true;
      f.store.save(current);
    }
    return result;
  };
  assert.equal((await f.service.reconcile()).pruned, 0);
  assert.equal(cached(old), true);
});

test("repeated completed builds bound unused compiler workspaces to two while retaining every installer and history", async (t) => {
  const f = fixture(t);
  const builds = [];
  for (let index = 0; index < 12; index += 1) {
    builds.push(f.build());
    await f.service.reconcile();
    assert.ok(builds.filter(cached).length <= 2);
  }
  assert.equal(f.store.list().length, 12);
  for (const build of builds)
    assert.equal(readFixtureBytes(build.artifacts.ipaPath, "utf8"), "signed-install-payload");
  assert.deepEqual(
    builds.filter(cached).map((build) => build.id),
    builds.slice(-2).map((build) => build.id),
  );
  assert.equal(f.store.get(builds[0].id).liveReload.compilerReady, false);
  assert.equal(f.store.get(builds[0].id).liveReload.compilerCache.state, "pruned");
});

test("planning is non-destructive and does not inspect processes or acquire mutation locks", (t) => {
  const f = fixture(t);
  const oldest = f.build();
  f.build();
  f.build();
  f.options.references.openPaths = () => {
    throw new Error("not a read-side operation");
  };
  f.options.withEngineLock = () => {
    throw new Error("not a read-side operation");
  };
  const before = readFixtureBytes(f.store.path);
  assert.equal(f.service.plan().candidates.length, 1);
  assert.equal(cached(oldest), true);
  assert.deepEqual(readFixtureBytes(f.store.path), before);
});

test("current compiler manifest, connected binary, open files, pending edits, uncertain receipts and confirmed restoration protect old workspaces", async (t) => {
  for (const kind of ["manifest", "binary", "open", "pending", "uncertain", "desired"]) {
    const f = fixture(t);
    const old = f.build();
    f.build();
    f.build();
    const scope = {
      appIdentity: createHash("sha256")
        .update(JSON.stringify([old.app.bundleIdentifier, old.app.version, old.app.build]))
        .digest("hex"),
    };
    if (kind === "manifest")
      f.setLive({
        manifestJSON: JSON.stringify({ path: join(old.artifacts.root, "DerivedData", "compiler") }),
      });
    if (kind === "binary")
      f.setLive({
        binaryIdentity: {
          bundle_id: old.app.bundleIdentifier,
          bundle_version: old.app.version,
          build_number: old.app.build,
        },
      });
    if (kind === "open") f.setOpen([join(old.artifacts.root, "DerivedData", "open-file")]);
    if (["pending", "uncertain"].includes(kind))
      f.setQueue({
        records: [{ scope, state: kind === "pending" ? "waiting-for-device" : "uncertain" }],
        desires: [],
      });
    if (kind === "desired") f.setQueue({ records: [], desires: [{ scope }] });
    await f.service.reconcile();
    assert.equal(cached(old), true, kind);
    assert.equal(f.store.get(old.id).liveReload.compilerReady, true, kind);
  }
});

test("active builds, installs, renewal leases, pins and worker records stay protected", async (t) => {
  for (const kind of ["building", "requested", "renewal", "pin", "worker"]) {
    const f = fixture(t);
    const old = f.build();
    f.build();
    f.build();
    if (kind === "building") old.state = "building";
    if (kind === "requested") old.installation = { state: "requested" };
    if (kind === "pin") old.retention = { pinned: true };
    if (kind === "worker")
      writeFileSync(join(old.artifacts.root, ".cancelled.worker.json"), "unverifiable worker");
    f.store.save(old);
    if (kind === "renewal") f.store.renewInstallLink(old.id);
    await f.service.reconcile();
    assert.equal(cached(old), true, kind);
  }
});

test("installation history protects only the latest verified build per device, including an older current install", async (t) => {
  const f = fixture(t);
  const old = f.build();
  const current = f.build();
  f.build();
  f.build();
  for (const [build, verifiedAt] of [
    [old, "2026-10-01T12:00:00Z"],
    [current, "2026-10-02T12:00:00Z"],
  ]) {
    build.installation = {
      state: "verified",
      verifiedAt,
      devices: [{ name: "Fixture Phone", state: "installed" }],
    };
    f.store.save(build);
  }
  await f.service.reconcile();
  assert.equal(cached(old), false);
  assert.equal(cached(current), true);
  assert.equal(f.store.get(old.id).installation.state, "verified");
});

test("each app/configuration has an independent recent-build allowance", async (t) => {
  const f = fixture(t);
  for (let index = 0; index < 4; index += 1) {
    f.build();
    f.build({ configuration: "Release" });
  }
  await f.service.reconcile();
  assert.equal(f.store.list().filter(cached).length, 4);
});

test("stale plans refuse revisions, new install requests, pins and new live references", async (t) => {
  for (const kind of ["revision", "install", "pin", "reference"]) {
    const f = fixture(t);
    const old = f.build();
    f.build();
    f.build();
    const plan = f.service.plan();
    if (kind === "revision") {
      old.logs.push("new observation");
      f.store.save(old);
    }
    if (kind === "install") {
      old.installation = { state: "requested" };
      f.store.save(old);
    }
    if (kind === "pin") {
      old.pinned = true;
      f.store.save(old);
    }
    if (kind === "reference")
      f.setLive({ paths: [join(old.artifacts.root, "DerivedData", "context")] });
    assert.equal((await f.service.apply(plan)).pruned, 0, kind);
    assert.equal(cached(old), true, kind);
  }
});

test("stale build saves cannot revive a retired compiler cache", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  await f.service.reconcile();
  old.logs.push("late writer");
  f.store.save(old);
  assert.equal(f.store.get(old.id).liveReload.compilerReady, false);
  assert.equal(f.store.get(old.id).liveReload.compilerCache.state, "pruned");
});

test("failed retirement persistence leaves compiler bytes untouched", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  const save = f.store.writeState.bind(f.store);
  f.store.writeState = () => {
    throw new Error("ENOSPC");
  };
  assert.equal((await f.service.reconcile()).pruned, 0);
  assert.equal(cached(old), true);
  f.store.writeState = save;
  assert.equal((await f.service.reconcile()).pruned, 1);
});

test("failed deletion leaves a durable detached cache and resumes safely after reopening the store", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  const remove = f.storage.remove;
  f.storage.remove = async () => {
    throw new Error("temporarily busy");
  };
  assert.equal((await f.service.reconcile()).pruned, 0);
  assert.equal(cached(old), false);
  assert.equal(f.store.get(old.id).liveReload.compilerCache.state, "detached");
  assert.equal(existsSync(join(old.artifacts.root, ".retired-compiler-cache")), true);
  f.storage.remove = remove;
  const reopened = new DeviceBuildStore({ path: f.store.path, maintenance: false });
  assert.equal(
    (await createCompilerCacheRetention({ ...f.options, store: reopened }).reconcile()).pruned,
    1,
  );
  assert.equal(existsSync(join(old.artifacts.root, ".retired-compiler-cache")), false);
});

test("crash after atomic detach but before metadata publication recovers the recorded directory inode", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  const detach = f.storage.detach;
  f.storage.detach = (candidate) => {
    detach(candidate);
    throw new Error("simulated crash");
  };
  await f.service.reconcile();
  assert.equal(f.store.get(old.id).liveReload.compilerCache.state, "retiring");
  assert.equal(cached(old), false);
  f.storage.detach = detach;
  assert.equal((await f.service.reconcile()).pruned, 1);
});

test("replaced roots, replaced cache inodes, symlinks and unexpected quarantine directories are refused", async (t) => {
  for (const kind of ["root", "inode", "symlink", "quarantine"]) {
    const f = fixture(t);
    const old = f.build();
    f.build();
    f.build();
    const plan = f.service.plan();
    const path = join(old.artifacts.root, "DerivedData");
    if (kind === "root") {
      renameSync(old.artifacts.root, `${old.artifacts.root}-preserved`);
      mkdirSync(path, { recursive: true });
    } else if (kind === "inode") {
      renameSync(path, `${path}-preserved`);
      mkdirSync(path);
    } else if (kind === "symlink") {
      renameSync(path, `${path}-preserved`);
      symlinkSync(`${path}-preserved`, path);
    } else mkdirSync(join(old.artifacts.root, ".retired-compiler-cache"));
    assert.equal((await f.service.apply(plan)).pruned, 0, kind);
    assert.equal(existsSync(path), true, kind);
  }
});

test("long deletion holds neither live-engine nor delivery-queue locks", async (t) => {
  const f = fixture(t);
  f.build();
  f.build();
  f.build();
  let engine = false;
  let queue = false;
  f.options.withEngineLock = async (operation) => {
    engine = true;
    try {
      return await operation();
    } finally {
      engine = false;
    }
  };
  f.options.queue.withRetentionSnapshot = async (operation) => {
    queue = true;
    try {
      return await operation({ records: [], desires: [] });
    } finally {
      queue = false;
    }
  };
  const remove = f.storage.remove;
  f.storage.remove = async (candidate) => {
    assert.equal(engine, false);
    assert.equal(queue, false);
    return remove(candidate);
  };
  assert.equal((await createCompilerCacheRetention(f.options).reconcile()).pruned, 1);
});

test("authority changes and rollback windows never grant cache deletion", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  let authority = { mode: "legacy", epoch: 0 };
  f.store.phase4AuthorityState = () => authority;
  const plan = f.service.plan();
  authority = { mode: "sqlite-final", epoch: 1 };
  assert.equal((await f.service.apply(plan)).pruned, 0);
  assert.equal(cached(old), true);
  authority = { mode: "sqlite-rollback", epoch: 1 };
  assert.throws(() => f.service.plan(), /rollback/);
});

test("rollback windows prune only builds newer than the frozen legacy snapshot", async (t) => {
  const f = fixture(t);
  const legacy = f.build();
  const newer = f.build();
  f.build();
  f.build();
  f.store.phase4AuthorityState = () => ({ mode: "sqlite-rollback", epoch: 1 });
  const service = createCompilerCacheRetention({
    ...f.options,
    rollbackProtectedBuildIDs: () => new Set([legacy.id]),
  });
  const plan = service.plan();
  assert.deepEqual(
    plan.candidates.map((candidate) => candidate.buildID),
    [newer.id],
  );
  assert.equal((await service.apply(plan)).pruned, 1);
  assert.equal(cached(legacy), true);
  assert.equal(cached(newer), false);
  const unreadable = createCompilerCacheRetention({
    ...f.options,
    rollbackProtectedBuildIDs: () => {
      throw new Error("legacy snapshot unreadable");
    },
  });
  assert.throws(() => unreadable.plan(), /unreadable/);
});

test("concurrent cleaners cannot both claim the same workspace", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  const plan = f.service.plan();
  const results = await Promise.all([f.service.apply(plan), f.service.apply(plan)]);
  assert.equal(
    results.reduce((sum, result) => sum + result.pruned, 0),
    1,
  );
  assert.equal(cached(old), false);
});

test("real queue retention read lease blocks other writers and never publishes journal changes", async (t) => {
  const f = fixture(t);
  const queue = createLiveDeliveryQueue({
    rootPath: join(f.root, "queue"),
    identity: () => ({ startToken: "fixture-process" }),
  });
  let release;
  let entered;
  const start = new Promise((resolve) => {
    entered = resolve;
  });
  const hold = queue.withRetentionSnapshot(async (snapshot) => {
    assert.deepEqual(snapshot, { records: [], desires: [] });
    entered();
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  await start;
  let secondEntered = false;
  try {
    await assert.rejects(
      queue.withRetentionSnapshot(() => {
        secondEntered = true;
      }),
      { code: "SWIFT_SIM_LOCK_BUSY" },
    );
    assert.equal(secondEntered, false);
  } finally {
    release();
    await hold;
  }
  assert.equal(existsSync(join(f.root, "queue", "queue.json")), false);
});

test("network/process observation failure aborts cleanup, and malformed live manifests fail closed", async (t) => {
  const f = fixture(t);
  const old = f.build();
  f.build();
  f.build();
  f.options.references.openPaths = async () => {
    throw new Error("lsof unavailable");
  };
  await assert.rejects(createCompilerCacheRetention(f.options).reconcile(), /unavailable/);
  assert.equal(cached(old), true);
  const path = join(f.root, "manifest.json");
  writeFileSync(path, "{invalid", { mode: 0o600 });
  const reader = createNodeCompilerCacheReferences({ manifestPath: path });
  assert.throws(() => reader.read());
});
