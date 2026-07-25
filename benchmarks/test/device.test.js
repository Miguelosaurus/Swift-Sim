import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { runDeviceBenchmark } from "../src/device.js";
import { selectTrustedDevice } from "../src/deviceSession.js";

const repositoryRoot = resolve(new URL("../..", import.meta.url).pathname);
const corpusPath = join(repositoryRoot, "benchmarks", "corpora", "core", "corpus.json");
const fixtureRoot = join(repositoryRoot, "benchmarks", "fixtures", "sources");

test("device runner proves a hot edit and baseline restore through injected adapters", async () => {
  const outputDirectory = mkdtempSync(join(tmpdir(), "swift-sim-device-test-"));
  const lines = [
    'SWIFT_SIM_BENCHMARK {"case":"baseline","value":"catalog","revision":1}',
  ];
  const session = {
    waitForLine: async () => {
      if (!lines.length) throw new Error("fake console exhausted");
      return lines.shift();
    },
    close() {},
  };
  try {
    const result = await runDeviceBenchmark({
      corpusPath,
      fixtureRoot,
      project: join(repositoryRoot, "benchmarks", "fixtures", "HotReloadBenchmarks.xcodeproj"),
      scheme: "CatalogApp",
      device: "test-device",
      outputDirectory,
      caseID: "copy-literal-01",
      adapters: {
        doctor: async () => ({ deviceInstalls: { ready: true }, remoteHotReload: { ready: true } }),
        selectDevice: async () => ({ identifier: "test-device" }),
        build: async () => ({ bundleID: "com.swiftSim.benchmark.catalog", appPath: "/tmp/fixture.app" }),
        install: async () => {},
        launch: async () => session,
        route: async ({ restore }) => {
          lines.push(restore
            ? 'SWIFT_SIM_BENCHMARK {"case":"baseline","value":"catalog","revision":3}'
            : 'SWIFT_SIM_BENCHMARK {"case":"copy-literal-01","value":"copy-edited-01","revision":2}');
          return { action: "hot-reload", reasonCode: "IMPLEMENTATION_ONLY", timing: { totalMs: 1 } };
        },
      },
      runId: "device-test",
    });
    assert.equal(result.summary.device.confirmedHotEdits, 1);
    assert.equal(result.attempts[0].terminalState, "semantically-observed");
    assert.equal(result.attempts[0].confirmedNoBuild, true);
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
});

test("device selection never guesses among trusted devices", () => {
  const devices = { devices: [{ name: "phone-a", identifier: "a" }, { name: "phone-b", identifier: "b" }] };
  assert.equal(selectTrustedDevice({ device: "phone-a", devices }).identifier, "a");
  assert.throws(() => selectTrustedDevice({ devices }), /explicitly/);
  assert.throws(() => selectTrustedDevice({ device: "phone", devices }), /exactly one/);
});
