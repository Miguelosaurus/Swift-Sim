import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceBuildArtifactMaintenanceService } from "../mac-helper/src/deviceBuildArtifactMaintenanceService.js";

const ARTIFACT_DIRECTORY = "/private/tmp/device-builds";
const BUILD_ID = "build-1";

type Build = {
  id: string;
  revision: number;
  state: string;
  liveReload: { compilerReady: boolean };
  artifacts: {
    root: string;
    archivePath: string;
    resultBundlePath: string;
    exportPath: string;
  };
};

type Inventory = {
  buildID: string;
  root: string;
  totalKiB: number;
  derivedDataKiB: number;
  archiveKiB: number;
  resultBundleKiB: number;
  exportPayloadKiB: number;
  scratchKiB: number;
  otherKiB: number;
};

function makeBuild(overrides: Partial<Build> = {}): Build {
  const root = overrides.artifacts?.root ?? `${ARTIFACT_DIRECTORY}/${BUILD_ID}`;
  return {
    id: BUILD_ID,
    revision: 7,
    state: "ready",
    liveReload: { compilerReady: false },
    artifacts: {
      root,
      archivePath: `${root}/App.xcarchive`,
      resultBundlePath: `${root}/App.xcresult`,
      exportPath: `${root}/export/App.ipa`,
    },
    ...overrides,
  };
}

function measured(build: Build, derivedDataKiB = 40): Inventory {
  const archiveKiB = 30;
  const resultBundleKiB = 10;
  const exportPayloadKiB = 20;
  const scratchKiB = 5;
  const otherKiB = 0;
  return {
    buildID: build.id,
    root: build.artifacts.root,
    totalKiB: derivedDataKiB + archiveKiB + resultBundleKiB + exportPayloadKiB + scratchKiB + otherKiB,
    derivedDataKiB,
    archiveKiB,
    resultBundleKiB,
    exportPayloadKiB,
    scratchKiB,
    otherKiB,
  };
}

function harness() {
  let current = makeBuild();
  let nextIssues: unknown[] = [];
  let applyMeasurement: Inventory | null = null;
  let getBuildCalls = 0;
  let secondRead: Build | null | undefined;
  const approved: string[] = [];
  const reclaimed: string[] = [];

  const service = createDeviceBuildArtifactMaintenanceService({
    listBuilds: () => [structuredClone(current)],
    getBuild: () => {
      getBuildCalls += 1;
      if (getBuildCalls === 2 && secondRead !== undefined) {
        return secondRead === null ? null : structuredClone(secondRead);
      }
      return structuredClone(current);
    },
    artifactDirectory: () => ARTIFACT_DIRECTORY,
    usage: {
      measure: async ({ builds }) => ({
        inventory: applyMeasurement ? [structuredClone(applyMeasurement)] : [measured(builds[0] as Build)],
        orphanRoots: [],
        issues: nextIssues,
      }),
    },
    executor: {
      approveContained: (_root, candidate) => {
        approved.push(candidate);
        return candidate;
      },
      reclaimApproved: async (path) => {
        reclaimed.push(path);
      },
    },
  });

  return {
    service,
    get current() {
      return current;
    },
    setCurrent(value: Build) {
      current = value;
    },
    setMeasurement(value: Inventory | null, issues: unknown[] = []) {
      applyMeasurement = value;
      nextIssues = issues;
    },
    setSecondRead(value: Build | null | undefined) {
      secondRead = value;
    },
    resetReads() {
      getBuildCalls = 0;
    },
    approved,
    reclaimed,
  };
}

async function derivedDataPlan(value: ReturnType<typeof harness>) {
  const plan = await value.service.plan();
  const action = plan.actions.find((candidate) => candidate.kind === "derivedData");
  assert.ok(action, "expected a derivedData maintenance action");
  return { ...plan, actions: [action] };
}

test("apply refuses a stale authoritative revision before reclamation", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  value.setCurrent({ ...value.current, revision: 8 });
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.refused, 1);
  assert.equal(result.removed, 0);
  assert.match(result.results[0]?.message ?? "", /revision changed/);
  assert.deepEqual(value.reclaimed, []);
});

test("apply refuses DerivedData when current policy becomes live-ready", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  const live = { ...value.current, liveReload: { compilerReady: true } };
  value.setCurrent(live);
  value.setMeasurement(measured(live));
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.refused, 1);
  assert.match(result.results[0]?.message ?? "", /retention classification/);
  assert.deepEqual(value.reclaimed, []);
});

test("apply refuses authoritative artifact-root drift", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  value.setCurrent(makeBuild({
    artifacts: {
      root: `${ARTIFACT_DIRECTORY}/different-root`,
      archivePath: `${ARTIFACT_DIRECTORY}/different-root/App.xcarchive`,
      resultBundlePath: `${ARTIFACT_DIRECTORY}/different-root/App.xcresult`,
      exportPath: `${ARTIFACT_DIRECTORY}/different-root/export/App.ipa`,
    },
  }));
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.refused, 1);
  assert.match(result.results[0]?.message ?? "", /root changed|not canonical/);
  assert.deepEqual(value.reclaimed, []);
});

test("apply refuses ambiguous fresh measurement", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  value.setMeasurement(measured(value.current), [{ code: "measurement-ambiguous" }]);
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.refused, 1);
  assert.match(result.results[0]?.message ?? "", /measurement is ambiguous/);
  assert.deepEqual(value.reclaimed, []);
});

test("apply treats a freshly measured absent component as idempotently complete", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  value.setMeasurement(measured(value.current, 0));
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.alreadyAbsent, 1);
  assert.equal(result.removed, 0);
  assert.deepEqual(value.reclaimed, []);
});

test("apply rechecks authoritative revision after fresh measurement", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  value.setMeasurement(measured(value.current));
  value.setSecondRead({ ...value.current, revision: 8 });
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.refused, 1);
  assert.match(result.results[0]?.message ?? "", /revision changed/);
  assert.deepEqual(value.reclaimed, []);
});

test("apply reclaims a stable fresh contained action exactly once", async () => {
  const value = harness();
  const plan = await derivedDataPlan(value);
  value.setMeasurement(measured(value.current));
  value.resetReads();

  const result = await value.service.apply(plan);
  assert.equal(result.removed, 1);
  assert.equal(result.refused, 0);
  assert.equal(value.approved.length, 1);
  assert.equal(value.reclaimed.length, 1);
  assert.equal(value.reclaimed[0], plan.actions[0]?.path);
});
