import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inspectPhase4HelperProcessIdentity, phase4HelperProcessIdentityPath } from "../mac-helper/src/persistence/phase4HelperProcessIdentity.js";
import { validatePhase4MaintenanceEvidence } from "../mac-helper/src/persistence/phase4CutoverPreflight.js";

const ABSENT = Object.freeze({state: "absent"});
const PS_ARGS = ["-axo", "pid=,command=", "-ww"];
const LSOF_ARGS = ["-nP", "-iTCP:47217", "-sTCP:LISTEN", "-t"];
const INVENTORY = `1 /sbin/launchd\n${process.pid} /opt/homebrew/bin/node /tmp/maintenance-runner.js\n`;
const OK_INVENTORY = {status: 0, stdout: INVENTORY, stderr: ""};
const NO_LISTENER = {status: 1, stdout: "", stderr: ""};

function withRoot(operation) {
  const stateRoot = mkdtempSync(join(tmpdir(), "swift-sim-old-helper-absence-"));
  try { return operation(stateRoot); }
  finally { rmSync(stateRoot, {recursive: true, force: true}); }
}

function inspect(stateRoot, ...observations) {
  const inventory = observations.length > 0 ? observations[0] : OK_INVENTORY;
  const listener = observations.length > 1 ? observations[1] : NO_LISTENER;
  const calls = [];
  const result = inspectPhase4HelperProcessIdentity({stateRoot, expectedIdentity: ABSENT,
    spawnSync(command, args, options) {
      assert.deepEqual(options, {encoding: "utf8"});
      calls.push(command);
      if (command === "/bin/ps") {
        assert.deepEqual(args, PS_ARGS);
        if (inventory instanceof Error) throw inventory;
        return inventory;
      }
      assert.equal(command, "/usr/sbin/lsof");
      assert.deepEqual(args, LSOF_ARGS);
      if (listener instanceof Error) throw listener;
      return listener;
    },
  });
  return {result, calls};
}

function ceremony(processIdentity = ABSENT) {
  return {exactCandidateSHA: true, hostedVerifyGreen: true, maintenanceAuthorized: true,
    writersQuiesced: true, cleanupDisabledForCutover: true, sqliteProcessAuthorityAbsent: true,
    unrelatedPhaseWorkAbsent: true, candidateSHA: "a".repeat(40), verifyRunID: 123, processIdentity};
}

test("old-release missing journal uses measured absence without creating state or a PID", () => {
  withRoot((stateRoot) => {
    const before = readdirSync(stateRoot);
    const {result, calls} = inspect(stateRoot);
    assert.deepEqual(calls, ["/bin/ps", "/usr/sbin/lsof"]);
    assert.equal(result.state, "absent-unrecorded");
    assert.equal(result.helperQuiesced, true);
    assert.equal(result.exactIdentityVerified, true);
    assert.equal(result.journalPresent, false);
    assert.equal(result.pid, null);
    assert.equal(result.startedAt, null);
    assert.equal(result.writerCount, 0);
    assert.deepEqual(readdirSync(stateRoot), before);
  });
});

test("absence request is a strict union and never authorizes caller-authored PID absence", () => {
  assert.deepEqual(validatePhase4MaintenanceEvidence(ceremony(), "prepare").processIdentity, ABSENT);
  for (const identity of [
    {state: "absent", pid: 42}, {state: "absent", startedAt: "anything"},
    {state: "absent", helperQuiesced: true}, {state: "unknown"},
    {pid: 42}, {pid: 1, startedAt: "anything"}, {pid: 42, startedAt: ""},
  ]) {
    assert.throws(() => validatePhase4MaintenanceEvidence(ceremony(identity), "prepare"), /helper.*(?:identity|PID|request|token)/i);
  }
  assert.deepEqual(validatePhase4MaintenanceEvidence(ceremony({pid: 42, startedAt: "exact Darwin token"}), "prepare").processIdentity,
    {pid: 42, startedAt: "exact Darwin token"});
});

test("absence request cannot bypass an existing, corrupt, or dangling-symlink identity journal", () => {
  withRoot((stateRoot) => {
    mkdirSync(join(stateRoot, "runtime"), {mode: 0o700});
    const path = phase4HelperProcessIdentityPath(stateRoot);
    writeFileSync(path, "{corrupt", {mode: 0o600});
    assert.throws(() => inspect(stateRoot), /existing identity journal/);
  });
  withRoot((stateRoot) => {
    mkdirSync(join(stateRoot, "runtime"), {mode: 0o700});
    symlinkSync(join(stateRoot, "missing"), phase4HelperProcessIdentityPath(stateRoot));
    assert.throws(() => inspect(stateRoot), /existing identity journal/);
  });
});

test("all raw, compiled, CLI and wrapper helper launches block unrecorded absence", () => {
  const commands = [
    "/opt/homebrew/bin/node /installed/mac-helper/bin/swift-sim-helper-entry.js serve",
    "/opt/homebrew/bin/node /installed/dist/mac-helper/bin/swift-sim-helper-entry.js serve --port 49999",
    "node /installed/mac-helper/bin/swift-sim-helper.js serve",
    "node /installed/mac-helper/bin/swift-sim-entry.js serve",
    "node /installed/mac-helper/bin/swift-sim.js serve",
    "node /opt/homebrew/bin/swift-sim-helper serve",
    "node --enable-source-maps /installed/dist/mac-helper/bin/swift-sim-helper-entry.js serve",
    '"/opt/homebrew/bin/node" "/installed path/mac-helper/bin/swift-sim-helper-entry.js" serve',
    "/opt/homebrew/bin/swift-sim-helper serve",
    "/bin/bash /opt/homebrew/bin/swift-sim-helper serve",
    "node /installed/mac-helper/bin/swift-sim-device-gateway.js",
    "node /installed/mac-helper/bin/swift-sim-device-delivery-manager.js",
    "node /installed/mac-helper/bin/swift-sim-device-delivery.js",
    "node /installed/mac-helper/bin/swift-sim-owned-worker.js",
    "node /installed/mac-helper/bin/swift-sim-device-builder.js",
  ];
  for (const command of commands) {
    withRoot((stateRoot) => {
      const {result} = inspect(stateRoot, {...OK_INVENTORY, stdout: `${INVENTORY}9999 ${command}\n`});
      assert.equal(result.helperQuiesced, false, command);
      assert.equal(result.exactIdentityVerified, false, command);
      assert.equal(result.writerCount, 1, command);
    });
  }
});

test("default no-argument helpers and custom-port forms cannot establish absence", () => {
  const commands = [
    "node /installed/mac-helper/bin/swift-sim-helper-entry.js",
    "node /installed/mac-helper/bin/swift-sim-helper.js",
    "node /installed/dist/mac-helper/bin/swift-sim-helper-entry.js",
    "node --enable-source-maps /installed/dist/mac-helper/bin/swift-sim-helper-entry.js",
    "node --enable-source-maps /installed/dist/mac-helper/bin/swift-sim-helper-entry.js --port 49999",
    "node /opt/homebrew/bin/swift-sim-helper",
    "/opt/homebrew/bin/swift-sim-helper",
    "/opt/homebrew/bin/swift-sim-helper --port 49999",
    "/bin/bash /opt/homebrew/bin/swift-sim-helper",
  ];
  for (const command of commands) withRoot((stateRoot) => {
    const {result} = inspect(stateRoot, {...OK_INVENTORY, stdout: `${INVENTORY}9999 ${command}\n`});
    assert.equal(result.helperQuiesced, false, command);
    assert.equal(result.writerCount, 1, command);
  });
});

test("only the exact observing maintenance PID is excluded from possible writers", () => {
  withRoot((stateRoot) => {
    const command = `node ${fileURLToPath(new URL("../mac-helper/bin/swift-sim-phase4-cutover.js", import.meta.url))} prepare`;
    const ownInventory = `1 /sbin/launchd\n${process.pid} ${command}\n`;
    const own = inspect(stateRoot, {...OK_INVENTORY, stdout: ownInventory}).result;
    assert.equal(own.helperQuiesced, true);
    assert.equal(own.writerCount, 0);
    const concurrent = inspect(stateRoot, {...OK_INVENTORY, stdout: `${ownInventory}9999 ${command}\n`}).result;
    assert.equal(concurrent.helperQuiesced, false);
    assert.equal(concurrent.writerCount, 1);
  });
});

test("an observing helper or unverified maintenance basename cannot exempt itself", () => {
  const commands = [
    "node /installed/mac-helper/bin/swift-sim-helper-entry.js",
    "node /installed/dist/mac-helper/bin/swift-sim-helper-entry.js serve --port 49999",
    "node /installed/mac-helper/bin/swift-sim-device-gateway.js",
    "node /different-package/mac-helper/bin/swift-sim-phase4-cutover.js prepare",
  ];
  for (const command of commands) withRoot((stateRoot) => {
    const ownInventory = `1 /sbin/launchd\n${process.pid} ${command}\n`;
    const {result} = inspect(stateRoot, {...OK_INVENTORY, stdout: ownInventory});
    assert.equal(result.helperQuiesced, false, command);
    assert.equal(result.writerCount, 1, command);
  });
});

test("unrelated shells merely mentioning a helper and one-shot version commands are not writers", () => {
  const commands = [
    '/bin/zsh -c echo "/installed/mac-helper/bin/swift-sim-helper-entry.js serve"',
    '/bin/bash -lc "cat /installed/mac-helper/bin/swift-sim-helper-entry.js serve"',
    "node /installed/mac-helper/bin/swift-sim-entry.js version",
    "node /tmp/unrelated.js serve",
  ];
  withRoot((stateRoot) => {
    const stdout = INVENTORY + commands.map((command, index) => `${9000 + index} ${command}\n`).join("");
    assert.equal(inspect(stateRoot, {...OK_INVENTORY, stdout}).result.helperQuiesced, true);
  });
});

test("an unidentified listener still blocks absence even when no known helper appears", () => {
  withRoot((stateRoot) => {
    const {result} = inspect(stateRoot, OK_INVENTORY, {status: 0, stdout: "4242\n4242\n", stderr: ""});
    assert.equal(result.helperQuiesced, false);
    assert.equal(result.writerCount, 0);
    assert.equal(result.listenerCount, 1);
  });
});

test("process inventory errors and incomplete or malformed output fail closed", async (t) => {
  const cases = [
    ["thrown", new Error("ps unavailable")], ["missing", undefined], ["array", []],
    ["permission", {status: 0, stdout: INVENTORY, stderr: "permission denied"}],
    ["exit", {status: 1, stdout: "", stderr: ""}], ["empty", {status: 0, stdout: "", stderr: ""}],
    ["signal", {status: 0, stdout: INVENTORY, stderr: "", signal: "SIGTERM"}],
    ["error", {status: 0, stdout: INVENTORY, stderr: "", error: new Error("EACCES")}],
    ["missing stderr", {status: 0, stdout: INVENTORY}],
    ["malformed", {status: 0, stdout: `${INVENTORY}not a process\n`, stderr: ""}],
    ["duplicate", {status: 0, stdout: `${INVENTORY}1 /sbin/launchd\n`, stderr: ""}],
    ["no observer", {status: 0, stdout: "1 /sbin/launchd\n", stderr: ""}],
  ];
  for (const [name, result] of cases) await t.test(name, () => withRoot((stateRoot) => {
    assert.throws(() => inspect(stateRoot, result), /helper.*(?:observation|inventory)/);
  }));
});

test("listener observation errors never become no-listener evidence", async (t) => {
  const cases = [
    ["thrown", new Error("lsof unavailable")], ["missing", undefined], ["array", []],
    ["permission", {status: 1, stdout: "", stderr: "permission denied"}],
    ["exit", {status: 2, stdout: "", stderr: ""}], ["empty success", {status: 0, stdout: "", stderr: ""}],
    ["signal", {status: 1, stdout: "", stderr: "", signal: "SIGTERM"}],
    ["error", {status: 1, stdout: "", stderr: "", error: new Error("EACCES")}],
    ["missing stderr", {status: 1, stdout: ""}],
    ["contradiction", {status: 1, stdout: "4242", stderr: ""}],
    ["malformed", {status: 0, stdout: "not a PID", stderr: ""}],
  ];
  for (const [name, result] of cases) await t.test(name, () => withRoot((stateRoot) => {
    assert.throws(() => inspect(stateRoot, OK_INVENTORY, result), /helper.*(?:observation|listener)/);
  }));
});
