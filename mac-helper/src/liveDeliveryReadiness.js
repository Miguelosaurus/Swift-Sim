import { lstatSync } from "node:fs";
import { join } from "node:path";
import { ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "./infrastructure/nodeLockManager.js";

const READINESS_CODES = new Set(["LIVE_READY", "LIVE_ENGINE_UNAVAILABLE", "LIVE_ENGINE_UPDATE_REQUIRED", "LIVE_CLIENT_UPDATE_REQUIRED", "LIVE_CAPTURE_MISMATCH", "LIVE_CAPTURE_UNAVAILABLE", "LIVE_TARGET_APP_MISMATCH", "LIVE_COMPILER_CONTEXT_UNAVAILABLE", "LIVE_SIGNING_UNAVAILABLE"]);
const WRITE_OPTIONS = Object.freeze({ mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });

// Independent, bounded advisory metadata. Source intent and native receipt
// authority remain in the queue and are never modified by a liveness check.
export function createLiveDeliveryReadiness({ rootPath: root, fileStore, lockManager, identity, now, keyForScope }) {
  const readinessPath = join(root, "readiness.json");
  let locks = lockManager;
  let readinessWrite;
  let readinessCache;
  function timestamp() {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < 0) throw queueError("QUEUE_CLOCK_INVALID");
    return value;
  }
  function readReadiness() {
    assertPrivatePath(root, "directory");
    const stats = assertPrivatePath(readinessPath, "file");
    if (!stats) return { schemaVersion: 1, heartbeatAt: 0, workerId: "", active: false, phase: "idle", activeRequestId: "", phaseDeadlineAt: 0, lanes: {} };
    if (stats.nlink !== 1 || stats.size > 128 * 1024) throw queueError("QUEUE_READINESS_INVALID");
    const version = [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs, stats.mode, stats.uid].join(":");
    if (readinessCache?.version === version) return clone(readinessCache.value);
    let value;
    try {
      value = fileStore.readJSONSync(readinessPath);
      if (value?.schemaVersion !== 1 || !Number.isSafeInteger(value.heartbeatAt) || value.heartbeatAt < 0 || (typeof value.workerId !== "string" || !/^[A-Za-z0-9_.:-]{0,128}$/.test(value.workerId)) || typeof value.active !== "boolean"
        || !value.lanes || typeof value.lanes !== "object" || Array.isArray(value.lanes) || Object.keys(value.lanes).length > 256) throw new Error();
      value.phase ||= "idle"; value.activeRequestId ||= ""; value.phaseDeadlineAt ||= 0;
      if (!["idle", "compiling"].includes(value.phase) || typeof value.activeRequestId !== "string" || !Number.isSafeInteger(value.phaseDeadlineAt) || value.phaseDeadlineAt < 0
        || (value.phase === "compiling" && (!/^[A-Za-z0-9_.:-]{1,128}$/.test(value.activeRequestId) || value.phaseDeadlineAt > value.heartbeatAt + 180_000))) throw new Error();
      for (const [key, lane] of Object.entries(value.lanes)) {
        if (!/^[a-f0-9]{64}$/.test(key) || !READINESS_CODES.has(lane.code)
          || ![lane.checkedAt, lane.changedAt, lane.lastReachableAt].every((time) => Number.isSafeInteger(time) && time >= 0)) throw new Error();
      }
    } catch { throw queueError("QUEUE_READINESS_INVALID"); }
    readinessCache = { version, value: clone(value) };
    return value;
  }
  // Advisory only: this small sidecar never grants a queue claim or a native
  // success. It can be read by a separate one-shot CLI after a helper crash.
  async function observeWorker({ workerId, scope, code, engineReachable = false, active = true, phase = "idle", activeRequestId = "", phaseDeadlineAt = 0 } = {}) {
    validateId(workerId);
    if ((scope && code === undefined) || (code !== undefined && !READINESS_CODES.has(code)) || typeof active !== "boolean" || typeof engineReachable !== "boolean") throw queueError("QUEUE_READINESS_INVALID");
    if (!["idle", "compiling"].includes(phase) || typeof activeRequestId !== "string" || !Number.isSafeInteger(phaseDeadlineAt) || phaseDeadlineAt < 0
      || (phase === "compiling" && (!/^[A-Za-z0-9_.:-]{1,128}$/.test(activeRequestId) || phaseDeadlineAt > timestamp() + 180_000))) throw queueError("QUEUE_READINESS_INVALID");
    if (readinessWrite) await readinessWrite;
    const operation = async () => {
      const time = timestamp(); const current = readReadiness();
      const key = scope ? keyForScope(scope) : null;
      const prior = key ? current.lanes[key] : null;
      const changed = key && prior?.code !== code;
      if (current.workerId === workerId && current.active === active && current.phase === phase && current.activeRequestId === activeRequestId && time - current.heartbeatAt < 10_000 && !changed && (!key || time - prior.checkedAt < 10_000)) return;
      if (!locks && typeof identity !== "function") throw queueError("QUEUE_LOCK_AUTHORITY_REQUIRED");
      ensureDirectoryModeSync(root, 0o700); locks ||= new NodeLockManager({ identity, fileStore });
      await locks.withLock({ path: join(root, "readiness.lock"), waitMs: 1000, staleAfterMs: 1000, ownerMode: 0o600 }, async () => {
        const value = readReadiness();
        // A stopped obsolete worker must not erase another worker's heartbeat.
        if (!active && value.workerId !== workerId) return;
        if (value.workerId !== workerId) value.lanes = {};
        value.workerId = workerId; value.active = active; value.heartbeatAt = time;
        value.phase = phase; value.activeRequestId = activeRequestId; value.phaseDeadlineAt = phaseDeadlineAt;
        if (key) {
          const previous = value.lanes[key];
          value.lanes[key] = { code, checkedAt: time, changedAt: previous?.code === code ? previous.changedAt : time,
            lastReachableAt: engineReachable ? time : previous?.lastReachableAt || 0 };
          value.lanes = Object.fromEntries(Object.entries(value.lanes).sort((a, b) => a[1].checkedAt - b[1].checkedAt).slice(-256));
        }
        await fileStore.writeJSON(readinessPath, value, WRITE_OPTIONS);
      });
    };
    readinessWrite = operation();
    try { await readinessWrite; } finally { readinessWrite = null; }
  }
  function readiness(record) {
    let value;
    try { value = readReadiness(); } catch { return { code: "LIVE_READINESS_UNAVAILABLE" }; }
    return projectReadiness(record, value, timestamp());
  }
  function readinessSnapshot(records) {
    const time = timestamp();
    let value;
    try { value = readReadiness(); } catch { return new Map(records.map((record) => [record.requestId, { code: "LIVE_READINESS_UNAVAILABLE", changedAt: time }])); }
    return new Map(records.map((record) => {
      const result = projectReadiness(record, value, time); const lane = value.lanes[keyForScope(record.scope)];
      const changedAt = result.code === "LIVE_WORKER_UNAVAILABLE" ? (value.heartbeatAt ? value.heartbeatAt + (value.active ? 30_000 : 0) : record.createdAt + 5000)
        : result.code === "LIVE_ENGINE_OBSERVATION_STALE" ? (lane ? lane.checkedAt + 30_000 : record.createdAt + 5000)
        : result.code === "LIVE_READINESS_UNAVAILABLE" ? time : lane?.changedAt || record.createdAt;
      return [record.requestId, { ...result, changedAt }];
    }));
  }
  function projectReadiness(record, value, time) {
    const age = (at) => Math.max(0, time - at);
    const heartbeatAgeMs = age(value.heartbeatAt);
    const lane = value.lanes[keyForScope(record.scope)];
    if (value.heartbeatAt > time || (lane && (lane.checkedAt > time || lane.changedAt > time || lane.lastReachableAt > time))) return { code: "LIVE_READINESS_UNAVAILABLE" };
    const ages = { ...(value.heartbeatAt ? { heartbeatAgeMs } : {}), ...(lane ? { observationAgeMs: age(lane.checkedAt),
      ...(lane.lastReachableAt ? { lastEngineReachableAgeMs: age(lane.lastReachableAt) } : {}) } : {}) };
    if ((value.heartbeatAt && !value.active) || ((!value.heartbeatAt || heartbeatAgeMs > 30_000) && time - record.createdAt > 5000)) return { code: "LIVE_WORKER_UNAVAILABLE", ...ages };
    if (value.phase === "compiling" && value.activeRequestId === record.requestId && value.phaseDeadlineAt > time && record.state === "compiling") return { code: "LIVE_PREPARING", ...ages };
    if (!lane || age(lane.checkedAt) > 30_000) return { code: time - record.createdAt <= 5000 ? "LIVE_READINESS_CHECKING" : "LIVE_ENGINE_OBSERVATION_STALE", ...ages };
    const code = record.preparedPatch && ["LIVE_COMPILER_CONTEXT_UNAVAILABLE", "LIVE_SIGNING_UNAVAILABLE"].includes(lane.code) ? "LIVE_READY" : lane.code;
    return { code, ...ages };
  }
  return Object.freeze({ observeWorker, readiness, readinessSnapshot });
}

function assertPrivatePath(path, kind) {
  let stats;
  try { stats = lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw queueError("QUEUE_READINESS_INVALID"); }
  if (stats.isSymbolicLink() || (kind === "directory" ? !stats.isDirectory() : !stats.isFile())
    || (stats.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stats.uid !== process.getuid())) throw queueError("QUEUE_READINESS_INVALID");
  return stats;
}
function validateId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw queueError("QUEUE_REQUEST_INVALID"); }
function clone(value) { return structuredClone(value); }
function queueError(code) { return Object.assign(new Error(`Swift Sim live readiness: ${code}.`), { code }); }
