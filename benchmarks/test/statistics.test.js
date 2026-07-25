import test from "node:test";
import assert from "node:assert/strict";
import {
  classifierSummary,
  deviceSummary,
  latencySummary,
  percentile,
  wilsonInterval,
  workflowSummary,
} from "../src/statistics.js";

test("uses nearest-rank percentiles deterministically", () => {
  assert.equal(percentile([3, 1, 2, 4], 0.5), 2);
  assert.equal(percentile([3, 1, 2, 4], 0.95), 4);
  assert.equal(percentile([], 0.5), null);
  assert.deepEqual(latencySummary([4, 1, 3, 2]), {
    count: 4, min: 1, p50: 2, p90: 4, p95: 4, p99: 4, max: 4,
  });
});

test("computes classifier safety and recall separately", () => {
  const result = classifierSummary([
    { expectedLane: "hot-reload", predictedLane: "hot-reload" },
    { expectedLane: "hot-reload", predictedLane: "build-device" },
    { expectedLane: "build-device", predictedLane: "build-device" },
  ]);
  assert.equal(result.dangerousFalseLive, 0);
  assert.equal(result.safePrecision, 1);
  assert.equal(result.eligibleRoutingRecall, 0.5);
});

test("marks only semantically observed revisions as device successes", () => {
  const result = deviceSummary([
    {
      deviceAttempt: true,
      expectedLane: "hot-reload", validity: "valid", category: "style", workload: "CatalogApp",
      terminalState: "semantically-observed", applied: true, refreshAcknowledged: true,
      oracleMatched: true, priorRevision: 2, revision: 3, timing: { totalMs: 600 },
    },
    {
      deviceAttempt: true,
      expectedLane: "hot-reload", validity: "valid", category: "style", workload: "CatalogApp",
      terminalState: "hot-reload-failed", errorCode: "PATCH_TIMEOUT",
    },
  ]);
  assert.equal(result.confirmedHotEdits, 1);
  assert.equal(result.fallbackCount, 1);
  assert.equal(result.timeoutCount, 1);
  assert.equal(result.latency.p50, 600);
});

test("does not count static classifier records as device attempts", () => {
  const summary = deviceSummary([{
    caseId: "static-only",
    validity: "valid",
    expectedLane: "hot-reload",
    predictedLane: "hot-reload",
    terminalState: "classified",
  }]);
  assert.equal(summary.attemptedValidHotEdits, 0);
  assert.equal(summary.confirmedHotEdits, 0);
});

test("returns bounded Wilson intervals", () => {
  const interval = wilsonInterval(5, 10);
  assert.equal(interval.proportion, 0.5);
  assert.ok(interval.low >= 0 && interval.high <= 1);
  assert.equal(wilsonInterval(0, 0).proportion, null);
});

test("keeps authoring errors out of the workflow denominator", () => {
  const result = workflowSummary([
    { validity: "valid", category: "style", workload: "CatalogApp", confirmedNoBuild: true },
    { validity: "valid", category: "layout", workload: "CatalogApp", confirmedNoBuild: false },
    { validity: "authoring-error", category: "syntax", workload: "CatalogApp", confirmedNoBuild: false },
  ]);
  assert.equal(result.validEdits, 2);
  assert.equal(result.confirmedNoBuildEdits, 1);
  assert.equal(result.accelerationRate.proportion, 0.5);
});
