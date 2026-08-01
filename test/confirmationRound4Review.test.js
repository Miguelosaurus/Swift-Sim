import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import {
  startSimulatorRuntime,
} from "../mac-helper/src/simulatorLifecycle.js";
import {
  listSimulatorClaims,
  writeSimulatorClaim,
} from "../mac-helper/src/simulatorLifecycleClaims.js";

function temporaryDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

async function withRuntimeRoots(directory, operation) {
  const runtimePrevious = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  const claimPrevious = process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = join(directory, "runtime");
  process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = join(directory, "claims");
  try {
    return await operation();
  } finally {
    if (runtimePrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = runtimePrevious;
    if (claimPrevious === undefined) delete process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT = claimPrevious;
  }
}

test("a failed native-style attempt leaves the start claim available to fallback", async () => {
  const directory = temporaryDirectory("swift-sim-round4-fallback-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = store.create({
        token: "secret-token",
        project: "/tmp/Fallback.xcodeproj",
        scheme: "Fallback",
        simulatorUDID: "SIM-R4-FALLBACK",
        transport: "native-companion",
      });
      let recoveries = 0;
      await assert.rejects(
        startSimulatorRuntime({
          simulatorUDID: session.simulatorUDID,
          recover: async () => { recoveries += 1; },
          operation: async () => { throw new Error("native transport unavailable"); },
        }),
        /native transport unavailable/,
      );

      const fallback = await startSimulatorRuntime({
        simulatorUDID: session.simulatorUDID,
        recover: async () => { recoveries += 1; },
        operation: async () => ({
          state: "running",
          transport: "serve-sim",
          quality: "fallback",
          localUrl: "http://127.0.0.1:9123/stream",
          previewUrl: "http://127.0.0.1:9123/stream",
          wsUrl: "ws://127.0.0.1:9123/ws",
          port: 9123,
          pid: 45123,
          raw: {},
          limitations: [],
        }),
      });

      assert.equal(recoveries, 1);
      const recovered = new SessionStore({ path }).findReusable({
        project: session.project,
        scheme: session.scheme,
        simulatorUDID: session.simulatorUDID,
        transport: "auto",
      });
      assert.equal(recovered.id, session.id);
      assert.equal(recovered.stream.transport, "serve-sim");
      assert.equal(recovered.stream.localUrl, fallback.localUrl);
      assert.equal(
        recovered.stream.raw.swiftSimLifecycleNonce,
        fallback.raw.swiftSimLifecycleNonce,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("invalid claim filenames are ignored during enumeration", () => {
  const directory = temporaryDirectory("swift-sim-round4-claim-name-");
  const rootPath = join(directory, "claims");
  const simulatorUDID = "SIM-R4-CLAIM-NAME";
  try {
    writeSimulatorClaim({
      version: 1,
      claimID: "valid-claim",
      sessionID: "session-id",
      simulatorUDID,
      kind: "start",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }, { rootPath });
    const simulatorDirectories = readdirSync(rootPath);
    assert.equal(simulatorDirectories.length, 1);
    const claimDirectory = join(rootPath, simulatorDirectories[0]);
    mkdirSync(claimDirectory, { recursive: true });
    writeFileSync(join(claimDirectory, "invalid claim!.json"), "{}");
    const claims = listSimulatorClaims(simulatorUDID, { rootPath });
    assert.deepEqual(claims.map((claim) => claim.claimID), ["valid-claim"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
