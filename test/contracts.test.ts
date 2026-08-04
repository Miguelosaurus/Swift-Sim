import assert from "node:assert/strict";
import { closeSync, mkdtempSync, openSync, readSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publicDeviceBuild, publicDeviceApp } from "../mac-helper/src/deviceBuilderCore.js";
import { DeviceBuildStore } from "../mac-helper/src/deviceBuildStore.js";
import {
  publishDeliveryGenerationState,
  readDeliveryGenerationState,
} from "../mac-helper/src/deviceDeliveryState.js";
import { runBuffered } from "../mac-helper/src/deviceBuilderCore.js";
import { PairingInviteStore } from "../mac-helper/src/pairingInviteStore.js";
import { PairingStore } from "../mac-helper/src/pairingStore.js";
import { publicSession } from "../mac-helper/src/links.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import {
  isDeviceBuildRecord,
  isPublicAppProjection,
  isPublicDeviceBuildProjection,
} from "../mac-helper/src/contracts/build.js";
import { isCommandResult } from "../mac-helper/src/contracts/command.js";
import {
  deliveryEnvelope,
  isDeliveryEnvelope,
  isDeliveryOutcome,
} from "../mac-helper/src/contracts/delivery.js";
import { isPairingCredential, isPairingInvitation } from "../mac-helper/src/contracts/pairing.js";
import { isDeliveryProcessIdentity } from "../mac-helper/src/contracts/process.js";
import { isDeliveryGenerationState } from "../mac-helper/src/contracts/runtime.js";
import { isPublicSessionProjection, isSessionRecord } from "../mac-helper/src/contracts/session.js";

test("contracts characterize the canonical delivery envelope", () => {
  const envelope = deliveryEnvelope({
    outcome: "hot-reloaded",
    message: "Hot reloaded successfully.",
    delivery: { kind: "live", revision: 4 },
    timing: { totalMs: 12 },
  });
  assert.equal(isDeliveryEnvelope(envelope), true);
  assert.equal(isDeliveryOutcome(envelope), true);
  assert.equal(isDeliveryEnvelope({ ...envelope, delivery: undefined }), false);
  assert.equal(isDeliveryEnvelope({ ...envelope, outcome: "livePatch" }), false);
});

test("contracts validate real SessionStore, route projection, and legacy normalization", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-contract-session-"));
  const path = join(root, "sessions.json");
  const store = new SessionStore({ path });
  const session = store.create({
    token: "token",
    project: "/tmp/project",
    scheme: "Demo",
    simulatorUDID: "SIM",
  });
  const persisted = readJSON<{ sessions: unknown[] }>(path).sessions[0] as Record<string, unknown>;
  assert.equal(isSessionRecord(persisted), true);
  assert.equal(isPublicSessionProjection(publicSession(session)), true);
  assert.equal(isSessionRecord({ ...persisted, remoteBaseUrl: undefined }), false);
  assert.equal(isSessionRecord({ ...persisted, revision: -1 }), false);

  const legacy = { ...persisted };
  delete legacy.project;
  delete legacy.scheme;
  delete legacy.simulatorUDID;
  writeFileSync(path, JSON.stringify({ sessions: [legacy] }));
  assert.equal(isSessionRecord(new SessionStore({ path }).list()[0]), true);
  const persistedStream = persisted.stream as Record<string, unknown>;
  assert.equal(isSessionRecord({ ...persisted, stream: { ...persistedStream, port: -1 } }), false);
});

test("contracts separate real pairing credentials and invitations", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-contract-pairing-"));
  const credential = new PairingStore({ path: join(root, "pairing.json") }).current();
  const invitePath = join(root, "pairing-invites.json");
  const inviteStore = new PairingInviteStore({ path: invitePath }) as unknown as {
    create(input: { pairing: typeof credential }): { invite: string; expiresAt: string };
  };
  const invitation = inviteStore.create({ pairing: credential });
  const persistedCredential = readJSON<Record<string, unknown>>(join(root, "pairing.json"));
  const persistedInvitation = readJSON<unknown[]>(invitePath)[0] as Record<string, unknown>;
  assert.equal(isPairingCredential(persistedCredential), true);
  assert.equal(isPairingInvitation(persistedInvitation), true);
  assert.equal(isPairingCredential(persistedInvitation), false);
  assert.equal(isPairingInvitation({ ...persistedInvitation, claimedAt: undefined }), false);
  assert.equal(isPairingCredential({ token: "legacy" }), false);
  assert.equal(invitation.invite.length >= 32, true);
});

test("contracts characterize real DeviceBuildStore records and route projections", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-contract-build-"));
  const path = join(root, "device-builds.json");
  const store = new DeviceBuildStore({ path, maintenance: false });
  const build = store.create({ scheme: "Demo" });
  const persisted = readJSON<{ builds: unknown[] }>(path).builds[0] as Record<string, unknown>;
  assert.equal(isDeviceBuildRecord(persisted), true);
  assert.equal(isPublicDeviceBuildProjection(publicDeviceBuild(build)), true);
  assert.equal(
    isPublicAppProjection(
      publicDeviceApp({
        id: "app",
        name: "Demo",
        bundleIdentifier: "",
        archivedAt: "",
        builds: [build],
      }),
    ),
    true,
  );
  assert.equal(isDeviceBuildRecord({ ...persisted, revision: 1.5 }), false);
  assert.equal(isDeviceBuildRecord({ ...persisted, installTTLMinutes: 4, ttlMinutes: 4 }), false);
});

test("contracts characterize real command and process records", async () => {
  const result = await runBuffered(process.execPath, ["-e", "process.stdout.write('ok')"]);
  assert.equal(isCommandResult(result), true);
  assert.equal(isCommandResult({ ...result, code: undefined }), false);
  const identity = {
    pid: process.pid,
    startedAt: "Tue Aug  4 00:00:00 2026",
    commandFragments: ["node"],
  };
  assert.equal(isDeliveryProcessIdentity(identity), true);
  assert.equal(isDeliveryProcessIdentity({ ...identity, pid: 0 }), false);
});

test("contracts characterize the persisted delivery generation state and journal semantics", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-contract-delivery-"));
  const path = join(root, "generation.json");
  const state = publishDeliveryGenerationState(path, {
    generation: "generation-1",
    status: "ready",
    publicBaseUrl: "https://example.test",
    managerIdentity: {
      pid: process.pid,
      startedAt: "Tue Aug  4 00:00:00 2026",
      commandFragments: ["manager"],
    },
  });
  assert.equal(isDeliveryGenerationState(state), true);
  assert.equal(isDeliveryGenerationState(readDeliveryGenerationState(path)), true);
  assert.equal(isDeliveryGenerationState({ ...state, managerPid: -1 }), false);
  assert.equal(isDeliveryGenerationState({ ...state, generation: undefined }), false);
});

function readJSON<T>(path: string): T {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(statSync(path).size);
    readSync(descriptor, buffer, 0, buffer.length, 0);
    return JSON.parse(buffer.toString("utf8")) as T;
  } finally {
    closeSync(descriptor);
  }
}
