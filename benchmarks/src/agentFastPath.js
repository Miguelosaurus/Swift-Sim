import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";
import { classifyEditSet, routeLiveEditSet } from "../../mac-helper/src/liveReload.js";

const BODY_BEFORE = `struct Card: View { var body: some View { Text("A") } }`;
const BODY_AFTER = `struct Card: View { var body: some View { Text("B") } }`;
const STRUCTURAL_BEFORE = `struct Model { var count: Int = 0 }`;
const STRUCTURAL_AFTER = `struct Model { var count: Int = 0; var name = "Swift Sim" }`;

export const AGENT_FAST_PATH_SCENARIOS = Object.freeze([
  { id: "no-change", description: "unchanged Swift source", temperature: "cold", liveReady: false },
  { id: "structural", description: "stored-property edit", temperature: "cold", liveReady: true },
  { id: "mixed", description: "implementation plus non-Swift edit", temperature: "cold", liveReady: true },
  { id: "warm-hot", description: "warm implementation-only edit", temperature: "warm", liveReady: true },
  { id: "live-unavailable", description: "hot-safe edit without a live client", temperature: "warm", liveReady: false },
  { id: "transient-recovery", description: "warm edit recovered after timeout", temperature: "warm", liveReady: true },
  { id: "exhausted-recovery", description: "warm edit whose recovery cannot restore readiness", temperature: "warm", liveReady: true },
]);

const PRIMARY_SKILL_PATH = fileURLToPath(new URL(
  "../../plugins/swift-sim-companion/skills/remote-simulator-companion/SKILL.md",
  import.meta.url,
));

function primarySkillStats() {
  const source = readFileSync(PRIMARY_SKILL_PATH, "utf8");
  return {
    lines: source.split(/\r?\n/).length,
    words: source.trim() ? source.trim().split(/\s+/).length : 0,
    bytes: Buffer.byteLength(source, "utf8"),
  };
}

export async function runAgentFastPathBaseline({ repeat = 3, now = () => performance.now() } = {}) {
  const samples = [];
  for (const scenario of AGENT_FAST_PATH_SCENARIOS) {
    for (let iteration = 1; iteration <= repeat; iteration += 1) {
      samples.push(await runScenario(scenario, { iteration, now }));
    }
  }
  return {
    schemaVersion: 1,
    kind: "agent-fast-path-baseline",
    implementation: "classifier-first routeLiveEditSet with warm session seams",
    generatedAt: new Date().toISOString(),
    costSurface: {
      router: "live-reload-router",
      deepInspectionFunctions: [
        "listedLiveSchemes",
        "selectedXcodeApplicationTarget",
        "discoverTailnet",
        "engineControl",
      ],
      currentDeepInspectionSubprocesses: currentInspectionSubprocesses(),
      warmHotLogicalPath: [
        "classify",
        "load-session-descriptor",
        "validate-fingerprints",
        "engine-status",
        "preflight-or-generate",
        "inject",
        "engine-status-after-success",
      ],
    },
    primarySkill: primarySkillStats(),
    scenarios: samples,
  };
}

async function runScenario(scenario, { iteration, now }) {
  const calls = {
    inspect: 0,
    deepInspect: 0,
    warmInspect: 0,
    preflight: 0,
    compileBundle: 0,
    inject: 0,
    recover: 0,
  };
  const subprocesses = [];
  const timingBoundaries = [];
  let injectCalls = 0;
  const startedAt = now();
  const timed = async (operation, callback) => {
    const operationStartedAt = now();
    try {
      return await callback();
    } finally {
      const operationEndedAt = now();
      timingBoundaries.push({
        operation,
        startedAt: operationStartedAt,
        endedAt: operationEndedAt,
        durationMs: Math.max(0, operationEndedAt - operationStartedAt),
      });
    }
  };
  const result = await routeLiveEditSet({
    files: scenarioFiles(scenario.id),
    runtime: {
      now,
      ...(scenario.temperature === "warm" ? {
        warmInspect: () => timed("warm-inspect", async () => {
          calls.inspect += 1;
          calls.warmInspect += 1;
          return { ready: scenario.liveReady };
        }),
      } : {}),
      ...(scenario.temperature === "cold" ? {
        inspect: () => timed("inspect-live", async () => {
          calls.inspect += 1;
          calls.deepInspect += 1;
          subprocesses.push(...currentInspectionSubprocesses());
          return { ready: scenario.liveReady };
        }),
      } : {}),
      preflight: () => timed("preflight", async () => {
        calls.preflight += 1;
        return { mode: "interposition", generated: null, compileMs: 1 };
      }),
      compileBundle: () => timed("compile-bundle", async () => {
        calls.compileBundle += 1;
        return {
          mode: "swift-dynamic-replacement-bundle",
          generated: { dylibPath: "/private/swift-sim-benchmark/patch.dylib" },
          compileMs: 1,
        };
      }),
      inject: () => timed("inject", async () => {
        calls.inject += 1;
        injectCalls += 1;
        if (scenario.id === "transient-recovery" && injectCalls === 1) {
          return { succeeded: false, error: "The live patch timed out." };
        }
        if (scenario.id === "exhausted-recovery") {
          return { succeeded: false, error: "The live patch timed out." };
        }
        return {
          succeeded: true,
          requestID: `${scenario.id}-${iteration}`,
          report: { dynamic_replacements: 1, refresh_acknowledged: true },
          durationMs: 1,
          compileMs: 1,
          loadAckMs: 1,
          refreshAckMs: 1,
        };
      }),
      recover: () => timed("recover", async () => {
        calls.recover += 1;
        return { ready: scenario.id === "transient-recovery" };
      }),
    },
  });
  return {
    scenario: scenario.id,
    temperature: scenario.temperature,
    iteration,
    action: result.action,
    reasonCode: result.reasonCode || "",
    timing: {
      measuredMs: Math.max(0, now() - startedAt),
      ...(result.timing || {}),
    },
    calls,
    subprocesses,
    timingBoundaries,
    routeResultBytes: Buffer.byteLength(JSON.stringify(result), "utf8"),
    recovery: result.recovery || null,
    atomic: result.atomic ?? null,
    partialApplication: result.partialApplication ?? false,
  };
}

function currentInspectionSubprocesses() {
  // These are the subprocesses the current deep inspector can invoke. The
  // adapter records command shape only; no host paths, identities, or output
  // are copied into the baseline artifact.
  return [
    { executable: "xcodebuild", args: ["-list", "-json"] },
    { executable: "xcodebuild", args: ["-configuration", "Debug", "-showBuildSettings"] },
    { executable: "tailscale", args: ["ip", "-4"] },
    { executable: "tailscale", args: ["ip", "-4"] },
    { executable: "tailscale", args: ["ip", "-4"] },
  ];
}

function scenarioFiles(id) {
  if (id === "no-change") {
    return [{ path: "Card.swift", kind: "swift", status: "modified", beforeSource: BODY_BEFORE, afterSource: BODY_BEFORE }];
  }
  if (id === "structural") {
    return [{ path: "Model.swift", kind: "swift", status: "modified", beforeSource: STRUCTURAL_BEFORE, afterSource: STRUCTURAL_AFTER }];
  }
  if (id === "mixed") {
    return [
      { path: "Card.swift", kind: "swift", status: "modified", beforeSource: BODY_BEFORE, afterSource: BODY_AFTER },
      { path: "Info.plist", kind: "resource", status: "modified" },
    ];
  }
  return [{ path: "Card.swift", kind: "swift", status: "modified", beforeSource: BODY_BEFORE, afterSource: BODY_AFTER }];
}

export function summarizeBaseline(result) {
  const grouped = new Map();
  for (const sample of result.scenarios) {
    const group = grouped.get(sample.scenario) || [];
    group.push(sample);
    grouped.set(sample.scenario, group);
  }
  return Object.fromEntries([...grouped.entries()].map(([scenario, samples]) => [scenario, {
    iterations: samples.length,
    actions: [...new Set(samples.map((sample) => sample.action))],
    inspectCalls: samples.map((sample) => sample.calls.inspect),
    injectCalls: samples.map((sample) => sample.calls.inject),
    recoverCalls: samples.map((sample) => sample.calls.recover),
    measuredMs: samples.map((sample) => sample.timing.measuredMs),
    routeResultBytes: samples.map((sample) => sample.routeResultBytes),
    subprocessCounts: countSubprocesses(samples.flatMap((sample) => sample.subprocesses)),
  }]));
}

function countSubprocesses(subprocesses) {
  const counts = new Map();
  for (const subprocess of subprocesses) {
    const key = `${subprocess.executable} ${subprocess.args.join(" ")}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries(counts);
}

async function main() {
  const output = argumentValue("output");
  const repeat = Number(argumentValue("repeat") || 3);
  const result = await runAgentFastPathBaseline({ repeat: Number.isInteger(repeat) && repeat > 0 ? repeat : 3 });
  const report = { ...result, summary: summarizeBaseline(result) };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  if (output) writeFileSync(output, serialized, { mode: 0o600 });
  console.log(JSON.stringify({
    kind: report.kind,
    output: output || "stdout",
    repeat,
    scenarios: report.scenarios.length,
    summary: report.summary,
  }, null, 2));
}

function argumentValue(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
