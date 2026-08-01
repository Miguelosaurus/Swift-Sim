import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import { SessionStore as BaseSessionStore } from "../mac-helper/src/sessionStoreBase.js";
import {
  readSimulatorRuntimeState,
  reserveSimulatorLifecycleClaim,
  startSimulatorRuntime,
} from "../mac-helper/src/simulatorLifecycle.js";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

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

function sessionInput(simulatorUDID, suffix) {
  return {
    token: `token-${suffix}`,
    project: `/tmp/${suffix}.xcodeproj`,
    scheme: suffix,
    simulatorUDID,
    transport: "serve-sim",
  };
}

function stream(pid, port) {
  return {
    state: "running",
    transport: "serve-sim",
    quality: "fallback",
    localUrl: `http://127.0.0.1:${port}/stream`,
    previewUrl: `http://127.0.0.1:${port}/stream`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    port,
    pid,
    raw: {},
    limitations: [],
  };
}

test("orphan authorization re-reads the exact session store instead of trusting a stale registry", async () => {
  const directory = temporaryDirectory("swift-sim-round4-fresh-owner-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const simulatorUDID = "SIM-R4-FRESH-OWNER";

      const firstStore = new SessionStore({ path });
      const first = firstStore.create(sessionInput(simulatorUDID, "First"));

      // Write the second helper's durable session without refreshing the first
      // helper's process-local lifecycle registry.
      const secondStore = new BaseSessionStore({ path });
      const second = secondStore.create(sessionInput(simulatorUDID, "Second"));
      second.stream.raw = {
        ...(second.stream.raw || {}),
        swiftSimLifecycleClaimID: randomUUID(),
      };
      secondStore.save(second);
      reserveSimulatorLifecycleClaim(second, { storeID: path });
      const secondStream = await startSimulatorRuntime({
        simulatorUDID,
        recover: async () => {},
        operation: async () => stream(47002, 9402),
      });
      const owningRuntime = readSimulatorRuntimeState(simulatorUDID);
      assert.equal(owningRuntime.status, "running");

      // Enter a new claim for the first helper's competing request. A stale
      // registry would not contain the second session and would kill its stream.
      reserveSimulatorLifecycleClaim({
        ...first,
        stream: {
          ...first.stream,
          raw: {
            ...(first.stream.raw || {}),
            swiftSimLifecycleClaimID: randomUUID(),
          },
        },
      }, { storeID: path });
      let recoveries = 0;
      await assert.rejects(
        startSimulatorRuntime({
          simulatorUDID,
          recover: async () => { recoveries += 1; },
          operation: async () => stream(47003, 9403),
        }),
        (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
      );

      assert.equal(recoveries, 0);
      assert.equal(readSimulatorRuntimeState(simulatorUDID).nonce, owningRuntime.nonce);
      assert.equal(secondStream.raw.swiftSimLifecycleNonce, owningRuntime.nonce);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("orphan authorization treats a durably claimed restart replacement as owned", async () => {
  const directory = temporaryDirectory("swift-sim-round4-restart-owner-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const simulatorUDID = "SIM-R4-RESTART-OWNER";
      let starts = 0;
      let kills = 0;
      const adapter = {
        async start() {
          starts += 1;
          return stream(47200 + starts, 9420 + starts);
        },
        async kill() { kills += 1; },
      };
      const transport = new ServeSimTransport({ adapter });
      const store = new SessionStore({ path });
      const session = store.create(sessionInput(simulatorUDID, "RestartOwner"));
      session.stream = await transport.start({ simulatorUDID });
      store.save(session);
      const previousNonce = session.stream.raw.swiftSimLifecycleNonce;

      const replacement = await transport.restart(session);
      const replacementRuntime = readSimulatorRuntimeState(simulatorUDID);
      assert.notEqual(replacementRuntime.nonce, previousNonce);
      assert.equal(replacement.raw.swiftSimLifecycleNonce, replacementRuntime.nonce);
      assert.equal(kills, 1);

      const competitorStore = new BaseSessionStore({ path });
      const competitor = competitorStore.create(sessionInput(simulatorUDID, "Competitor"));
      competitor.stream.raw = {
        ...(competitor.stream.raw || {}),
        swiftSimLifecycleClaimID: randomUUID(),
      };
      competitorStore.save(competitor);
      reserveSimulatorLifecycleClaim(competitor, { storeID: path });

      let recoveries = 0;
      await assert.rejects(
        startSimulatorRuntime({
          simulatorUDID,
          recover: async () => { recoveries += 1; },
          operation: async () => stream(47299, 9499),
        }),
        (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
      );

      assert.equal(recoveries, 0);
      assert.equal(kills, 1);
      assert.equal(readSimulatorRuntimeState(simulatorUDID).nonce, replacementRuntime.nonce);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("claim-bound runtime cleanup fails closed when ownership evidence is missing", async () => {
  const directory = temporaryDirectory("swift-sim-round4-missing-claim-");
  await withRuntimeRoots(directory, async () => {
    try {
      const path = join(directory, "sessions.json");
      const simulatorUDID = "SIM-R4-MISSING-CLAIM";
      const store = new SessionStore({ path });
      const session = store.create(sessionInput(simulatorUDID, "ClaimOwner"));
      const original = await startSimulatorRuntime({
        simulatorUDID,
        recover: async () => {},
        operation: async () => stream(47301, 9431),
      });
      const originalRuntime = readSimulatorRuntimeState(simulatorUDID);
      assert.equal(original.raw.swiftSimLifecycleNonce, originalRuntime.nonce);

      // Simulate loss or corruption of the private claim evidence while the
      // durable session still identifies an active start for this Simulator.
      rmSync(join(directory, "claims"), { recursive: true, force: true });
      const competitorStore = new BaseSessionStore({ path });
      const competitor = competitorStore.create(sessionInput(simulatorUDID, "ClaimCompetitor"));
      competitor.stream.raw = {
        ...(competitor.stream.raw || {}),
        swiftSimLifecycleClaimID: randomUUID(),
      };
      competitorStore.save(competitor);
      reserveSimulatorLifecycleClaim(competitor, { storeID: path });

      let recoveries = 0;
      await assert.rejects(
        startSimulatorRuntime({
          simulatorUDID,
          recover: async () => { recoveries += 1; },
          operation: async () => stream(47302, 9432),
        }),
        (error) => error?.code === "SWIFT_SIM_SIMULATOR_RUNTIME_ACTIVE",
      );

      assert.equal(recoveries, 0);
      assert.equal(readSimulatorRuntimeState(simulatorUDID).nonce, originalRuntime.nonce);
      assert.equal(store.get(session.id).stream.state, "starting");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

test("a fresh starting session survives terminal state left by its predecessor", async () => {
  const directory = temporaryDirectory("swift-sim-round4-fresh-start-");
  await withRuntimeRoots(directory, async () => {
    try {
      const simulatorUDID = "SIM-R4-FRESH-START";
      const transport = new ServeSimTransport({
        adapter: {
          async start() { return stream(47101, 9411); },
          async kill() {},
        },
      });
      const predecessor = await transport.start({ simulatorUDID });
      await transport.stop({
        id: "predecessor",
        simulatorUDID,
        stream: predecessor,
      });
      assert.equal(readSimulatorRuntimeState(simulatorUDID).status, "stopped");

      const path = join(directory, "sessions.json");
      const store = new SessionStore({ path });
      const session = store.create(sessionInput(simulatorUDID, "Fresh"));
      const restartedStore = new SessionStore({ path });
      assert.equal(restartedStore.findReusable({
        project: session.project,
        scheme: session.scheme,
        simulatorUDID,
        transport: "auto",
      }), undefined);
      assert.equal(restartedStore.get(session.id).stream.state, "starting");
      assert.throws(
        () => restartedStore.create(sessionInput(simulatorUDID, "Fresh")),
        (error) => error?.code === "SWIFT_SIM_SESSION_START_IN_PROGRESS",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
