import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLiveDeliveryQueue } from "../../mac-helper/src/liveDeliveryQueue.js";
import { createLiveDeliveryRuntime } from "../../mac-helper/src/liveDeliveryRuntime.js";
import { NodeAtomicFileStore } from "../../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "../../mac-helper/src/infrastructure/nodeLockManager.js";
const hash = (text) => createHash("sha256").update(text).digest("hex");
export function recoveryFixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-recovery-"));
  const project = join(root, "App.xcodeproj");
  mkdirSync(project);
  writeFileSync(join(project, "project.pbxproj"), "fixture");
  const path = join(root, "Card.swift");
  const original = 'struct Card { var title: String { "old" } }';
  writeFileSync(path, original);
  let time = 1000000,
    sequence = 0;
  const files = new NodeAtomicFileStore();
  const locks = new NodeLockManager({
    fileStore: files,
    identity: (pid) => (pid === process.pid ? { startToken: "recovery-test" } : null),
  });
  const options = {
    rootPath: join(root, "deliveries"),
    fileStore: files,
    lockManager: locks,
    now: () => time,
    newId: () => `claim-${++sequence}`,
  };
  const scope = {
    project: join(project, "project.pbxproj"),
    scheme: "App",
    appIdentity: "app",
    binaryIdentity: "binary",
    sessionIdentity: "process-one",
  };
  const state = {
    engineAvailable: true,
    engineReachable: true,
    captureMatches: true,
    compilerReady: true,
    signingReady: true,
    matchesBinary: true,
    connected: true,
    foreground: true,
    rootReady: true,
    revision: 0,
    scope,
  };
  const phone = { counter: 4, draft: "keep-me", applied: [], visible: "old" };
  const receipts = new Map();
  const calls = { prepare: 0, apply: 0, receipt: 0, helper: 0, engine: 0 };
  let healthy = true,
    busy = false;
  const adapter = {
    binding: async () => ({
      scope,
      verifiedProcess: true,
      revision: state.revision,
      sourceBaselines: { [path]: hash(original) },
    }),
    inspect: async () => structuredClone(state),
    prepare: async (record) => {
      calls.prepare++;
      return {
        path: "fixture-artifact",
        patchDigest: hash(record.snapshotDigest),
        mode: "swift-dynamic-replacement-bundle",
      };
    },
    apply: async (record) => {
      calls.apply++;
      phone.applied.push(record.requestId);
      phone.visible = record.files[0].afterSource;
      state.revision++;
      const proof = {
        requestId: record.requestId,
        sessionIdentity: scope.sessionIdentity,
        binaryIdentity: scope.binaryIdentity,
        patchDigest: record.preparedPatch.patchDigest,
        applied: true,
        refreshed: true,
        revision: state.revision,
      };
      receipts.set(record.requestId, proof);
      return proof;
    },
    receipt: async (record) => {
      calls.receipt++;
      return receipts.get(record.requestId) || null;
    },
  };
  let queue, service;
  const reopen = () => {
    queue = createLiveDeliveryQueue(options);
    service = createLiveDeliveryRuntime({
      queue,
      adapter,
      workerId: `worker-${++sequence}`,
      now: () => time,
    });
  };
  reopen();
  const ports = {
    get queue() {
      return queue;
    },
    status: (id) => service.status(id),
    exclusive: (operation) => operation(),
    health: async () =>
      healthy
        ? { ok: true, helper: "swift-sim-helper", protocol: 1 }
        : { ok: false, failureCode: "HELPER_CONNECTION_REFUSED" },
    buildsBusy: () => busy,
    repairHelper: async ({ guard }) => {
      guard();
      calls.helper++;
      healthy = true;
      reopen();
      await service.runOnce();
    },
    restoreStoppedEngine: async (_, guard) => {
      guard();
      calls.engine++;
      state.engineAvailable = true;
      state.engineReachable = true;
    },
  };
  return {
    root,
    project,
    path,
    scope,
    state,
    phone,
    receipts,
    calls,
    adapter,
    ports,
    get queue() {
      return queue;
    },
    get service() {
      return service;
    },
    reopen,
    healthy: (value) => (healthy = value),
    busy: (value) => (busy = value),
    advance: (ms) => (time += ms),
    enqueue: (id = "recovery-one", title = "new") =>
      service.enqueue({
        requestId: id,
        files: [
          {
            path,
            beforeSource: original,
            afterSource: original.replace('"old"', JSON.stringify(title)),
          },
        ],
      }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
