#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadCorpus } from "./corpus.js";
import { generateSummary, readAttempts, renderReport, writeReports } from "./report.js";
import { runStaticBenchmark } from "./static.js";
import { runDeviceBenchmark } from "./device.js";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const defaultCorpus = join(repositoryRoot, "benchmarks", "corpora", "core", "corpus.json");
const defaultFixture = join(repositoryRoot, "benchmarks", "fixtures", "sources");

Promise.resolve(main()).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  const values = parseFlags(args);
  if (command === "validate") return validate(values);
  if (command === "static") return staticRun(values);
  if (command === "device") return deviceRun(values);
  if (command === "report") return report(values);
  printHelp();
}

function validate(values) {
  const corpusPath = values.corpus || defaultCorpus;
  const loaded = loadCorpus(corpusPath);
  console.log(JSON.stringify({
    valid: true,
    corpusVersion: loaded.corpus.corpusVersion,
    cases: loaded.corpus.cases.length,
    corpusPath: loaded.corpusPath,
  }, null, 2));
}

function staticRun(values) {
  const result = runStaticBenchmark({
    corpusPath: values.corpus || defaultCorpus,
    fixtureRoot: values.fixture || defaultFixture,
    outputDirectory: values.output,
    repeat: Number(values.repeat || 3),
    seed: Number(values.seed || 1),
  });
  console.log(JSON.stringify({
    outputDirectory: result.outputDirectory,
    deterministic: result.summary.static.deterministic,
    dangerousFalseLive: result.summary.classifier.dangerousFalseLive,
    cases: result.attempts.length,
  }, null, 2));
}

function report(values) {
  const runDirectory = resolve(values.run || values.output || "");
  const attemptsPath = join(runDirectory, "attempts.jsonl");
  const summaryPath = join(runDirectory, "summary.json");
  if (!existsSync(attemptsPath)) throw new Error(`Missing ${attemptsPath}.`);
  const attempts = readAttempts(attemptsPath);
  const existing = existsSync(summaryPath) ? JSON.parse(readFileSync(summaryPath, "utf8")) : {};
  const summary = generateSummary({
    runId: existing.runId || values.run || "report",
    corpus: existing.corpus || {},
    attempts,
    environment: existing.environment || {},
    limitations: existing.limitations || [],
  });
  writeReports({ outputDirectory: runDirectory, summary, attempts });
  console.log(renderReport(summary));
}

async function deviceRun(values) {
  const result = await runDeviceBenchmark({
    corpusPath: values.corpus || defaultCorpus,
    fixtureRoot: values.fixture || defaultFixture,
    project: values.project,
    scheme: values.scheme,
    device: values.device,
    outputDirectory: values.output,
    workload: values.workload,
    caseID: values.case,
    expectedLane: values.lane || values["expected-lane"],
    smoke: Boolean(values.smoke),
    full: Boolean(values.full),
    seed: Number(values.seed || 1),
    iterations: Number(values.iterations || (values.full ? 3 : 1)),
    buildSettings: values["build-setting"]
      ? (Array.isArray(values["build-setting"] ) ? values["build-setting"] : [values["build-setting"]])
      : [],
  });
  console.log(JSON.stringify({
    outputDirectory: result.outputDirectory,
    confirmedHotEdits: result.summary.device.confirmedHotEdits,
    attemptedValidHotEdits: result.summary.device.attemptedValidHotEdits,
  }, null, 2));
}

function parseFlags(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const next = args[index + 1];
    if (next && !next.startsWith("--")) {
      values[key] = values[key] === undefined
        ? next
        : Array.isArray(values[key]) ? [...values[key], next] : [values[key], next];
      index += 1;
    } else {
      values[key] = true;
    }
  }
  return values;
}

function printHelp() {
  console.log(`Swift Sim benchmark tooling

Usage:
  node benchmarks/src/cli.js validate [--corpus <path>]
  node benchmarks/src/cli.js static [--corpus <path>] [--fixture <path>] [--output <path>] [--repeat 3] [--seed 1]
  node benchmarks/src/cli.js device --project <path> --scheme <name> --device <device> [--corpus <path>] [--smoke|--full] [--lane hot-reload|build-device] [--seed 1] [--iterations 3] [--build-setting KEY=VALUE] [--output <path>]
  node benchmarks/src/cli.js report --run <results-directory>
`);
}
