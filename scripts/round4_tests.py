#!/usr/bin/env python3
from pathlib import Path

path = Path("test/buildValidation.test.js")
text = path.read_text()
text += r'''

test("successful validation rejects and terminates surviving descendants", () => withProjects(async ({ root, projectA }) => {
  const pidPath = join(root, "success-descendant.pid");
  const descendantSource = "process.on('SIGHUP', () => {}); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)";
  const descendant = `${JSON.stringify(process.execPath)} -e ${JSON.stringify(descendantSource)}`;
  const command = `${descendant} & echo $! > ${JSON.stringify(pidPath)}; exit 0`;
  await assert.rejects(
    runRequiredBuildValidation({
      project: projectA,
      preferences: {
        buildValidationMode: "always",
        buildValidationCommand: command,
        buildValidationWorkingDirectory: "",
        buildValidationTimeoutSeconds: 10,
      },
    }),
    /descendant processes were still running/
  );
  const pid = Number(readFileSync(pidPath, "utf8").trim());
  const status = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  assert.equal(status.status === 0 && !String(status.stdout || "").trim().startsWith("Z"), false);
}));
'''
path.write_text(text)

path = Path("test/deviceBuildStore.test.js")
text = path.read_text()
text += r'''

test("all unexpired capability generations remain valid beyond sixteen renewals", () => withStore((store) => {
  let build = completeBuild(store, "Example", "com.example.capabilities", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://generation-0.example.com";
  build.expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
  build.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: build.expiresAt,
    generation: "generation-0",
    referenceID: `build:${build.id}`,
  };
  store.save(build);
  const tokens = [build.token];
  for (let index = 1; index <= 20; index += 1) {
    const renewed = store.renewInstallLink(build.id, { ttlMinutes: 120 });
    renewed.remoteBaseUrl = `https://generation-${index}.example.com`;
    renewed.expiresAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    renewed.delivery = {
      mode: "quick-tunnel",
      provider: "cloudflare-quick-tunnel",
      expiresAt: renewed.expiresAt,
      generation: `generation-${index}`,
      referenceID: `renewal:${renewed.pendingRenewal.id}`,
    };
    store.save(renewed);
    build = store.get(build.id);
    tokens.push(build.token);
  }
  const saved = store.get(build.id);
  assert.equal(saved.capabilities.length, 20);
  for (const token of tokens.slice(0, -1)) {
    assert.ok(saved.capabilities.some((capability) => capability.token === token));
  }
}));

test("app deletion durably queues every delivery reference across restart", () => withStore((store, directory) => {
  const statePath = join(directory, "builds.json");
  const build = completeBuild(store, "Example", "com.example.cleanup", "TEAM123", "1.0", "1");
  build.delivery = {
    mode: "quick-tunnel",
    generation: "current-generation",
    referenceID: `build:${build.id}`,
  };
  build.capabilities = [{
    token: "old-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    remoteBaseUrl: "https://old.example.com",
    delivery: {
      mode: "quick-tunnel",
      generation: "old-generation",
      referenceID: "renewal:old",
    },
    installTTLMinutes: 5,
    createdAt: new Date().toISOString(),
  }];
  store.save(build);
  assert.equal(store.deleteApp(build.app.identity, { deleteArtifacts: false }), true);
  const restarted = new DeviceBuildStore({ path: statePath });
  const jobs = restarted.listDeliveryReferenceCleanupJobs();
  assert.equal(jobs.length, 2);
  assert.deepEqual(new Set(jobs.map((job) => job.generation)), new Set(["current-generation", "old-generation"]));
}));

test("an early not-installed observation retains the install verification deadline", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.install", "TEAM123", "1.0", "1");
  store.markInstallRequested(build.id);
  store.saveVerification(build.id, {
    state: "not-installed",
    devices: [{ name: "Phone", state: "not-installed", version: "", build: "" }],
  });
  const saved = store.get(build.id);
  assert.equal(saved.installation.state, "not-installed");
  assert.ok(Date.parse(saved.installation.verificationDeadlineAt) > Date.now());
}));
'''
path.write_text(text)

path = Path("test/deviceBuilderTimeout.test.js")
text = path.read_text()
text = text.replace(
    'import { spawnSync } from "node:child_process";',
    'import { spawn, spawnSync } from "node:child_process";'
)
text = text.replace(
    'import { runBuffered } from "../mac-helper/src/deviceBuilderCore.js";',
    '''import {
  parseBuildSettings,
  runBuffered,
  terminateRecordedDeviceBuildWorker,
} from "../mac-helper/src/deviceBuilderCore.js";'''
)
text += r'''

test("multi-target settings select the scheme application instead of an extension", () => {
  const settings = parseBuildSettings(`
Build settings for action build and target Example:
    TARGET_NAME = Example
    PRODUCT_NAME = Example
    PRODUCT_TYPE = com.apple.product-type.application
    WRAPPER_EXTENSION = app
    PRODUCT_BUNDLE_IDENTIFIER = com.example.app
    DEVELOPMENT_TEAM = TEAMAPP

Build settings for action build and target ExampleWidget:
    TARGET_NAME = ExampleWidget
    PRODUCT_NAME = ExampleWidget
    PRODUCT_TYPE = com.apple.product-type.app-extension
    WRAPPER_EXTENSION = appex
    PRODUCT_BUNDLE_IDENTIFIER = com.example.app.widget
    DEVELOPMENT_TEAM = TEAMEXT
`, "Example");
  assert.equal(settings.PRODUCT_BUNDLE_IDENTIFIER, "com.example.app");
  assert.equal(settings.DEVELOPMENT_TEAM, "TEAMAPP");
});

test("a persisted interrupted worker identity can be terminated after restart", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-worker-recovery-"));
  const cancelPath = join(directory, ".cancelled");
  const workerPath = `${cancelPath}.worker.json`;
  const child = spawn(process.execPath, [
    "-e",
    "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
  ], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  try {
    const identity = spawnSync("/bin/ps", ["-p", String(child.pid), "-o", "lstart="], { encoding: "utf8" });
    writeFileSync(workerPath, JSON.stringify({
      pid: child.pid,
      startedAt: String(identity.stdout || "").trim(),
    }));
    const terminated = await terminateRecordedDeviceBuildWorker({
      id: "build-id",
      control: { cancelPath },
    });
    assert.equal(terminated, true);
    assert.equal(processIsAlive(child.pid), false);
  } finally {
    try { process.kill(-child.pid, "SIGKILL"); } catch {}
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
path.write_text(text)

path = Path("Companion/SwiftSimCompanionTests/InstallationStateTests.swift")
text = path.read_text()
text += r'''

extension InstallationStateTests {
    @MainActor
    func testDeviceBuildResponsesAreBoundToCurrentViewGeneration() {
        let first = DeviceBuildSession(id: "first", token: "token-a", baseURL: URL(string: "https://a.example")!)
        let second = DeviceBuildSession(id: "second", token: "token-b", baseURL: URL(string: "https://b.example")!)
        XCTAssertTrue(SessionStore.deviceBuildResponseIsCurrent(
            current: first,
            expected: first,
            currentRevision: 3,
            expectedRevision: 3
        ))
        XCTAssertFalse(SessionStore.deviceBuildResponseIsCurrent(
            current: second,
            expected: first,
            currentRevision: 3,
            expectedRevision: 3
        ))
        XCTAssertFalse(SessionStore.deviceBuildResponseIsCurrent(
            current: first,
            expected: first,
            currentRevision: 4,
            expectedRevision: 3
        ))
    }

    @MainActor
    func testInstallVerificationRemainsActiveAcrossNegativeObservations() {
        XCTAssertTrue(SessionStore.installationVerificationIsActive("requested"))
        XCTAssertTrue(SessionStore.installationVerificationIsActive("not-installed"))
        XCTAssertTrue(SessionStore.installationVerificationIsActive("different-version"))
        XCTAssertFalse(SessionStore.installationVerificationIsActive("verified"))
    }

    @MainActor
    func testThreeStagedPairingsCanCancelBackToTheFirstCredential() throws {
        let defaults = UserDefaults.standard
        let firstID = "https://first-\(UUID().uuidString).example"
        let secondID = "https://second-\(UUID().uuidString).example"
        let thirdID = "https://third-\(UUID().uuidString).example"
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "first-\(UUID().uuidString)", pairingID: firstID))
        let firstAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "second-\(UUID().uuidString)", pairingID: secondID))
        let secondAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "third-\(UUID().uuidString)", pairingID: thirdID))
        let thirdAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        defer {
            PairingCredentialVault.cancelStagedPairing(pairingID: thirdID)
            PairingCredentialVault.cancelStagedPairing(pairingID: secondID)
            PairingCredentialVault.cancelStagedPairing(pairingID: firstID)
            deleteTestToken(account: firstAccount)
            deleteTestToken(account: secondAccount)
            deleteTestToken(account: thirdAccount)
            defaults.removeObject(forKey: "pairedMacPendingCredentialHistory")
            defaults.removeObject(forKey: "pairedMacPreviousPendingCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPreviousPendingPairingID")
        }

        PairingCredentialVault.cancelStagedPairing(pairingID: thirdID)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingCredentialAccount"), secondAccount)
        PairingCredentialVault.cancelStagedPairing(pairingID: secondID)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingCredentialAccount"), firstAccount)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingPairingID"), firstID)
    }
}
'''
path.write_text(text)
