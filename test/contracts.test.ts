import assert from "node:assert/strict";
import test from "node:test";
import { isCommandResult } from "../mac-helper/src/contracts/command.js";
import { isAppRecord, isDeviceBuildRecord } from "../mac-helper/src/contracts/build.js";
import { isDeliveryOutcome } from "../mac-helper/src/contracts/delivery.js";
import { isPairingRecord } from "../mac-helper/src/contracts/pairing.js";
import { isProcessIdentity } from "../mac-helper/src/contracts/process.js";
import { isRuntimeJournal, isRuntimeLease } from "../mac-helper/src/contracts/runtime.js";
import { isSessionRecord } from "../mac-helper/src/contracts/session.js";

test("contract validators accept complete trusted-shape records", () => {
  assert.equal(
    isCommandResult({
      command: "xcodebuild",
      argv: ["-version"],
      exitCode: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    }),
    true,
  );
  assert.equal(
    isProcessIdentity({
      pid: 42,
      processGroupID: 42,
      executable: "/usr/bin/example",
      startToken: "token",
      instanceNonce: "nonce",
    }),
    true,
  );
  assert.equal(
    isSessionRecord({
      schemaVersion: 1,
      sessionID: "session",
      projectPath: "/tmp/project",
      createdAt: "2026-08-04T00:00:00Z",
      updatedAt: "2026-08-04T00:00:00Z",
      phase: "ready",
      stream: {
        streamID: "stream",
        simulatorUDID: "simulator",
        port: 47217,
        startedAt: "2026-08-04T00:00:00Z",
        state: "ready",
      },
      accessToken: "secret",
    }),
    true,
  );
  assert.equal(
    isPairingRecord({
      schemaVersion: 1,
      installationID: "installation",
      invitationID: "invitation",
      state: "pending",
      createdAt: "2026-08-04T00:00:00Z",
      expiresAt: "2026-08-04T01:00:00Z",
    }),
    true,
  );
});

test("contract validators reject malformed or untrusted records", () => {
  assert.equal(isAppRecord({ appID: "app", bundleID: "bundle", state: "ready" }), false);
  assert.equal(isDeviceBuildRecord({ buildID: "build", state: "ready", buildNumber: "7" }), false);
  assert.equal(
    isDeliveryOutcome({ outcome: "livePatch", requestID: "request", fallbackUsed: "no" }),
    false,
  );
  assert.equal(isRuntimeLease({ leaseID: "lease", state: "held" }), false);
  assert.equal(isRuntimeJournal({ journalID: "journal", entries: [{ event: "start" }] }), false);
});

test("runtime journal and delivery validators preserve explicit process outcomes", () => {
  assert.equal(
    isRuntimeJournal({
      schemaVersion: 1,
      journalID: "journal",
      process: "helper",
      entries: [{ sequence: 1, event: "started", recordedAt: "2026-08-04T00:00:00Z" }],
    }),
    true,
  );
  assert.equal(
    isRuntimeLease({
      schemaVersion: 1,
      leaseID: "lease",
      owner: "helper",
      target: "simulator",
      state: "held",
      acquiredAt: "2026-08-04T00:00:00Z",
      expiresAt: "2026-08-04T00:01:00Z",
    }),
    true,
  );
  assert.equal(
    isDeliveryOutcome({
      outcome: "livePatch",
      requestID: "request",
      fallbackUsed: false,
      proof: {
        sessionID: "session",
        rootRevision: "revision",
        acknowledgedAt: "2026-08-04T00:00:00Z",
      },
    }),
    true,
  );
});
