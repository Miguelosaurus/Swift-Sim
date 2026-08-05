import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type {
  LiveEngineProcessRecord,
  OwnedWorkerProcessRecord,
} from "../mac-helper/src/contracts/process.js";
import {
  kernelProcessIdentity,
  liveEngineProcessRecordIsCurrent,
  prepareKernelProcessIdentity,
} from "../mac-helper/src/liveEngineOwnershipPreload.js";
import {
  ownedWorkerProcessState,
  prepareOwnedWorkerProcessIdentity,
  requiredOwnedWorkerProcessRecord,
} from "../mac-helper/src/ownedWorkerIdentity.js";
import { NodeProcessSupervisor } from "../mac-helper/src/infrastructure/nodeProcessSupervisor.js";
import { NodeRuntimeJournalStore } from "../mac-helper/src/infrastructure/nodeRuntimeJournalStore.js";
import type { RuntimeJournalStore } from "../mac-helper/src/infrastructure/ports.js";

const runtime = {
  spawn,
  spawnSync,
  signal: process.kill.bind(process),
};

const identity = {
  prepareWorker: prepareOwnedWorkerProcessIdentity,
  workerRecord: (pid: number, command: string): OwnedWorkerProcessRecord =>
    requiredOwnedWorkerProcessRecord(pid, command) as OwnedWorkerProcessRecord,
  workerState: (record: OwnedWorkerProcessRecord) => ownedWorkerProcessState(record),
  prepareKernel: prepareKernelProcessIdentity,
  kernelIdentity: kernelProcessIdentity,
  liveEngineCurrent: (record: LiveEngineProcessRecord, options: { engineExecutable: string }) =>
    liveEngineProcessRecordIsCurrent(record, options),
};

function environment(overrides: Record<string, string | undefined> = {}) {
  return { inherit: [], overrides, unset: [] } as const;
}

test("NodeProcessSupervisor requires explicit runtime and identity authorities", () => {
  assert.throws(
    () => new NodeProcessSupervisor({ runtime: undefined as never, identity }),
    /requires an explicit process runtime/,
  );
  assert.throws(
    () => new NodeProcessSupervisor({ runtime, identity: undefined as never }),
    /requires a process identity authority/,
  );
});

test("NodeProcessSupervisor rolls back a spawned worker when journal publication fails", async () => {
  let spawnedPID = 0;
  const failingJournal = journalStore({
    publishSync: () => {
      throw new Error("journal unavailable");
    },
  });
  const capturingIdentity = {
    ...identity,
    workerRecord: (pid: number, command: string): OwnedWorkerProcessRecord => {
      spawnedPID = pid;
      return requiredOwnedWorkerProcessRecord(pid, command) as OwnedWorkerProcessRecord;
    },
  };
  const supervisor = new NodeProcessSupervisor({
    runtime,
    identity: capturingIdentity,
    journalStore: failingJournal,
  });

  assert.throws(
    () =>
      supervisor.spawn({
        role: "worker",
        executable: process.execPath,
        args: ["-e", "setInterval(() => {}, 1000)"],
        environment: environment(),
        processGroup: "new",
        journalPath: join(tmpdir(), "swift-sim-failing-worker.json"),
        command: "journal-failure-worker",
      }),
    /journal unavailable/,
  );
  assert.ok(spawnedPID > 1);
  await waitForDead(spawnedPID);
});

test("NodeProcessSupervisor publishes and terminates a strong worker process group", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "swift-sim-supervisor-worker-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const descendantPath = join(workspace, "descendant.pid");
  const journalPath = join(workspace, "worker.json");
  const journal = new NodeRuntimeJournalStore();
  const supervisor = new NodeProcessSupervisor({ runtime, identity, journalStore: journal });

  const supervised = supervisor.spawn({
    role: "worker",
    executable: process.execPath,
    args: ["-e", descendantFixture("strong-worker-marker")],
    environment: environment({ DESCENDANT_PID_PATH: descendantPath }),
    processGroup: "new",
    journalPath,
    command: "strong-worker-marker",
  });
  const descendantPID = await readPublishedPID(descendantPath);

  assert.equal(supervisor.inspect(supervised.record).state, "current");
  assert.deepEqual(journal.readSync(journalPath), supervised.record);
  supervisor.terminate({
    record: supervised.record,
    terminateGroup: true,
    signal: "SIGTERM",
    graceMs: 100,
  });
  await waitForDead(supervised.pid);
  await waitForDead(descendantPID);
  assert.equal(await supervisor.waitForExit(supervised.record, 500), "exited");
});

test("NodeProcessSupervisor gives weak delivery records exact-PID authority only", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "swift-sim-supervisor-delivery-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const descendantPath = join(workspace, "descendant.pid");
  const supervisor = new NodeProcessSupervisor({ runtime, identity });

  const supervised = supervisor.spawn({
    role: "manager",
    executable: process.execPath,
    args: ["-e", descendantFixture("weak-manager-marker")],
    environment: environment({ DESCENDANT_PID_PATH: descendantPath }),
    processGroup: "new",
    journalPath: join(workspace, "manager.json"),
    commandFragments: ["weak-manager-marker"],
  });
  const descendantPID = await readPublishedPID(descendantPath);

  assert.equal(supervisor.inspect(supervised.record).state, "current");
  supervisor.terminate({
    record: supervised.record,
    terminateGroup: false,
    signal: "SIGTERM",
    graceMs: 100,
  });
  await waitForDead(supervised.pid);
  assert.equal(processIsAlive(descendantPID), true);
  process.kill(descendantPID, "SIGKILL");
  await waitForDead(descendantPID);
});

test("NodeProcessSupervisor publishes a nonce-bound live-engine record", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "swift-sim-supervisor-engine-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const supervisor = new NodeProcessSupervisor({ runtime, identity });

  const supervised = supervisor.spawn({
    role: "live-engine",
    executable: process.execPath,
    args: ["-e", "setInterval(() => {}, 1000)"],
    environment: environment(),
    processGroup: "new",
    journalPath: join(workspace, "engine.json"),
  });

  assert.equal(supervised.record.version, 2);
  assert.equal(supervised.record.processGroup, supervised.pid);
  assert.match(supervised.record.instanceNonce, /^[0-9a-f-]{36}$/i);
  assert.match(supervised.record.recordNonce, /^[0-9a-f-]{36}$/i);
  assert.equal(supervisor.inspect(supervised.record).state, "current");
  supervisor.terminate({
    record: supervised.record,
    terminateGroup: true,
    signal: "SIGKILL",
    graceMs: 0,
  });
  await waitForDead(supervised.pid);
});

test("NodeProcessSupervisor refuses SIGKILL escalation after identity replacement", () => {
  const record: OwnedWorkerProcessRecord = {
    version: 2,
    pid: 4242,
    processGroup: 4242,
    startToken: "start-token",
    executable: "/usr/bin/true",
    command: "fixture",
    createdAt: "2026-08-05T08:00:00.000Z",
  };
  const signals: Array<string | number | undefined> = [];
  let inspections = 0;
  const supervisor = new NodeProcessSupervisor({
    runtime: {
      spawn: (() => {
        throw new Error("unused");
      }) as unknown as typeof spawn,
      spawnSync,
      signal: ((pid: number, signal?: string | number) => {
        if (signal !== 0) signals.push(signal);
        return true;
      }) as typeof process.kill,
    },
    identity: {
      prepareWorker: () => {},
      workerRecord: () => record,
      workerState: () => (inspections++ === 0 ? "current" : "replaced"),
      prepareKernel: () => true,
      kernelIdentity: () => null,
      liveEngineCurrent: () => false,
    },
  });

  assert.throws(
    () =>
      supervisor.terminate({
        record,
        terminateGroup: true,
        signal: "SIGTERM",
        graceMs: 100,
      }),
    (error: unknown) => hasCode(error, "SWIFT_SIM_PROCESS_IDENTITY_CHANGED"),
  );
  assert.deepEqual(signals, ["SIGTERM"]);
});

test("NodeProcessSupervisor classifies invalid, replaced, and unverifiable records", () => {
  const supervisor = new NodeProcessSupervisor({ runtime, identity });
  assert.deepEqual(supervisor.inspect({ pid: 1 } as never), { state: "invalid" });

  const replaced = {
    pid: process.pid,
    startedAt: "not-this-process",
    commandFragments: ["node"],
  };
  assert.equal(supervisor.inspect(replaced).state, "replaced");

  const unavailableSpawnSync = (() => ({
    pid: 0,
    output: [null, null, null],
    stdout: "",
    stderr: "",
    status: 1,
    signal: null,
    error: undefined,
  })) as unknown as typeof spawnSync;
  const unverifiableSupervisor = new NodeProcessSupervisor({
    runtime: { ...runtime, spawnSync: unavailableSpawnSync },
    identity,
  });
  assert.equal(unverifiableSupervisor.inspect(replaced).state, "unverifiable");
});

function descendantFixture(marker: string): string {
  return `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const marker = ${JSON.stringify(marker)};
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    writeFileSync(process.env.DESCENDANT_PID_PATH, String(child.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => marker.length, 1000);
  `;
}

async function readPublishedPID(path: string): Promise<number> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await stat(path);
      const result = spawnSync("/bin/cat", [path], { encoding: "utf8" });
      const pid = Number(String(result.stdout || "").trim());
      if (result.status === 0 && Number.isInteger(pid) && pid > 1) return pid;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for a descendant PID at ${path}.`);
}

async function waitForDead(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (!processIsAlive(pid)) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Process ${pid} remained alive.`);
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], {
    encoding: "utf8",
  });
  if (result.status !== 0) return false;
  return !String(result.stdout || "")
    .trim()
    .startsWith("Z");
}

function journalStore(overrides: Partial<RuntimeJournalStore>): RuntimeJournalStore {
  return {
    publish: async () => {},
    publishSync: () => {},
    read: async () => null,
    readSync: () => null,
    remove: async () => {},
    removeSync: () => {},
    ...overrides,
  };
}

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
