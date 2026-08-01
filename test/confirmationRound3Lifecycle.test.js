import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DeviceDeliveryAdapter } from "../mac-helper/src/deviceDelivery.js";
import { SessionStore } from "../mac-helper/src/sessionStore.js";
import {
  readSimulatorRuntimeState,
  simulatorLifecycleIsActive,
  simulatorSessionIsReusable,
  withSimulatorLifecycleLock,
} from "../mac-helper/src/simulatorLifecycle.js";
import { ServeSimTransport } from "../mac-helper/src/transports/serveSimTransport.js";

function temporaryDirectory(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function deferred() {
  let resolve;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function processIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return check();
}

test("Simulator lifecycle operations serialize by UDID", async () => {
  const rootPath = temporaryDirectory("swift-sim-runtime-lock-");
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const events = [];
  try {
    const first = withSimulatorLifecycleLock("SIM-LOCK", async () => {
      events.push("first-enter");
      firstEntered.resolve();
      await releaseFirst.promise;
      events.push("first-exit");
    }, { rootPath });
    await firstEntered.promise;
    assert.equal(simulatorLifecycleIsActive("SIM-LOCK", { rootPath }), true);

    const second = withSimulatorLifecycleLock("SIM-LOCK", async () => {
      events.push("second-enter");
    }, { rootPath });
    await new Promise((resolve) => setTimeout(resolve, 75));
    assert.deepEqual(events, ["first-enter"]);

    releaseFirst.resolve();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["first-enter", "first-exit", "second-enter"]);
    assert.equal(simulatorLifecycleIsActive("SIM-LOCK", { rootPath }), false);
  } finally {
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("a user stop prevents a blocked stream recovery from resurrecting serve-sim", async () => {
  const rootPath = temporaryDirectory("swift-sim-runtime-stop-");
  const previousRoot = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = rootPath;
  const stopEntered = deferred();
  const releaseStop = deferred();
  let starts = 0;
  let kills = 0;
  const adapter = {
    async start() {
      starts += 1;
      return {
        previewUrl: "http://127.0.0.1:9000/stream",
        wsUrl: "ws://127.0.0.1:9000/ws",
        port: 9000,
        pid: 43210,
        raw: {},
        logs: [],
      };
    },
    async kill() {
      kills += 1;
      stopEntered.resolve();
      await releaseStop.promise;
    },
  };
  try {
    const transport = new ServeSimTransport({ adapter });
    const stream = await transport.start({ simulatorUDID: "SIM-STOP" });
    const session = { simulatorUDID: "SIM-STOP", stream };
    assert.equal(simulatorSessionIsReusable(session), true);

    const stopping = transport.stop(session);
    await stopEntered.promise;
    const recovering = transport.restart(session);
    releaseStop.resolve();
    await stopping;
    await assert.rejects(
      recovering,
      (error) => error?.code === "SWIFT_SIM_SIMULATOR_STREAM_SUPERSEDED",
    );

    assert.equal(starts, 1);
    assert.equal(kills, 1);
    assert.equal(readSimulatorRuntimeState("SIM-STOP").status, "stopped");
    assert.equal(simulatorSessionIsReusable(session), false);
  } finally {
    if (previousRoot === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = previousRoot;
    rmSync(rootPath, { recursive: true, force: true });
  }
});

test("SessionStore does not reuse a stream while its runtime is stopping", async () => {
  const directory = temporaryDirectory("swift-sim-runtime-store-");
  const rootPath = join(directory, "runtime");
  const previousRoot = process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
  process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = rootPath;
  const stopEntered = deferred();
  const releaseStop = deferred();
  const adapter = {
    async start() {
      return {
        previewUrl: "http://127.0.0.1:9001/stream",
        wsUrl: "ws://127.0.0.1:9001/ws",
        port: 9001,
        pid: 43211,
        raw: {},
        logs: [],
      };
    },
    async kill() {
      stopEntered.resolve();
      await releaseStop.promise;
    },
  };
  try {
    const transport = new ServeSimTransport({ adapter });
    const stream = await transport.start({ simulatorUDID: "SIM-STORE" });
    const store = new SessionStore({ path: join(directory, "sessions.json") });
    const session = store.create({
      token: "token",
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-STORE",
      transport: "serve-sim",
    });
    session.stream = stream;
    store.save(session);
    assert.equal(store.findReusable({
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-STORE",
      transport: "auto",
    })?.id, session.id);

    const stopping = transport.stop(session);
    await stopEntered.promise;
    assert.equal(store.findReusable({
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-STORE",
      transport: "auto",
    }), undefined);
    releaseStop.resolve();
    await stopping;
  } finally {
    if (previousRoot === undefined) delete process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT;
    else process.env.SWIFT_SIM_SIMULATOR_RUNTIME_ROOT = previousRoot;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("delivery timeout terminates a detached manager that never publishes state", async () => {
  const directory = temporaryDirectory("swift-sim-delivery-orphan-");
  const managerPath = join(directory, "manager.mjs");
  const statePath = join(directory, "delivery.json");
  const pidPath = `${statePath}.manager.pid`;
  writeFileSync(managerPath, `
    import { writeFileSync } from "node:fs";
    const args = process.argv.slice(2);
    const statePath = args[args.indexOf("--state-path") + 1];
    writeFileSync(statePath.replace(/\\.generation-.*\\.json$/, "") + ".manager.pid", String(process.pid));
    setInterval(() => {}, 1_000);
  `);
  let pid = 0;
  try {
    const adapter = new DeviceDeliveryAdapter({
      statePath,
      logPath: join(directory, "delivery.log"),
      managerPath,
      helperPath: join(directory, "unused-gateway.js"),
      readinessTimeoutMs: 300,
    });
    await assert.rejects(
      adapter.ensure({ ttlMinutes: 5, referenceID: "build:test" }),
      /did not become ready/,
    );
    assert.equal(await waitFor(() => existsSync(pidPath)), true);
    pid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(await waitFor(() => !processIsAlive(pid)), true);
  } finally {
    if (processIsAlive(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed delivery state is preserved while its unpublished manager is stopped", async () => {
  const directory = temporaryDirectory("swift-sim-delivery-malformed-orphan-");
  const managerPath = join(directory, "manager.mjs");
  const statePath = join(directory, "delivery.json");
  const pidPath = `${statePath}.manager.pid`;
  writeFileSync(managerPath, `
    import { writeFileSync } from "node:fs";
    const args = process.argv.slice(2);
    const statePath = args[args.indexOf("--state-path") + 1];
    writeFileSync(statePath.replace(/\\.generation-.*\\.json$/, "") + ".manager.pid", String(process.pid));
    writeFileSync(statePath, "{malformed");
    setInterval(() => {}, 1_000);
  `);
  let pid = 0;
  try {
    const adapter = new DeviceDeliveryAdapter({
      statePath,
      logPath: join(directory, "delivery.log"),
      managerPath,
      helperPath: join(directory, "unused-gateway.js"),
      readinessTimeoutMs: 500,
    });
    await assert.rejects(
      adapter.ensure({ ttlMinutes: 5, referenceID: "build:test" }),
      { code: "SWIFT_SIM_DELIVERY_STATE_INVALID" },
    );
    assert.equal(await waitFor(() => existsSync(pidPath)), true);
    pid = Number(readFileSync(pidPath, "utf8"));
    assert.equal(await waitFor(() => !processIsAlive(pid)), true);
    const generationFiles = (await import("node:fs")).readdirSync(directory)
      .filter((name) => name.includes(".generation-") && name.endsWith(".json"));
    assert.equal(generationFiles.length, 1);
    assert.equal(readFileSync(join(directory, generationFiles[0]), "utf8"), "{malformed");
  } finally {
    if (processIsAlive(pid)) {
      try { process.kill(-pid, "SIGKILL"); } catch {
        try { process.kill(pid, "SIGKILL"); } catch {}
      }
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
