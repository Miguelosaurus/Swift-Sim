import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestDeviceBuildCancellation } from "../mac-helper/src/deviceBuilder.js";
import { renewalCancellationPath } from "../mac-helper/src/renewalCancellation.js";
import { cancelPersistedRenewalsForShutdown } from "../mac-helper/src/renewalShutdownPreload.js";

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return String(result.stdout || "").trim();
}

test("renewal shutdown cancellation is process scoped and owner journaled", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-renewal-marker-"));
  try {
    const cancelPath = join(directory, ".cancelled");
    const markerPath = renewalCancellationPath(cancelPath);
    const build = {
      id: "build-1",
      state: "ready",
      pendingRenewal: { id: "renewal-1" },
      control: { cancelPath },
    };
    assert.equal(requestDeviceBuildCancellation(build, "shutdown"), true);
    assert.notEqual(markerPath, cancelPath);
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    assert.equal(marker.scope, "renewal");
    assert.equal(marker.renewalID, "renewal-1");
    assert.equal(marker.owner.pid, process.pid);
    assert.ok(marker.owner.startedAt);
    assert.equal(existsSync(cancelPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a foreign helper renewal marker does not cancel this helper", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-renewal-isolation-"));
  try {
    const cancelPath = join(directory, ".cancelled");
    const foreignPath = renewalCancellationPath(cancelPath, {
      pid: process.pid + 10_000,
      nonce: "foreign-helper",
    });
    writeFileSync(foreignPath, JSON.stringify({
      scope: "renewal",
      owner: {
        pid: process.pid,
        startedAt: processStartedAt(process.pid),
      },
      cancelledAt: new Date().toISOString(),
    }));
    assert.equal(existsSync(cancelPath), false);
    assert.equal(existsSync(foreignPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("shutdown sweep cancels every persisted renewal independently of task-map keys", () => {
  const cancelled = [];
  const builds = [
    { id: "one", state: "ready", pendingRenewal: { id: "r1" }, control: { cancelPath: "/one" } },
    { id: "two", state: "ready", pendingRenewal: { id: "r2" }, control: { cancelPath: "/two" } },
    { id: "done", state: "ready", control: { cancelPath: "/done" } },
  ];
  const result = cancelPersistedRenewalsForShutdown({
    deviceBuildStore: { list: () => builds },
    cancelBuild: (build) => { cancelled.push(build.id); return true; },
  });
  assert.deepEqual(cancelled, ["one", "two"]);
  assert.deepEqual(result, { cancelled: 2 });
});
