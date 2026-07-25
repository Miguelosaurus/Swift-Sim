import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { runStaticBenchmark } from "../src/static.js";

test("runs the committed core corpus with zero dangerous false-live results", () => {
  const output = mkdtempSync(join("/tmp", "swift-sim-static-test-"));
  const result = runStaticBenchmark({
    corpusPath: new URL("../corpora/core/corpus.json", import.meta.url).pathname,
    fixtureRoot: new URL("../fixtures/sources", import.meta.url).pathname,
    outputDirectory: output,
    repeat: 1,
    seed: 7,
  });
  assert.equal(result.attempts.length, 240);
  assert.equal(result.summary.classifier.dangerousFalseLive, 0);
  assert.equal(result.summary.static.deterministic, true);
});
