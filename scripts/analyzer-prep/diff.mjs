#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  ANALYZER_MAX_OUTPUT_BYTES,
  ANALYZER_TIMEOUT_MS,
  analyzerRequestFromCase,
  assertPermissiveGate,
  differentialClass,
  normalizeAnalyzerExecution,
} from "./protocol.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const options = parseArguments(process.argv.slice(2));
const corpusPath = resolve(root, options.corpus || "test/fixtures/swift-analyzer/corpus.json");
const corpus = JSON.parse(readFileSync(corpusPath, "utf8"));
const corpusCases = corpus.cases.map((row) => hydrateCase(corpus.fields, row));
const legacyModule = await import(resolve(root, "mac-helper/src/liveReload.js"));

const rows = [];
for (const caseItem of corpusCases) {
  const legacy = classifyLegacy(caseItem, legacyModule);
  if (legacy.route !== caseItem.legacyExpected.route) {
    throw new Error(
      `${caseItem.id}: legacy snapshot expected ${caseItem.legacyExpected.route}, received ${legacy.route}.`,
    );
  }

  const candidate = options.candidateCommand
    ? runCandidate(options.candidateCommand, analyzerRequestFromCase(caseItem))
    : {
      protocolVersion: 1,
      analyzerVersion: "corpus-prototype-snapshot-1",
      requestId: `corpus:${caseItem.id}`,
      status: "ok",
      route: caseItem.prototypeExpected.route,
      reasonCode: "CORPUS_PROTOTYPE_SNAPSHOT",
    };

  const className = differentialClass(legacy.route, candidate.route);
  assertPermissiveGate(caseItem, className);
  rows.push({
    id: caseItem.id,
    category: caseItem.category,
    legacyRoute: legacy.route,
    candidateRoute: candidate.route,
    class: className,
    productionEnabled: caseItem.productionEnabled,
    physicalProofRequired: caseItem.physicalProofRequired,
    candidateReasonCode: candidate.reasonCode,
    notes: caseItem.notes || "",
  });
}

const summary = {
  corpusSchemaVersion: corpus.schemaVersion,
  corpusCases: rows.length,
  equivalent: rows.filter((row) => row.class === "equivalent").length,
  stricter: rows.filter((row) => row.class === "stricter").length,
  potentiallyMorePermissive: rows.filter((row) => row.class === "potentially-more-permissive").length,
  differences: rows.filter((row) => row.class !== "equivalent").length,
};

if (options.format === "json") {
  process.stdout.write(`${JSON.stringify({ summary, rows }, null, 2)}\n`);
} else {
  process.stdout.write(renderMarkdown(summary, rows));
}

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

function classifyLegacy(caseItem, module) {
  if (caseItem.mode === "edit-set") return module.classifyEditSet({ files: caseItem.files });
  return module.classifySwiftSource(caseItem.beforeSource, caseItem.afterSource);
}

function runCandidate(command, request) {
  const execution = spawnSync(resolve(command), [], {
    input: `${JSON.stringify(request)}\n`,
    encoding: "utf8",
    timeout: ANALYZER_TIMEOUT_MS,
    maxBuffer: ANALYZER_MAX_OUTPUT_BYTES,
    stdio: ["pipe", "pipe", "pipe"],
  });
  return normalizeAnalyzerExecution({
    status: execution.status,
    stdout: execution.stdout,
    stderr: execution.stderr,
    error: execution.error,
    timedOut: execution.error?.code === "ETIMEDOUT",
  }, { requestId: request.requestId });
}

function renderMarkdown(summary, rows) {
  const out = [
    "# Swift analyzer differential report",
    "",
    `- Corpus cases: ${summary.corpusCases}`,
    `- Equivalent: ${summary.equivalent}`,
    `- Stricter: ${summary.stricter}`,
    `- Potentially more permissive: ${summary.potentiallyMorePermissive}`,
    `- Total differences: ${summary.differences}`,
    "",
    "| Case | Category | Legacy | Candidate | Classification | Gate |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of rows) {
    const gate = row.class === "potentially-more-permissive"
      ? "DISABLED; physical proof required"
      : "eligible for differential review";
    out.push(
      `| ${row.id} | ${row.category} | ${row.legacyRoute} | ${row.candidateRoute} | ${row.class} | ${gate} |`,
    );
  }
  out.push("");
  return `${out.join("\n")}\n`;
}

function parseArguments(argv) {
  const options = { format: "markdown", corpus: "", candidateCommand: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") options.format = "json";
    else if (arg === "--corpus") options.corpus = argv[++index] || "";
    else if (arg === "--candidate-command") options.candidateCommand = argv[++index] || "";
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}
