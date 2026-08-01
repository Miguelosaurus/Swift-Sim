import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { classifyEditSet, generateDynamicReplacementSource } from "../../mac-helper/src/liveReload.js";
import { loadCorpus } from "../src/corpus.js";
import { materializeCase } from "../src/materialize.js";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const corpusPath = join(repositoryRoot, "benchmarks", "corpora", "liquid-glass", "corpus.json");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");

test("every Liquid Glass hot case produces a body replacement with its semantic marker", () => {
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
      const beforeSource = readFileSync(change.beforePath, "utf8");
      const afterSource = readFileSync(change.afterPath, "utf8");
      const generated = generateDynamicReplacementSource({
        source: afterSource,
        beforeSource,
        sourcePath: change.afterPath,
        moduleName: "CatalogApp",
      });
      assert.match(generated, /@_dynamicReplacement\(for: body\)/, benchmarkCase.id);
      assert.match(generated, new RegExp(`caseID: "${benchmarkCase.id}"`), benchmarkCase.id);
    } finally {
      rmSync(materialized.runRoot, { recursive: true, force: true });
    }
  }
});

test("every Liquid Glass structural case remains a rebuild", () => {
  const loaded = loadCorpus(corpusPath);
  for (const benchmarkCase of loaded.corpus.cases.filter((value) => value.expectedLane === "build-device")) {
    const materialized = materializeCase({
      fixtureRoot,
      corpusRoot: loaded.corpusRoot,
      benchmarkCase,
    });
    try {
      const classification = classifyEditSet({ files: materialized.changes });
      assert.equal(classification.route, "rebuild-required", benchmarkCase.id);
    } finally {
      rmSync(materialized.runRoot, { recursive: true, force: true });
    }
  }
});

test("body replacements preserve enclosing availability annotations", () => {
  const sourcePath = join(fixtureRoot, "CatalogApp", "LiquidGlassCoverageScreen.swift");
  const source = readFileSync(sourcePath, "utf8");
  const generated = generateDynamicReplacementSource({
    source: source
      .replace("cornerRadius: 12", "cornerRadius: 13")
      .replace("opacity(placement == .inline ? 0.9 : 1.0)", "opacity(placement == .inline ? 0.8 : 1.0)"),
    beforeSource: source,
    sourcePath,
    moduleName: "CatalogApp",
  });
  assert.match(generated, /@available\(iOS 26\.1, \*\)\nextension LiquidGlassCoverageScreen \{/);
  assert.match(generated, /@available\(iOS 26\.1, \*\)\nextension LiquidGlassCoverageScreen\.BottomAccessoryPlacementProbe \{/);
});
