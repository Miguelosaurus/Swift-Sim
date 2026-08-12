import assert from "node:assert/strict";
import test from "node:test";
import { planDeviceBuildArtifactAudit } from "../mac-helper/src/deviceBuildArtifactAuditPlan.js";

function build(id, state, compilerReady = false) {
  return {
    id,
    state,
    liveReload: { compilerReady },
    artifacts: { root: `/private/tmp/device-builds/${id}` },
  };
}

test("historical audit reproduces the proven Phase 4Z2 safe-policy buckets", () => {
  const builds = [
    build("ready-non-live", "ready"),
    build("ready-live", "ready", true),
    build("failed", "failed", true),
  ];
  const inventory = [
    {
      buildID: "ready-non-live",
      root: builds[0].artifacts.root,
      totalKiB: 4_500_000,
      derivedDataKiB: 4_000_000,
      archiveKiB: 200_000,
      resultBundleKiB: 10_000,
      exportPayloadKiB: 200_000,
      scratchKiB: 2_236,
      otherKiB: 87_764,
    },
    {
      buildID: "ready-live",
      root: builds[1].artifacts.root,
      totalKiB: 33_600_000,
      derivedDataKiB: 33_312_980,
      archiveKiB: 8_000,
      resultBundleKiB: 4_000,
      exportPayloadKiB: 200_000,
      scratchKiB: 288,
      otherKiB: 74_732,
    },
    {
      buildID: "failed",
      root: builds[2].artifacts.root,
      totalKiB: 5_271_068,
      derivedDataKiB: 716_676,
      archiveKiB: 500_000,
      resultBundleKiB: 1_000,
      exportPayloadKiB: 100_000,
      scratchKiB: 500,
      otherKiB: 3_952_892,
    },
  ];

  const plan = planDeviceBuildArtifactAudit({
    builds,
    inventory,
    orphanRoots: [{ name: "empty-orphan", root: "/private/tmp/device-builds/empty", totalKiB: 0 }],
  });

  assert.equal(plan.readOnly, true);
  assert.equal(plan.buildCount, 3);
  assert.equal(plan.measuredBuildCount, 3);
  assert.equal(plan.reclaimableKiB, 9_495_592);
  assert.deepEqual(plan.buckets.nonLiveReadyIntermediates, { count: 1, totalKiB: 4_212_236 });
  assert.deepEqual(plan.buckets.liveReadyIntermediates, { count: 1, totalKiB: 12_288 });
  assert.deepEqual(plan.buckets.failedWholeRoots, { count: 1, totalKiB: 5_271_068 });
  assert.deepEqual(plan.buckets.protectedLiveDerivedData, { count: 1, totalKiB: 33_312_980 });
  assert.equal(plan.builds[0].policy, "ready-non-live");
  assert.equal(plan.builds[1].policy, "ready-live");
  assert.equal(plan.builds[2].policy, "failed");
});

test("live-ready DerivedData and ready install payloads remain protected", () => {
  const value = build("live", "ready", true);
  const plan = planDeviceBuildArtifactAudit({
    builds: [value],
    inventory: [{
      buildID: value.id,
      root: value.artifacts.root,
      totalKiB: 1_000,
      derivedDataKiB: 700,
      archiveKiB: 100,
      resultBundleKiB: 20,
      exportPayloadKiB: 150,
      scratchKiB: 10,
      otherKiB: 20,
    }],
  });

  assert.equal(plan.reclaimableKiB, 130);
  assert.equal(plan.builds[0].protectedDerivedDataKiB, 700);
  assert.equal(plan.builds[0].protectedInstallPayloadKiB, 150);
  assert.equal(plan.builds[0].protectedKiB, 870);
});

test("orphan and unbound roots are manual-review only", () => {
  const value = build("known", "ready");
  const plan = planDeviceBuildArtifactAudit({
    builds: [value],
    inventory: [
      {
        buildID: value.id,
        root: value.artifacts.root,
        totalKiB: 100,
        exportPayloadKiB: 100,
      },
      {
        buildID: "missing-record",
        root: "/private/tmp/device-builds/missing-record",
        totalKiB: 50,
      },
    ],
    orphanRoots: [{ name: "orphan", root: "/private/tmp/device-builds/orphan", totalKiB: 25 }],
  });

  assert.equal(plan.reclaimableKiB, 0);
  assert.equal(plan.manualReviewKiB, 75);
  assert.equal(plan.orphanRoots[0].disposition, "manual-review");
  assert.equal(plan.unboundInventory[0].disposition, "manual-review");
});

test("other states and missing measurements fail safe as protected", () => {
  const plan = planDeviceBuildArtifactAudit({
    builds: [build("building", "building")],
    inventory: [],
  });

  assert.equal(plan.builds[0].policy, "protected-other-state");
  assert.equal(plan.builds[0].measured, false);
  assert.equal(plan.reclaimableKiB, 0);
});

test("audit rejects duplicate and internally inconsistent inventory", () => {
  const value = build("duplicate", "ready");
  const entry = { buildID: value.id, root: value.artifacts.root, totalKiB: 10 };
  assert.throws(
    () => planDeviceBuildArtifactAudit({ builds: [value], inventory: [entry, entry] }),
    /Duplicate artifact inventory/,
  );
  assert.throws(
    () => planDeviceBuildArtifactAudit({
      builds: [value],
      inventory: [{
        buildID: value.id,
        root: value.artifacts.root,
        totalKiB: 10,
        derivedDataKiB: 11,
      }],
    }),
    /exceeds total size/,
  );
});
