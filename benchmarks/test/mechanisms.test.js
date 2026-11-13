import { testCompiler } from "../../test/testCompiler.js";
import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyEditSet as original_classifyEditSet } from "../../mac-helper/src/liveReload.js";
import { loadCorpus } from "../src/corpus.js";
import { materializeCase } from "../src/materialize.js";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const corpusPath = join(repositoryRoot, "benchmarks", "corpora", "mechanisms", "corpus.json");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");

test("mechanism corpus keeps structural boundaries on the build lane", () => {
  const loaded = loadCorpus(corpusPath);
  const rebuild = loaded.corpus.cases.filter((value) => value.expectedLane === "build-device");
  assert.equal(rebuild.length, 3);
  for (const benchmarkCase of rebuild) {
    const materialized = materializeCase({
      fixtureRoot,
      corpusRoot: loaded.corpusRoot,
      benchmarkCase });
    try {
      assert.equal(classifyEditSet({ files: materialized.changes }).route, "rebuild-required", benchmarkCase.id);
    } finally {
      rmSync(materialized.runRoot, { recursive: true, force: true });
    }
  }
});

const classifyEditSet = (options = {}) => original_classifyEditSet({ ...options, compiler: testCompiler });

test("hot corpus cases classify as hot reload", () => {
  const loaded = loadCorpus(corpusPath);
  for (const benchmarkCase of loaded.corpus.cases.filter((value) => value.expectedLane === "hot-reload")) {
    const materialized = materializeCase({ fixtureRoot, corpusRoot: loaded.corpusRoot, benchmarkCase });
    try {
      const classification = classifyEditSet({ files: materialized.changes });
      assert.equal(classification.route, benchmarkCase.id === "initializer-body" ? "rebuild-required" : "hot-reload", benchmarkCase.id);
      if (benchmarkCase.id === "initializer-body") assert.equal(classification.reasonCode, "DECLARATION_CHANGED");
    }
    finally { rmSync(materialized.runRoot, { recursive: true, force: true }); }
  }
});
