import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { requestDeviceBuildCancellation } from "../mac-helper/src/deviceBuilder.js";
import { cancelPersistedRenewalsForShutdown } from "../mac-helper/src/renewalShutdownPreload.js";

test("renewal shutdown cancellation is scoped and owner journaled", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-renewal-marker-"));
  try {
    const cancelPath = join(directory, ".cancelled");
    const build = {
      id: "build-1",
      state: "ready",
      pendingRenewal: { id: "renewal-1" },
      control: { cancelPath },
    };
    assert.equal(requestDeviceBuildCancellation(build, "shutdown"), true);
    const marker = JSON.parse(readFileSync(cancelPath, "utf8"));
    assert.equal(marker.scope, "renewal");
    assert.equal(marker.renewalID, "renewal-1");
    assert.equal(marker.owner.pid, process.pid);
    assert.ok(marker.owner.startedAt);
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
