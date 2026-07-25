import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classifierSummary, deviceSummary, workflowSummary } from "./statistics.js";
import { sanitizeValue } from "./sanitize.js";

export const SUMMARY_SCHEMA_VERSION = 1;

export function readAttempts(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid benchmark JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

export function generateSummary({ runId, corpus, attempts = [], environment = {}, limitations = [] } = {}) {
  const records = [...attempts].sort((left, right) =>
    String(left.attemptId || "").localeCompare(String(right.attemptId || ""))
  );
  return {
    schemaVersion: SUMMARY_SCHEMA_VERSION,
    runId: String(runId || "unknown-run"),
    claim: claimFor({ corpus, attempts: records }),
    corpus: sanitizeValue(corpus || {}),
    environment: sanitizeValue(environment),
    classifier: classifierSummary(records),
    device: deviceSummary(records),
    workflow: workflowSummary(records),
    limitations: [...limitations].map(String).sort(),
  };
}

export function renderReport(summary) {
  const classifier = summary.classifier || {};
  const device = summary.device || {};
  const workflow = summary.workflow || {};
  const lines = [
    "# Swift Sim Hot Reload Benchmark",
    "",
    `Run: ${summary.runId}`,
    "",
    `> ${summary.claim || "Scoped benchmark result; no universal coverage claim."}`,
    "",
    "## Classifier safety",
    "",
    `- Cases: ${classifier.total ?? 0}`,
    `- Valid cases: ${classifier.validTotal ?? classifier.total ?? 0}`,
    `- Authoring-error cases: ${classifier.authoringErrorCount ?? 0}`,
    `- Dangerous false-live results: ${classifier.dangerousFalseLive ?? 0}`,
    `- Safe precision: ${formatRate(classifier.safePrecision)}`,
    `- Eligible-routing recall: ${formatRate(classifier.eligibleRoutingRecall)}`,
    "",
    "| Expected | Hot reload | Build device | None |",
    "| --- | ---: | ---: | ---: |",
    ...matrixRows(classifier.matrix),
    "",
    "## Physical device",
    "",
    `- Valid hot edits attempted: ${device.attemptedValidHotEdits ?? 0}`,
    `- Semantically confirmed: ${device.confirmedHotEdits ?? 0}`,
    `- Fallbacks: ${device.fallbackCount ?? 0}`,
    `- Timeouts: ${device.timeoutCount ?? 0}`,
    `- Restore failures: ${device.restoreFailureCount ?? 0}`,
    `- Partial applications: ${device.partialApplicationCount ?? 0}`,
    `- Latency (p50 / p95): ${formatMs(device.latency?.p50)} / ${formatMs(device.latency?.p95)}`,
    "",
    "## Chronological workflow",
    "",
    `- Valid edits: ${workflow.validEdits ?? 0}`,
    `- Confirmed no-build edits: ${workflow.confirmedNoBuildEdits ?? 0}`,
    `- Acceleration rate: ${formatRate(workflow.accelerationRate?.proportion)}`,
    "",
    "## Environment",
    "",
    "```json",
    JSON.stringify(summary.environment || {}, null, 2),
    "```",
    "",
    "## Limitations",
    "",
    ...(summary.limitations?.length
      ? summary.limitations.map((limitation) => `- ${limitation}`)
      : ["- This report has no additional limitations recorded."]),
    "",
  ];
  return lines.join("\n");
}

export function writeReports({ outputDirectory, summary, attempts = [] }) {
  mkdirSync(outputDirectory, { recursive: true });
  const attemptsPath = join(outputDirectory, "attempts.jsonl");
  const summaryPath = join(outputDirectory, "summary.json");
  const reportPath = join(outputDirectory, "report.md");
  const serializedAttempts = attempts.map((attempt) => `${JSON.stringify(sanitizeValue(attempt))}\n`).join("");
  writeFileSync(attemptsPath, serializedAttempts, { mode: 0o600 });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  writeFileSync(reportPath, renderReport(summary), { mode: 0o600 });
  return { attemptsPath, summaryPath, reportPath };
}

function claimFor({ corpus, attempts }) {
  const chronological = attempts.length > 0
    && attempts.some((attempt) => attempt.confirmedNoBuild !== undefined);
  if (chronological) return "Chronological real-app result; see the declared denominator and limitations.";
  const corpusVersion = corpus?.corpusVersion || "the named corpus";
  return `Scoped result for ${corpusVersion}; curated corpus data is not an everyday-edit percentage.`;
}

function matrixRows(matrix = {}) {
  return ["hot-reload", "build-device", "none"].map((expected) => {
    const row = matrix[expected] || {};
    return `| ${expected} | ${row["hot-reload"] || 0} | ${row["build-device"] || 0} | ${row.none || 0} |`;
  });
}

function formatRate(value) {
  return value === null || value === undefined ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function formatMs(value) {
  return value === null || value === undefined ? "n/a" : `${Number(value).toFixed(1)} ms`;
}
