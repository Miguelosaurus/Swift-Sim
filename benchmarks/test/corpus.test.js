import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadCorpus, validateCorpus } from "../src/corpus.js";
import { readFileSync } from "node:fs";

function validFixture() {
  const root = mkdtempSync(join("/tmp", "swift-sim-corpus-"));
  mkdirSync(join(root, "mutations"));
  writeFileSync(join(root, "mutations", "one.patch"), "diff --git a/a.swift b/a.swift\n");
  const corpus = {
    schemaVersion: 1,
    corpusVersion: "test-1",
    fixtureRevision: "fixture-sha",
    cases: [{
      id: "one",
      workload: "CatalogApp",
      category: "style-modifier",
      validity: "valid",
      expectedLane: "hot-reload",
      confirmationPolicy: "swiftui-body",
      mutation: "mutations/one.patch",
      baselineHashes: {
        "CardView.swift": createHash("sha256").update("baseline").digest("hex"),
      },
      oracle: { case: "one", value: "expected" },
    }],
  };
  return { root, corpus };
}

test("loads a valid corpus and rejects unsafe mutation paths", () => {
  const { root, corpus } = validFixture();
  writeFileSync(join(root, "corpus.json"), JSON.stringify(corpus));
  const loaded = loadCorpus(join(root, "corpus.json"));
  assert.equal(loaded.corpus.corpusVersion, "test-1");
});

test("validates a corpus without requiring a schema runtime dependency", () => {
  const { root, corpus } = validFixture();
  writeFileSync(join(root, "corpus.json"), JSON.stringify(corpus));
  const loaded = loadCorpus(join(root, "corpus.json"));
  assert.equal(loaded.corpus.cases[0].id, "one");

  const invalid = validateCorpus({ ...corpus, cases: [{ ...corpus.cases[0], mutation: "../escape.patch" }] }, { corpusRoot: root });
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /escapes|relative path/);
});

test("rejects duplicate IDs, invalid hashes, and secret-bearing values", () => {
  const { root, corpus } = validFixture();
  const duplicate = {
    ...corpus,
    fixtureRevision: "https://example.trycloudflare.com/d?token=secret",
    cases: [corpus.cases[0], { ...corpus.cases[0] }],
  };
  duplicate.cases[1].baselineHashes = { "CardView.swift": "bad" };
  const result = validateCorpus(duplicate, { corpusRoot: root });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.includes("duplicates")));
  assert.ok(result.errors.some((error) => error.includes("SHA-256")));
  assert.ok(result.errors.some((error) => error.includes("token")));
});

test("the committed core corpus has the prescribed 240-case shape", () => {
  const corpusPath = new URL("../corpora/core/corpus.json", import.meta.url);
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  const valid = corpus.cases.filter((benchmarkCase) => benchmarkCase.validity === "valid");
  const errors = corpus.cases.filter((benchmarkCase) => benchmarkCase.validity === "authoring-error");
  assert.equal(corpus.cases.length, 240);
  assert.equal(valid.filter((benchmarkCase) => benchmarkCase.expectedLane === "hot-reload").length, 120);
  assert.equal(valid.filter((benchmarkCase) => benchmarkCase.expectedLane === "build-device").length, 100);
  assert.equal(errors.length, 20);
  assert.equal(corpus.metadata.totalCases, 240);
  assert.equal(corpus.metadata.multiFileOperations, 25);
  assert.equal(corpus.metadata.smokeHotCases, 24);
});

test("smoke hot mutations do not hide explicit semantic markers", () => {
  const corpusPath = new URL("../corpora/core/corpus.json", import.meta.url);
  const corpusRoot = new URL("../corpora/core/", import.meta.url);
  const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
  for (const benchmarkCase of corpus.cases.filter((value) => value.smoke && value.expectedLane === "hot-reload")) {
    const mutationURL = new URL(benchmarkCase.mutation, corpusRoot);
    const mutation = readFileSync(mutationURL, "utf8");
    assert.doesNotMatch(mutation, /^\+\s*if false \{.*BenchmarkMarkerView\(caseID:/m);
  }
});
