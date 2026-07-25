import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { routeLiveEditSet } from "../../mac-helper/src/liveReload.js";
import { loadCorpus } from "./corpus.js";
import { materializeCase } from "./materialize.js";
import { BenchmarkOracle, benchmarkMarkerPrefix } from "./oracle.js";
import { generateSummary, readAttempts, writeReports } from "./report.js";
import { sanitizeError, sanitizeValue } from "./sanitize.js";
import { launchDeviceConsole, listDevices, selectTrustedDevice } from "./deviceSession.js";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);

export async function runDeviceBenchmark({
  corpusPath,
  fixtureRoot,
  project,
  scheme,
  device,
  outputDirectory,
  workload,
  caseID,
  smoke = false,
  full = false,
  seed = 1,
  iterations = full ? 3 : 1,
  buildSettings = [],
  adapters = {},
  runId = `device-${Date.now()}-${randomUUID().slice(0, 8)}`,
} = {}) {
  if (!device) throw new Error("Device benchmark requires --device; Swift Sim never guesses among physical devices.");
  if (!project) throw new Error("Device benchmark requires --project.");
  if (!scheme) throw new Error("Device benchmark requires --scheme.");
  const loaded = loadCorpus(corpusPath);
  const output = resolve(outputDirectory || join(loaded.corpusRoot, "..", "..", "results", runId));
  mkdirSync(output, { recursive: true });
  const attemptsPath = join(output, "attempts.jsonl");
  const previous = existsSync(attemptsPath) ? readAttempts(attemptsPath) : [];
  const completed = new Set(previous.filter((attempt) => attempt.terminalState).map((attempt) => attempt.attemptId));
  const selected = selectCases(loaded.corpus.cases, { workload, caseID, smoke, full });
  if (!selected.length) throw new Error("No benchmark cases matched the requested device lane.");
  const environment = await (adapters.doctor || defaultDoctor)();
  assertDoctorReady(environment);
  const selectedDevice = await (adapters.selectDevice || defaultSelectDevice)({ device });
  const deviceAddress = selectedDevice.identifier || selectedDevice.udid || selectedDevice.dnsName || device;
  const build = await (adapters.build || defaultBuild)({ project, scheme, device: deviceAddress, runId, buildSettings });
  const bundleID = build.bundleID || build.bundleIdentifier;
  if (!bundleID) throw new Error("Signed fixture build did not report a bundle identifier.");
  await (adapters.install || defaultInstall)({ device: deviceAddress, appPath: build.appPath });
  const session = await (adapters.launch || defaultLaunch)({ device: deviceAddress, bundleID });
  const oracle = new BenchmarkOracle();
  await waitForMarker(session, oracle, { caseID: "baseline" });
  const attempts = [...previous];
  for (let iteration = 1; iteration <= Number(iterations); iteration += 1) {
    for (const benchmarkCase of seededOrder(selected, Number(seed) + iteration - 1)) {
      const attemptId = `${benchmarkCase.id}:device:${iteration}`;
      if (completed.has(attemptId)) continue;
      const caseResult = await runCase({
        benchmarkCase,
        attemptId,
        iteration,
        fixtureRoot,
        corpusRoot: loaded.corpusRoot,
        project,
        scheme,
        session,
        oracle,
        adapters,
        runId,
      });
      const records = Array.isArray(caseResult) ? caseResult : [caseResult];
      attempts.push(...records);
      for (const record of records) appendFileSync(attemptsPath, `${JSON.stringify(sanitizeValue(record))}\n`, { mode: 0o600 });
      const attempt = records[0];
      if (attempt.dangerousFalseLive) {
        throw new Error(`Dangerous false-live result for ${benchmarkCase.id}; device run stopped.`);
      }
    }
  }
  session.close?.();
  const summary = generateSummary({
    runId,
    corpus: loaded.corpus,
    attempts,
    environment,
    limitations: [
      "Physical-device results are only valid for the named fixture, Xcode toolchain, device, and Swift Sim engine versions.",
      "The corpus is curated and must not be reported as an everyday-edit percentage.",
    ],
  });
  writeReports({ outputDirectory: output, summary, attempts });
  return { outputDirectory: output, summary, attempts };
}

async function runCase({ benchmarkCase, attemptId, iteration, fixtureRoot, corpusRoot, project, scheme, session, oracle, adapters, runId }) {
  const startedAt = performance.now();
  let materialized;
  const base = {
    schemaVersion: 1,
    deviceAttempt: true,
    runId,
    attemptId,
    caseId: benchmarkCase.id,
    iteration,
    workload: benchmarkCase.workload,
    category: benchmarkCase.category,
    validity: benchmarkCase.validity,
    expectedLane: benchmarkCase.expectedLane,
    operation: "edit",
    terminalState: "failed",
    applied: false,
    refreshAcknowledged: false,
    oracleMatched: false,
    confirmedNoBuild: false,
    timing: { totalMs: 0 },
  };
  try {
    materialized = materializeCase({ fixtureRoot, corpusRoot, benchmarkCase });
    const route = await (adapters.route || defaultRoute)({ project, scheme, changes: materialized.changes });
    const predictedLane = routeLane(route);
    const attempt = {
      ...base,
      predictedLane,
      action: route.action,
      reasonCode: route.reasonCode,
      requestId: route.requestId || "",
      timing: { ...(route.timing || {}), totalMs: elapsedMs(startedAt) },
      applied: route.action === "hot-reload",
    };
    if (benchmarkCase.expectedLane === "build-device") {
      attempt.terminalState = predictedLane === "build-device" ? "fallback-selected" : "dangerous-false-live";
      attempt.dangerousFalseLive = predictedLane === "hot-reload";
      return attempt;
    }
    if (predictedLane !== "hot-reload") {
      attempt.terminalState = "hot-reload-failed";
      attempt.errorCode = route.reasonCode || "LIVE_NOT_READY";
      return attempt;
    }
    const marker = await waitForMarker(session, oracle, benchmarkCase.oracle);
    attempt.terminalState = "semantically-observed";
    attempt.refreshAcknowledged = true;
    attempt.oracleMatched = true;
    attempt.revision = marker.revision;
    attempt.priorRevision = marker.revision - 1;
    attempt.confirmedNoBuild = true;
    attempt.timing = { ...(route.timing || {}), oracleMs: elapsedMs(startedAt), totalMs: elapsedMs(startedAt) };
    const restoreAttempt = {
      schemaVersion: 1,
      deviceAttempt: true,
      runId,
      attemptId: `${attemptId}:restore`,
      caseId: benchmarkCase.id,
      iteration,
      workload: benchmarkCase.workload,
      category: benchmarkCase.category,
      validity: benchmarkCase.validity,
      expectedLane: benchmarkCase.expectedLane,
      operation: "restore",
      terminalState: "restoring",
      timing: {},
    };
    try {
      await restoreCase({ materialized, project, scheme, session, oracle, adapters });
      restoreAttempt.terminalState = "restored";
      restoreAttempt.refreshAcknowledged = true;
      attempt.restoreAcknowledged = true;
    } catch (restoreError) {
      restoreAttempt.terminalState = "restore-failed";
      restoreAttempt.errorCode = restoreError.code || "REFRESH_NOT_ACKNOWLEDGED";
      restoreAttempt.error = sanitizeError(restoreError);
      attempt.terminalState = "hot-reload-failed";
      attempt.confirmedNoBuild = false;
      attempt.restoreFailure = true;
      attempt.partialApplication = true;
    }
    return [attempt, restoreAttempt];
  } catch (error) {
    return {
      ...base,
      terminalState: "hot-reload-failed",
      errorCode: error.code || "DEVICE_RUN_FAILED",
      error: sanitizeError(error),
      timing: { totalMs: elapsedMs(startedAt) },
    };
  } finally {
    if (materialized) (adapters.cleanup || ((runRoot) => rmSync(runRoot, { recursive: true, force: true })))(materialized.runRoot);
  }
}

async function restoreCase({ materialized, project, scheme, session, oracle, adapters }) {
  const changes = materialized.changes.map((change) => ({
    ...change,
    beforePath: change.afterPath,
    afterPath: change.beforePath,
  }));
  const route = await (adapters.route || defaultRoute)({ project, scheme, changes, restore: true });
  if (route.action !== "hot-reload") throw Object.assign(new Error("Baseline restore was routed to a build."), { code: "REFRESH_NOT_ACKNOWLEDGED" });
  await waitForMarker(session, oracle, { caseID: "baseline" });
}

export async function waitForMarker(session, oracle, expected, timeoutMs = 60_000) {
  const expectedCase = expected.caseID || expected.case;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const line = await session.waitForLine({
      timeoutMs: Math.max(1, deadline - Date.now()),
      predicate: (value) => String(value).includes(benchmarkMarkerPrefix),
    });
    const marker = oracle.ingest(line);
    if (marker && marker.case === expectedCase && (expected.value === undefined || marker.value === expected.value)) return marker;
  }
  throw Object.assign(new Error(`Timed out waiting for marker ${expectedCase}.`), { code: "PATCH_TIMEOUT" });
}

function selectCases(cases, { workload, caseID, smoke, full }) {
  return cases.filter((benchmarkCase) => {
    if (caseID && benchmarkCase.id !== caseID) return false;
    if (workload && benchmarkCase.workload !== workload) return false;
    if (smoke && !benchmarkCase.smoke) return false;
    if (!full && !smoke && benchmarkCase.validity === "authoring-error") return false;
    return true;
  });
}

function routeLane(route) {
  if (route.action === "hot-reload") return "hot-reload";
  if (route.action === "build-device") return "build-device";
  return "none";
}

async function defaultDoctor() {
  const { stdout } = await execFileAsync(process.execPath, [join(repositoryRoot, "mac-helper", "bin", "swift-sim.js"), "doctor", "--json"]);
  return JSON.parse(stdout);
}

function assertDoctorReady(environment) {
  if (!environment?.deviceInstalls?.ready) throw new Error("Swift Sim doctor did not report device install readiness.");
  if (!environment?.remoteHotReload?.ready) throw new Error("Swift Sim doctor did not report remote hot reload readiness.");
}

function defaultSelectDevice({ device }) {
  return selectTrustedDevice({ device, devices: listDevices() });
}

async function defaultBuild({ project, scheme, buildSettings = [] }) {
  const cli = join(repositoryRoot, "mac-helper", "bin", "swift-sim.js");
  const args = [
    cli, "build-device",
    "--project", project,
    "--scheme", scheme,
    "--configuration", "Debug",
    "--allow-provisioning-updates",
  ];
  for (const setting of buildSettings) args.push("--build-setting", setting);
  let stdout;
  try {
    ({ stdout } = await execFileAsync(process.execPath, args, { maxBuffer: 16 * 1024 * 1024 }));
  } catch (error) {
    throw new Error(`Signed Debug fixture build failed for ${basename(project)} / ${scheme}: ${error.stderr || error.stdout || error.message}`);
  }
  const publicBuild = parseLastJSON(stdout);
  if (!publicBuild?.id || !publicBuild.app?.bundleIdentifier) throw new Error("Swift Sim did not return a usable device build record.");
  const statePath = join(process.env.HOME || "", ".swift-sim", "device-builds.json");
  const state = JSON.parse(readFileSync(statePath, "utf8"));
  const saved = (state.builds || []).find((entry) => entry.id === publicBuild.id);
  const ipaPath = saved?.artifacts?.ipaPath;
  if (!ipaPath) throw new Error("Swift Sim device build did not expose an installable artifact.");
  const extractionRoot = join(saved.artifacts.root, "benchmark-install");
  mkdirSync(extractionRoot, { recursive: true });
  await execFileAsync("unzip", ["-q", "-o", ipaPath, "-d", extractionRoot]);
  const appPath = join(extractionRoot, "Payload", `${scheme}.app`);
  if (!existsSync(appPath)) throw new Error("Signed IPA did not contain the expected fixture app.");
  return { bundleID: publicBuild.app.bundleIdentifier, appPath, publicBuild, saved };
}

async function defaultInstall({ device, appPath }) {
  if (!appPath) throw new Error("No signed .app path was returned by the build adapter.");
  await execFileAsync("xcrun", ["devicectl", "device", "install", "app", "--device", device, appPath]);
}

async function defaultLaunch({ device, bundleID }) {
  return launchDeviceConsole({ device, bundleID });
}

async function defaultRoute({ changes, project }) {
  return routeLiveEditSet({ project, files: changes });
}

function elapsedMs(startedAt) {
  return Math.max(0, Number((performance.now() - startedAt).toFixed(3)));
}

function parseLastJSON(output) {
  const text = String(output || "").trim();
  for (let index = text.lastIndexOf("{"); index >= 0; index = text.lastIndexOf("{", index - 1)) {
    try {
      const parsed = JSON.parse(text.slice(index));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // Continue backwards until the final complete JSON object is found.
    }
  }
  return null;
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
