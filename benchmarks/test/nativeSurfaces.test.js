import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyEditSet, generateDynamicReplacementSource } from "../../mac-helper/src/liveReload.js";
import { loadCorpus } from "../src/corpus.js";
import { materializeCase } from "../src/materialize.js";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const corpusPath = join(repositoryRoot, "benchmarks", "corpora", "native-surfaces", "corpus.json");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");

test("every native surface hot case produces a body replacement with its marker", () => {
  const loaded = loadCorpus(corpusPath);
  for (const benchmarkCase of loaded.corpus.cases.filter((value) => value.expectedLane === "hot-reload")) {
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
        moduleName: "CatalogApp",
      });
      assert.match(generated, /@_dynamicReplacement\(for: body\)/, benchmarkCase.id);
      assert.match(generated, new RegExp(`caseID: "${benchmarkCase.id}"`), benchmarkCase.id);
      assert.match(generated, /@available\(iOS 26\.1, \*\)\nextension NativeSurfaceCoverageScreen \{/);
    } finally {
      rmSync(materialized.runRoot, { recursive: true, force: true });
    }
  }
});

test("every native surface structural case remains a rebuild", () => {
  const loaded = loadCorpus(corpusPath);
  for (const benchmarkCase of loaded.corpus.cases.filter((value) => value.expectedLane === "build-device")) {
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
