import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyEditSet } from "../../mac-helper/src/liveReload.js";
import { loadCorpus } from "./corpus.js";
import { materializeCase } from "./materialize.js";
import { generateSummary, writeReports } from "./report.js";
import { sanitizeError } from "./sanitize.js";

export function runStaticBenchmark({
  corpusPath,
  fixtureRoot,
  outputDirectory,
  repeat = 3,
  seed = 1,
} = {}) {
  const loaded = loadCorpus(corpusPath);
  const output = resolve(outputDirectory || join(loaded.corpusRoot, "..", "..", "results", "static"));
  mkdirSync(output, { recursive: true });
  const attempts = [];
  const fingerprints = [];
  const cases = seededOrder(loaded.corpus.cases, seed);

  for (let iteration = 1; iteration <= Number(repeat); iteration += 1) {
    const fingerprint = [];
    for (const benchmarkCase of cases) {
      let materialized;
      let classification;
      let errorCode = null;
      try {
        materialized = materializeCase({
          fixtureRoot,
          corpusRoot: loaded.corpusRoot,
          benchmarkCase,
        });
        classification = classifyEditSet({ files: materialized.changes });
      } catch (error) {
        errorCode = "MATERIALIZATION_FAILED";
        classification = {
          route: "rebuild-required",
          reasonCode: errorCode,
          reason: sanitizeError(error),
          changes: [],
        };
      }
      const predictedLane = laneForRoute(classification.route);
      const attempt = {
        schemaVersion: 1,
        runId: `static-${loaded.corpus.corpusVersion}-${seed}`,
        attemptId: `${benchmarkCase.id}:static:${iteration}`,
        caseId: benchmarkCase.id,
        iteration,
        workload: benchmarkCase.workload,
        category: benchmarkCase.category,
        validity: benchmarkCase.validity,
        expectedLane: benchmarkCase.expectedLane,
        predictedLane,
        reasonCode: classification.reasonCode || errorCode,
        terminalState: "classified",
        fallbackRequired: predictedLane === "build-device",
        timing: { classificationMs: 0, totalMs: 0 },
        errorCode,
      };
      attempts.push(attempt);
      fingerprint.push({ caseId: benchmarkCase.id, predictedLane, reasonCode: attempt.reasonCode });
      if (benchmarkCase.expectedLane === "build-device" && predictedLane === "hot-reload") {
        throw new Error(`Dangerous false-live result for ${benchmarkCase.id}.`);
      }
      if (materialized) cleanupMaterialized(materialized.runRoot);
    }
    fingerprints.push(fingerprint);
  }

  const stableFingerprint = JSON.stringify(fingerprints[0]);
  const deterministic = fingerprints.every((fingerprint) => JSON.stringify(fingerprint) === stableFingerprint);
  if (!deterministic) throw new Error("Static classifier results were not deterministic across repeats.");

  const summary = generateSummary({
    runId: `static-${loaded.corpus.corpusVersion}-${seed}`,
    corpus: loaded.corpus,
    attempts,
    limitations: ["This is a balanced curated corpus, not a chronological real-app edit distribution."],
  });
  summary.static = { repeat, seed, deterministic };
  writeReports({ outputDirectory: output, summary, attempts });
  writeFileSync(join(output, "fingerprint.json"), `${JSON.stringify(fingerprints[0], null, 2)}\n`, { mode: 0o600 });
  return { summary, attempts, outputDirectory: output };
}

export function laneForRoute(route) {
  if (route === "hot-reload") return "hot-reload";
  if (route === "rebuild-required") return "build-device";
  return "none";
}

function seededOrder(cases, seed) {
  const values = [...cases];
  let state = Number(seed) >>> 0;
  for (let index = values.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swap = state % (index + 1);
    [values[index], values[swap]] = [values[swap], values[index]];
  }
  return values;
}

function cleanupMaterialized(runRoot) {
  // The materializer owns disposable temp directories. Cleanup is intentionally
  // kept in one narrow helper so a future resumable device runner can retain a
  // case directory for diagnostics instead.
  rmSync(runRoot, { recursive: true, force: true });
}
