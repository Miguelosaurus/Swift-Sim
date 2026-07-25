import test from "node:test";
import assert from "node:assert/strict";
import { generateSummary, renderReport } from "../src/report.js";

test("generates a scoped curated report without a universal claim", () => {
  const summary = generateSummary({
    runId: "run-1",
    corpus: { corpusVersion: "core-1" },
    attempts: [
      { attemptId: "one", expectedLane: "hot-reload", predictedLane: "hot-reload" },
    ],
    environment: { path: "/Users/miguel/project" },
  });
  assert.match(summary.claim, /Scoped result/);
  assert.equal(summary.environment.path, "<home>/project");
  const report = renderReport(summary);
  assert.match(report, /Classifier safety/);
  assert.match(report, /curated corpus data is not an everyday-edit percentage/);
});

test("report output is deterministic for the same records", () => {
  const input = {
    runId: "run-2",
    corpus: { corpusVersion: "core-1" },
    attempts: [
      { attemptId: "b", expectedLane: "build-device", predictedLane: "build-device" },
      { attemptId: "a", expectedLane: "hot-reload", predictedLane: "hot-reload" },
    ],
  };
  assert.equal(renderReport(generateSummary(input)), renderReport(generateSummary(input)));
});
