import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyEditSet, generateDynamicReplacementSource } from "../../mac-helper/src/liveReload.js";
import { loadCorpus } from "../src/corpus.js";
import { materializeCase } from "../src/materialize.js";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const corpusPath = join(repositoryRoot, "benchmarks", "corpora", "mechanisms", "corpus.json");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");

test("mechanism corpus keeps all implementation forms on the hot lane", () => {
  const loaded = loadCorpus(corpusPath);
  const hot = loaded.corpus.cases.filter((value) => value.expectedLane === "hot-reload");
  assert.equal(hot.length, 9);
  for (const benchmarkCase of hot) {
    const materialized = materializeCase({
      fixtureRoot,
      corpusRoot: loaded.corpusRoot,
      benchmarkCase,
    });
    try {
      const classification = classifyEditSet({ files: materialized.changes });
      assert.equal(classification.route, "hot-reload", benchmarkCase.id);
      const change = materialized.changes[0];
      const generated = generateDynamicReplacementSource({
        source: readFileSync(change.afterPath, "utf8"),
        beforeSource: readFileSync(change.beforePath, "utf8"),
        sourcePath: change.afterPath,
        moduleName: "MechanismApp",
      });
      assert.match(generated, /@_dynamicReplacement\(for:/, benchmarkCase.id);
      assert.match(generated, new RegExp(`(?:caseID: "${benchmarkCase.id}"|${benchmarkCase.oracle.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`), benchmarkCase.id);
    } finally {
      rmSync(materialized.runRoot, { recursive: true, force: true });
    }
  }
});

test("mechanism corpus keeps structural boundaries on the build lane", () => {
  const loaded = loadCorpus(corpusPath);
  const rebuild = loaded.corpus.cases.filter((value) => value.expectedLane === "build-device");
  assert.equal(rebuild.length, 3);
  for (const benchmarkCase of rebuild) {
    const materialized = materializeCase({
      fixtureRoot,
      corpusRoot: loaded.corpusRoot,
      benchmarkCase,
    });
    try {
      assert.equal(classifyEditSet({ files: materialized.changes }).route, "rebuild-required", benchmarkCase.id);
    } finally {
      rmSync(materialized.runRoot, { recursive: true, force: true });
    }
  }
});
