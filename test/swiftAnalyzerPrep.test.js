import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ANALYZER_MAX_OUTPUT_BYTES,
  assertPermissiveGate,
  decodeBoundedAnalyzerOutput,
  differentialClass,
  normalizeAnalyzerExecution,
  validateAnalyzerResponse,
} from "../scripts/analyzer-prep/protocol.mjs";
import {
  classifyEditSet,
  classifySwiftSource,
} from "../mac-helper/src/liveReload.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixtureRoot = join(root, "test", "fixtures", "swift-analyzer");
const corpus = JSON.parse(readFileSync(join(fixtureRoot, "corpus.json"), "utf8"));
const protocolFixture = JSON.parse(readFileSync(join(fixtureRoot, "protocol.json"), "utf8"));
const degradedFixture = JSON.parse(readFileSync(join(fixtureRoot, "degraded.json"), "utf8"));
const corpusCases = corpus.cases.map((row) => hydrateCase(corpus.fields, row));

test("P7 analyzer corpus preserves the dispatch-base legacy classification snapshot", () => {
  assert.equal(corpus.dispatchBase, "38eee4bfb1eabc2184d92aa3e52fee28b139cbf5");
  assert.equal(corpusCases.length, 69);

  const categories = new Set(corpusCases.map((caseItem) => caseItem.category));
  for (const category of [
    "strings",
    "comments",
    "imports",
    "imports-adversarial",
    "stored-state",
    "signature",
    "declarations",
    "attributes",
    "modifiers",
    "modifiers-adversarial",
    "conditions",
    "macros",
    "macros-adversarial",
    "malformed",
    "regex",
    "edit-set",
  ]) {
    assert.ok(categories.has(category), `missing corpus category ${category}`);
  }

  for (const caseItem of corpusCases) {
    const result = caseItem.mode === "edit-set"
      ? classifyEditSet({ files: caseItem.files })
      : classifySwiftSource(caseItem.beforeSource, caseItem.afterSource);
    assert.equal(
      result.route,
      caseItem.legacyExpected.route,
      `${caseItem.id}: legacy classifier snapshot drifted`,
    );
  }
});

test("P7 differential snapshot classifies every corpus case and gates permissive results", () => {
  const counts = {
    equivalent: 0,
    stricter: 0,
    "potentially-more-permissive": 0,
  };

  for (const caseItem of corpusCases) {
    const className = differentialClass(
      caseItem.legacyExpected.route,
      caseItem.prototypeExpected.route,
    );
    counts[className] += 1;
    assertPermissiveGate(caseItem, className);
  }

  assert.deepEqual(counts, {
    equivalent: 50,
    stricter: 15,
    "potentially-more-permissive": 4,
  });

  const permissive = corpusCases.filter((caseItem) =>
    differentialClass(
      caseItem.legacyExpected.route,
      caseItem.prototypeExpected.route,
    ) === "potentially-more-permissive"
  );
  assert.ok(permissive.length > 0);
  assert.ok(permissive.every((caseItem) =>
    caseItem.productionEnabled === false
    && caseItem.physicalProofRequired === true
  ));
});

test("P7 protocol fixtures accept bounded valid responses", () => {
  const requestId = protocolFixture.request.requestId;
  for (const response of Object.values(protocolFixture.responses)) {
    const validation = validateAnalyzerResponse(response, { requestId });
    assert.equal(validation.ok, true);
    assert.deepEqual(
      decodeBoundedAnalyzerOutput(JSON.stringify(response), { requestId }),
      response,
    );
  }
});

test("P7 degraded analyzer executions all fail closed to signed rebuild", () => {
  const executions = {
    unavailable: { unavailable: true },
    timeout: { timedOut: true, status: null, stdout: "" },
    "process-failed": { status: 2, stdout: "", stderr: "process failure" },
    "malformed-json": { status: 0, stdout: "{not-json" },
    "version-mismatch": {
      status: 0,
      stdout: JSON.stringify({
        protocolVersion: 99,
        analyzerVersion: "future",
        requestId: "fixture:degraded",
        status: "ok",
        route: "hot-reload",
        reasonCode: "IMPLEMENTATION_ONLY",
      }),
    },
    "unsupported-permissive-invalid": {
      status: 0,
      stdout: JSON.stringify({
        protocolVersion: 1,
        analyzerVersion: "invalid",
        requestId: "fixture:degraded",
        status: "unsupported",
        route: "hot-reload",
        reasonCode: "UNSUPPORTED",
      }),
    },
    "missing-reason": {
      status: 0,
      stdout: JSON.stringify({
        protocolVersion: 1,
        analyzerVersion: "invalid",
        requestId: "fixture:degraded",
        status: "ok",
        route: "hot-reload",
      }),
    },
    "wrong-request": {
      status: 0,
      stdout: JSON.stringify({
        protocolVersion: 1,
        analyzerVersion: "invalid",
        requestId: "other",
        status: "ok",
        route: "hot-reload",
        reasonCode: "IMPLEMENTATION_ONLY",
      }),
    },
    "output-limit": {
      status: 0,
      stdout: "x".repeat(ANALYZER_MAX_OUTPUT_BYTES + 1),
    },
  };

  for (const fixture of degradedFixture.cases) {
    const result = normalizeAnalyzerExecution(executions[fixture.id], {
      requestId: "fixture:degraded",
    });
    assert.equal(result.route, degradedFixture.expectedRoute, fixture.id);
    assert.equal(result.status, "unsupported", fixture.id);
    assert.equal(result.reasonCode, fixture.expectedReasonCode, fixture.id);
  }
});

test("P7 differential CLI emits the expected reusable corpus summary", () => {
  const result = spawnSync(
    process.execPath,
    [join(root, "scripts", "analyzer-prep", "diff.mjs"), "--json"],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.summary, {
    corpusSchemaVersion: 2,
    corpusCases: 69,
    equivalent: 50,
    stricter: 15,
    potentiallyMorePermissive: 4,
    differences: 19,
  });
});

function hydrateCase(fields, row) {
  const item = Object.fromEntries(fields.map((field, index) => [field, row[index]]));
  const base = {
    id: item.id,
    category: item.category,
    description: item.description,
    mode: item.mode,
    legacyExpected: { route: item.legacyRoute },
    prototypeExpected: { route: item.prototypeRoute },
    physicalProofRequired: item.physicalProofRequired,
    productionEnabled: item.productionEnabled,
    notes: item.notes || "",
  };
  if (item.mode === "edit-set") return { ...base, files: item.payload };
  return { ...base, beforeSource: item.payload[0], afterSource: item.payload[1] };
}
