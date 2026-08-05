// @ts-check
import {
  isDeliveryProcessIdentity,
  isLiveEngineProcessRecord,
  isOwnedWorkerProcessRecord,
} from "../contracts/process.js";
import {
  kernelProcessIdentity,
  liveEngineProcessRecordIsCurrent,
  prepareKernelProcessIdentity,
} from "../liveEngineOwnershipPreload.js";
import {
  ownedWorkerProcessState,
  prepareOwnedWorkerProcessIdentity,
  requiredOwnedWorkerProcessRecord,
} from "../ownedWorkerIdentity.js";
import { NodeRuntimeJournalStore } from "./nodeRuntimeJournalStore.js";
import { SystemClock } from "./systemClock.js";
import { SystemIdGenerator } from "./systemIdGenerator.js";

/** @typedef {import("../contracts/process.js").DeliveryProcessIdentity} DeliveryProcessIdentity */
/** @typedef {import("../contracts/process.js").LiveEngineProcessRecord} LiveEngineProcessRecord */
/** @typedef {import("../contracts/process.js").OwnedWorkerProcessRecord} OwnedWorkerProcessRecord */
/** @typedef {import("./ports.js").Clock} Clock */
/** @typedef {import("./ports.js").CommandEnvironmentPolicy} CommandEnvironmentPolicy */
/** @typedef {import("./ports.js").IdGenerator} IdGenerator */
/** @typedef {import("./ports.js").ProcessInspection} ProcessInspection */
/** @typedef {import("./ports.js").ProcessRole} ProcessRole */
/** @typedef {import("./ports.js").ProcessSupervisor} ProcessSupervisor */
/** @typedef {import("./ports.js").RuntimeJournalStore} RuntimeJournalStore */
/** @typedef {import("./ports.js").SpawnRequest} SpawnRequest */
/** @typedef {import("./ports.js").SupervisedProcess} SupervisedProcess */
/** @typedef {import("./ports.js").SupervisedProcessRecord} SupervisedProcessRecord */
/** @typedef {import("./ports.js").TerminationRequest} TerminationRequest */
/** @typedef {typeof import("node:child_process").spawn} SpawnFunction */
/** @typedef {typeof import("node:child_process").spawnSync} SpawnSyncFunction */
/** @typedef {typeof process.kill} SignalFunction */
/**
 * @typedef {{
 *   prepareWorker: typeof prepareOwnedWorkerProcessIdentity,
 *   workerRecord: typeof requiredOwnedWorkerProcessRecord,
 *   workerState: typeof ownedWorkerProcessState,
 *   prepareKernel: typeof prepareKernelProcessIdentity,
 *   kernelIdentity: typeof kernelProcessIdentity,
 *   liveEngineCurrent: typeof liveEngineProcessRecordIsCurrent,
 * }} ProcessIdentityAuthority
 */
/**
 * @typedef {{
 *   spawn: SpawnFunction,
 *   spawnSync: SpawnSyncFunction,
 *   signal: SignalFunction,
 * }} ProcessRuntime
 */

const LIVE_ENGINE_INSTANCE_ENV = "SWIFT_SIM_ENGINE_INSTANCE_NONCE";
const IDENTITY_ATTEMPTS = 5;
const IDENTITY_RETRY_MS = 10;
const WAIT_INTERVAL_MS = 25;

const defaultIdentityAuthority = Object.freeze({
  prepareWorker: prepareOwnedWorkerProcessIdentity,
  workerRecord: requiredOwnedWorkerProcessRecord,
  workerState: ownedWorkerProcessState,
  prepareKernel: prepareKernelProcessIdentity,
  kernelIdentity: kernelProcessIdentity,
  liveEngineCurrent: liveEngineProcessRecordIsCurrent,
});

/** @implements {ProcessSupervisor} */
export class NodeProcessSupervisor {
  /**
   * @param {{
   *   runtime: ProcessRuntime,
   *   journalStore?: RuntimeJournalStore,
   *   clock?: Clock,
   *   idGenerator?: IdGenerator,
   *   identity?: ProcessIdentityAuthority,
   * }} options
   */
  constructor({
    runtime,
    journalStore = new NodeRuntimeJournalStore(),
    clock = new SystemClock(),
    idGenerator = new SystemIdGenerator(),
    identity = defaultIdentityAuthority,
  }) {
    assertRuntime(runtime);
    assertIdentityAuthority(identity);
    this.runtime = runtime;
    this.journalStore = journalStore;
    this.clock = clock;
    this.idGenerator = idGenerator;
    this.identity = identity;
  }

  /** @template {ProcessRole} Role @param {SpawnRequest<Role>} request @returns {SupervisedProcess<Role>} */
  spawn(request) {
    const normalized = normalizeSpawnRequest(request);
    const instanceNonce = normalized.role === "live-engine" ? this.idGenerator.randomUUID() : "";
    if (normalized.role === "worker") this.identity.prepareWorker();
    if (normalized.role === "live-engine" && !this.identity.prepareKernel()) {
      throw processIdentityError("Unable to prepare the live-engine process identity verifier.");
    }

    const environment = commandEnvironment(normalized.environment);
    if (instanceNonce) environment[LIVE_ENGINE_INSTANCE_ENV] = instanceNonce;

    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = this.runtime.spawn(normalized.executable, normalized.args, {
        cwd: normalized.cwd,
        env: environment,
        detached: normalized.processGroup === "new",
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      throw processSpawnError(error);
    }
    child.once("error", () => {});
    if (normalized.processGroup === "new") child.unref();

    const pid = Number(child.pid);
    if (!validPID(pid)) {
      terminateUnpublishedChild(child);
      throw processIdentityError("The supervised process did not publish a valid PID.");
    }

    /** @type {SupervisedProcessRecord | undefined} */
    let record;
    try {
      record = this.captureRecord(normalized, pid, instanceNonce);
      this.journalStore.publishSync(normalized.journalPath, record);
    } catch (error) {
      this.rollbackUnpublishedProcess(child, record);
      throw error;
    }

    return /** @type {SupervisedProcess<Role>} */ ({
      pid,
      role: normalized.role,
      record,
    });
  }

  /** @param {SupervisedProcessRecord} record @returns {ProcessInspection} */
  inspect(record) {
    if (isOwnedWorkerProcessRecord(record)) {
      return inspectionFromStrongState(this.identity.workerState(record), record);
    }
    if (isLiveEngineProcessRecord(record)) {
      if (!this.targetAlive(record.pid, false)) return { state: "dead" };
      const kernel = this.identity.kernelIdentity(record.pid);
      if (!kernel) return { state: "unverifiable" };
      if (
        kernel.processGroup !== record.processGroup ||
        kernel.startToken !== record.startToken ||
        kernel.executable !== record.executable
      ) {
        return { state: "replaced" };
      }
      return this.identity.liveEngineCurrent(record, { engineExecutable: record.executable })
        ? { state: "current", record }
        : { state: "replaced" };
    }
    if (isDeliveryProcessIdentity(record)) {
      if (!this.targetAlive(record.pid, false)) return { state: "dead" };
      const snapshot = this.deliverySnapshot(record.pid);
      if (!snapshot.startedAt || !snapshot.command) return { state: "unverifiable" };
      if (
        snapshot.startedAt !== record.startedAt ||
        !record.commandFragments.every((fragment) => snapshot.command.includes(fragment))
      ) {
        return { state: "replaced" };
      }
      return { state: "current", record };
    }
    return { state: "invalid" };
  }

  /** @param {TerminationRequest} request */
  terminate(request) {
    const normalized = normalizeTerminationRequest(request);
    this.requireCurrent(normalized.record);
    const group = normalized.terminateGroup;
    const target = group ? -normalized.record.pid : normalized.record.pid;
    this.sendSignal(target, normalized.signal);
    if (normalized.signal === "SIGKILL" || normalized.graceMs === 0) return;

    const deadline = this.clock.monotonicMilliseconds() + normalized.graceMs;
    while (this.targetAlive(normalized.record.pid, group)) {
      const inspection = this.inspect(normalized.record);
      if (inspection.state === "dead" || inspection.state === "missing") return;
      if (inspection.state !== "current") throw processIdentityChangedError(inspection.state);
      if (this.clock.monotonicMilliseconds() >= deadline) break;
      sleepSync(WAIT_INTERVAL_MS);
    }
    if (!this.targetAlive(normalized.record.pid, group)) return;

    this.requireCurrent(normalized.record);
    this.sendSignal(target, "SIGKILL");
  }

  /**
   * @param {SupervisedProcessRecord} record
   * @param {number} timeoutMs
   * @param {AbortSignal} [signal]
   * @returns {Promise<"exited" | "timeout" | "replaced" | "unverifiable">}
   */
  async waitForExit(record, timeoutMs, signal) {
    const timeout = nonnegativeInteger(timeoutMs, "Process wait timeout");
    const deadline = this.clock.monotonicMilliseconds() + timeout;
    const group = isOwnedWorkerProcessRecord(record) || isLiveEngineProcessRecord(record);

    while (true) {
      const inspection = this.inspect(record);
      if (inspection.state === "dead" || inspection.state === "missing") return "exited";
      if (inspection.state === "replaced") return "replaced";
      if (inspection.state === "unverifiable" || inspection.state === "invalid") {
        return "unverifiable";
      }
      if (!this.targetAlive(record.pid, group)) return "exited";
      const remaining = deadline - this.clock.monotonicMilliseconds();
      if (remaining <= 0) return "timeout";
      await this.clock.sleep(Math.min(WAIT_INTERVAL_MS, remaining), signal);
    }
  }

  /**
   * @param {SpawnRequest} request
   * @param {number} pid
   * @param {string} instanceNonce
   * @returns {SupervisedProcessRecord}
   */
  captureRecord(request, pid, instanceNonce) {
    if (request.role === "worker") {
      const record = this.identity.workerRecord(pid, request.command);
      if (this.identity.workerState(record) !== "current") {
        throw processIdentityError("Unable to establish the supervised worker process identity.");
      }
      return record;
    }
    if (request.role === "live-engine") {
      const kernel = this.requiredKernelIdentity(pid);
      if (kernel.processGroup !== pid) {
        throw processIdentityError("The supervised live engine did not own its process group.");
      }
      const record = {
        version: 2,
        pid,
        processGroup: pid,
        startToken: kernel.startToken,
        executable: kernel.executable,
        instanceNonce,
        recordNonce: this.idGenerator.randomUUID(),
        createdAt: this.clock.now().toISOString(),
      };
      if (!this.identity.liveEngineCurrent(record, { engineExecutable: record.executable })) {
        throw processIdentityError("Unable to establish the supervised live-engine identity.");
      }
      return record;
    }

    const snapshot = this.requiredDeliverySnapshot(pid);
    if (!request.commandFragments.every((fragment) => snapshot.command.includes(fragment))) {
      throw processIdentityError("The supervised delivery command did not match its required identity.");
    }
    return {
      pid,
      startedAt: snapshot.startedAt,
      commandFragments: [...request.commandFragments],
    };
  }

  /** @param {number} pid */
  requiredKernelIdentity(pid) {
    for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
      const identity = this.identity.kernelIdentity(pid);
      if (identity) return identity;
      sleepSync(IDENTITY_RETRY_MS);
    }
    throw processIdentityError("Unable to read the supervised process kernel identity.");
  }

  /** @param {number} pid */
  requiredDeliverySnapshot(pid) {
    for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
      const snapshot = this.deliverySnapshot(pid);
      if (snapshot.startedAt && snapshot.command) return snapshot;
      sleepSync(IDENTITY_RETRY_MS);
    }
    throw processIdentityError("Unable to read the supervised delivery process identity.");
  }

  /** @param {number} pid */
  deliverySnapshot(pid) {
    return {
      startedAt: psValue(this.runtime.spawnSync, pid, "lstart="),
      command: psValue(this.runtime.spawnSync, pid, "command="),
    };
  }

  /** @param {SupervisedProcessRecord} record */
  requireCurrent(record) {
    const inspection = this.inspect(record);
    if (inspection.state !== "current") throw processIdentityChangedError(inspection.state);
  }

  /** @param {number} pid @param {boolean} group */
  targetAlive(pid, group) {
    const target = group ? -pid : pid;
    try {
      this.runtime.signal(target, 0);
      return true;
    } catch (error) {
      return hasCode(error, "EPERM");
    }
  }

  /** @param {number} target @param {NodeJS.Signals} signal */
  sendSignal(target, signal) {
    try {
      this.runtime.signal(target, signal);
    } catch (error) {
      if (!hasCode(error, "ESRCH")) throw error;
    }
  }

  /** @param {import("node:child_process").ChildProcess} child @param {SupervisedProcessRecord | undefined} record */
  rollbackUnpublishedProcess(child, record) {
    if (record && this.inspect(record).state === "current") {
      const group = isOwnedWorkerProcessRecord(record) || isLiveEngineProcessRecord(record);
      this.sendSignal(group ? -record.pid : record.pid, "SIGKILL");
      return;
    }
    terminateUnpublishedChild(child);
  }
}

/** @param {ProcessRuntime} runtime */
function assertRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new TypeError("NodeProcessSupervisor requires an explicit process runtime.");
  }
  for (const method of ["spawn", "spawnSync", "signal"]) {
    if (typeof runtime[method] !== "function") {
      throw new TypeError(`NodeProcessSupervisor runtime must provide ${method}.`);
    }
  }
}

/** @param {ProcessIdentityAuthority} identity */
function assertIdentityAuthority(identity) {
  if (!identity || typeof identity !== "object") {
    throw new TypeError("NodeProcessSupervisor requires a process identity authority.");
  }
  for (const method of [
    "prepareWorker",
    "workerRecord",
    "workerState",
    "prepareKernel",
    "kernelIdentity",
    "liveEngineCurrent",
  ]) {
    if (typeof identity[method] !== "function") {
      throw new TypeError(`Process identity authority must provide ${method}.`);
    }
  }
}

/** @template {ProcessRole} Role @param {SpawnRequest<Role>} request */
function normalizeSpawnRequest(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("A supervised process request is required.");
  }
  const role = request.role;
  if (!["worker", "live-engine", "gateway", "manager", "tunnel"].includes(role)) {
    throw new TypeError("The supervised process role is invalid.");
  }
  if (request.processGroup !== "inherit" && request.processGroup !== "new") {
    throw new TypeError("Supervised processGroup must be inherit or new.");
  }
  if ((role === "worker" || role === "live-engine") && request.processGroup !== "new") {
    throw new TypeError(`${role} processes must own a new process group.`);
  }

  const normalized = {
    executable: normalizedString(request.executable, "Process executable"),
    args: normalizedStringArray(request.args, "Process arguments"),
    environment: normalizedEnvironmentPolicy(request.environment),
    processGroup: request.processGroup,
    journalPath: normalizedString(request.journalPath, "Process journal path"),
    role,
  };
  if (request.cwd !== undefined) normalized.cwd = normalizedString(request.cwd, "Process cwd");
  if (role === "worker") {
    normalized.command = normalizedString(request.command, "Worker command identity");
  } else if (role !== "live-engine") {
    normalized.commandFragments = normalizedNonemptyStrings(
      request.commandFragments,
      "Delivery command fragments",
    );
  }
  return /** @type {SpawnRequest<Role>} */ (normalized);
}

/** @param {TerminationRequest} request */
function normalizeTerminationRequest(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("A process termination request is required.");
  }
  if (request.signal !== "SIGTERM" && request.signal !== "SIGKILL") {
    throw new TypeError("Process termination signal must be SIGTERM or SIGKILL.");
  }
  const graceMs = nonnegativeInteger(request.graceMs, "Process termination grace");
  const record = request.record;
  if (request.terminateGroup) {
    if (!isOwnedWorkerProcessRecord(record) && !isLiveEngineProcessRecord(record)) {
      throw new TypeError("Only strong process records may authorize group termination.");
    }
  } else if (
    !isOwnedWorkerProcessRecord(record) &&
    !isLiveEngineProcessRecord(record) &&
    !isDeliveryProcessIdentity(record)
  ) {
    throw new TypeError("The process termination record is invalid.");
  }
  return { record, terminateGroup: request.terminateGroup, signal: request.signal, graceMs };
}

/** @param {string} state @param {OwnedWorkerProcessRecord} record @returns {ProcessInspection} */
function inspectionFromStrongState(state, record) {
  if (state === "current") return { state, record };
  if (["dead", "replaced", "unverifiable", "invalid"].includes(state)) {
    return /** @type {ProcessInspection} */ ({ state });
  }
  return { state: "invalid" };
}

/** @param {CommandEnvironmentPolicy} policy */
function commandEnvironment(policy) {
  const normalized = normalizedEnvironmentPolicy(policy);
  const unset = new Set(normalized.unset);
  /** @type {Record<string, string>} */
  const environment = {};
  for (const name of normalized.inherit) {
    const value = process.env[name];
    if (value !== undefined && !unset.has(name)) environment[name] = value;
  }
  for (const [name, value] of Object.entries(normalized.overrides)) {
    if (value === undefined || unset.has(name)) delete environment[name];
    else environment[name] = value;
  }
  return environment;
}

/** @param {CommandEnvironmentPolicy} policy */
function normalizedEnvironmentPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new TypeError("Process environment policy is required.");
  }
  const inherit = normalizedEnvironmentNames(policy.inherit);
  const unset = normalizedEnvironmentNames(policy.unset);
  if (!policy.overrides || typeof policy.overrides !== "object" || Array.isArray(policy.overrides)) {
    throw new TypeError("Process environment overrides must be an object.");
  }
  /** @type {Record<string, string | undefined>} */
  const overrides = {};
  for (const [name, value] of Object.entries(policy.overrides)) {
    normalizedEnvironmentName(name);
    if (value !== undefined && (typeof value !== "string" || value.includes("\0"))) {
      throw new TypeError(`Process environment value for ${name} must be a NUL-free string.`);
    }
    overrides[name] = value;
  }
  return { inherit, overrides, unset };
}

/** @param {readonly string[]} values */
function normalizedEnvironmentNames(values) {
  if (!Array.isArray(values)) throw new TypeError("Process environment names must be an array.");
  return values.map((value) => normalizedEnvironmentName(value));
}

/** @param {string} value */
function normalizedEnvironmentName(value) {
  if (typeof value !== "string" || !value || value.includes("=") || value.includes("\0")) {
    throw new TypeError("Process environment names must be non-empty and cannot contain = or NUL.");
  }
  return value;
}

/** @param {readonly string[]} values @param {string} label */
function normalizedStringArray(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array.`);
  return values.map((value) => normalizedString(value, label, true));
}

/** @param {readonly string[]} values @param {string} label */
function normalizedNonemptyStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must contain at least one value.`);
  }
  return values.map((value) => normalizedString(value, label));
}

/** @param {unknown} value @param {string} label @param {boolean} [allowEmpty] */
function normalizedString(value, label, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.includes("\0")) {
    throw new TypeError(`${label} must be a ${allowEmpty ? "NUL-free" : "non-empty NUL-free"} string.`);
  }
  return value;
}

/** @param {number} value @param {string} label */
function nonnegativeInteger(value, label) {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a nonnegative integer.`);
  }
  return value;
}

/** @param {SpawnSyncFunction} spawnSyncImplementation @param {number} pid @param {string} field */
function psValue(spawnSyncImplementation, pid, field) {
  const result = spawnSyncImplementation("/bin/ps", ["-p", String(pid), "-o", field], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

/** @param {import("node:child_process").ChildProcess} child */
function terminateUnpublishedChild(child) {
  try {
    child.kill("SIGKILL");
  } catch {}
}

/** @param {number} milliseconds */
function sleepSync(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/** @param {number} pid */
function validPID(pid) {
  return Number.isInteger(pid) && pid > 1;
}

/** @param {unknown} error @param {string | number} code */
function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}

/** @param {unknown} error */
function processSpawnError(error) {
  const wrapped = new Error(`Unable to spawn the supervised process: ${error instanceof Error ? error.message : String(error)}`);
  wrapped.code = "SWIFT_SIM_PROCESS_SPAWN_FAILED";
  return wrapped;
}

/** @param {string} message */
function processIdentityError(message) {
  const error = new Error(message);
  error.code = "SWIFT_SIM_PROCESS_IDENTITY_UNAVAILABLE";
  return error;
}

/** @param {string} state */
function processIdentityChangedError(state) {
  const error = new Error(`The supervised process identity is ${state}; termination was refused.`);
  error.code = "SWIFT_SIM_PROCESS_IDENTITY_CHANGED";
  return error;
}
