// @ts-check
import {
  isDeliveryProcessIdentity,
  isLiveEngineProcessRecord,
  isOwnedWorkerProcessRecord,
} from "../contracts/process.js";
import { NodeRuntimeJournalStore } from "./nodeRuntimeJournalStore.js";
import { SystemClock } from "./systemClock.js";
import { SystemIdGenerator } from "./systemIdGenerator.js";

/** @typedef {import("../contracts/process.js").LiveEngineProcessRecord} LiveEngineProcessRecord */
/** @typedef {import("../contracts/process.js").OwnedWorkerProcessRecord} OwnedWorkerProcessRecord */
/** @typedef {import("./ports.js").Clock} Clock */
/** @typedef {import("./ports.js").CommandEnvironmentPolicy} CommandEnvironmentPolicy */
/** @typedef {import("./ports.js").DeliverySpawnRequest} DeliverySpawnRequest */
/** @typedef {import("./ports.js").IdGenerator} IdGenerator */
/** @typedef {import("./ports.js").LiveEngineSpawnRequest} LiveEngineSpawnRequest */
/** @typedef {import("./ports.js").ProcessInspection} ProcessInspection */
/** @typedef {import("./ports.js").ProcessRole} ProcessRole */
/** @typedef {import("./ports.js").ProcessSupervisor} ProcessSupervisor */
/** @typedef {import("./ports.js").RuntimeJournalStore} RuntimeJournalStore */
/**
 * @template {ProcessRole} Role
 * @typedef {import("./ports.js").SpawnRequest<Role>} SpawnRequest
 */
/**
 * @template {ProcessRole} Role
 * @typedef {import("./ports.js").SupervisedProcess<Role>} SupervisedProcess
 */
/** @typedef {import("./ports.js").SupervisedProcessRecord} SupervisedProcessRecord */
/** @typedef {import("./ports.js").TerminationRequest} TerminationRequest */
/** @typedef {import("./ports.js").WorkerSpawnRequest} WorkerSpawnRequest */
/** @typedef {typeof import("node:child_process").spawn} SpawnFunction */
/** @typedef {typeof import("node:child_process").spawnSync} SpawnSyncFunction */
/** @typedef {WorkerSpawnRequest | LiveEngineSpawnRequest | DeliverySpawnRequest} AnySpawnRequest */
/** @typedef {{ startToken: string, processGroup: number, executable: string }} KernelProcessIdentity */
/** @typedef {"current" | "dead" | "replaced" | "unverifiable" | "invalid"} StrongProcessState */
/**
 * @typedef {{
 *   prepareWorker(): void,
 *   workerRecord(pid: number, command: string): OwnedWorkerProcessRecord,
 *   workerState(record: OwnedWorkerProcessRecord): StrongProcessState,
 *   prepareKernel(): boolean,
 *   kernelIdentity(pid: number): KernelProcessIdentity | null,
 *   liveEngineCurrent(
 *     record: LiveEngineProcessRecord,
 *     options: { engineExecutable: string },
 *   ): boolean,
 * }} ProcessIdentityAuthority
 */
/**
 * @typedef {{
 *   spawn: SpawnFunction,
 *   spawnSync: SpawnSyncFunction,
 *   signal(pid: number, signal?: string | number): boolean,
 * }} ProcessRuntime
 */

const LIVE_ENGINE_INSTANCE_ENV = "SWIFT_SIM_ENGINE_INSTANCE_NONCE";
const IDENTITY_ATTEMPTS = 5;
const IDENTITY_RETRY_MS = 10;
const WAIT_INTERVAL_MS = 25;

/** @implements {ProcessSupervisor} */
export class NodeProcessSupervisor {
  /**
   * @param {{
   *   runtime: ProcessRuntime,
   *   identity: ProcessIdentityAuthority,
   *   journalStore?: RuntimeJournalStore,
   *   clock?: Clock,
   *   idGenerator?: IdGenerator,
   * }} options
   */
  constructor({
    runtime,
    identity,
    journalStore = new NodeRuntimeJournalStore(),
    clock = new SystemClock(),
    idGenerator = new SystemIdGenerator(),
  }) {
    assertRuntime(runtime);
    assertIdentityAuthority(identity);
    this.runtime = runtime;
    this.identity = identity;
    this.journalStore = journalStore;
    this.clock = clock;
    this.idGenerator = idGenerator;
  }

  /** @template {ProcessRole} Role @param {SpawnRequest<Role>} request @returns {SupervisedProcess<Role>} */
  spawn(request) {
    const normalized = normalizeSpawnRequest(/** @type {AnySpawnRequest} */ (request));
    const instanceNonce = normalized.role === "live-engine" ? this.idGenerator.randomUUID() : "";
    if (normalized.role === "worker") this.identity.prepareWorker();
    if (normalized.role === "live-engine" && !this.identity.prepareKernel()) {
      throw identityError("Unable to prepare the live-engine process identity verifier.");
    }

    const environment = commandEnvironment(normalized.environment);
    if (instanceNonce) environment[LIVE_ENGINE_INSTANCE_ENV] = instanceNonce;

    /** @type {import("node:child_process").ChildProcess} */
    let child;
    try {
      child = this.runtime.spawn(normalized.executable, normalized.args, {
        ...(normalized.cwd === undefined ? {} : { cwd: normalized.cwd }),
        env: environment,
        detached: normalized.processGroup === "new",
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (error) {
      throw spawnError(error);
    }
    child.once("error", () => {});
    if (normalized.processGroup === "new") child.unref();

    const pid = Number(child.pid);
    if (!validPID(pid)) {
      terminateChild(child);
      throw identityError("The supervised process did not publish a valid PID.");
    }

    /** @type {SupervisedProcessRecord | undefined} */
    let record;
    try {
      record = this.captureRecord(normalized, pid, instanceNonce);
      this.journalStore.publishSync(normalized.journalPath, record);
    } catch (error) {
      this.rollback(child, record);
      throw error;
    }

    return /** @type {SupervisedProcess<Role>} */ (
      /** @type {unknown} */ ({ pid, role: normalized.role, record })
    );
  }

  /** @param {SupervisedProcessRecord} record @returns {ProcessInspection} */
  inspect(record) {
    if (isOwnedWorkerProcessRecord(record)) {
      if (!this.targetAlive(record.processGroup, true)) return { state: "dead" };
      const state = this.identity.workerState(record);
      return state === "current"
        ? { state, record }
        : { state: state === "dead" ? "unverifiable" : state };
    }
    if (isLiveEngineProcessRecord(record)) {
      if (!this.targetAlive(record.processGroup, true)) return { state: "dead" };
      if (!this.targetAlive(record.pid, false)) return { state: "unverifiable" };
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
      if (inspection.state !== "current") throw identityChangedError(inspection.state);
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
    let sawUnverifiable = false;

    while (true) {
      if (!this.targetAlive(record.pid, group)) return "exited";
      const inspection = this.inspect(record);
      if (inspection.state === "dead" || inspection.state === "missing") return "exited";
      if (inspection.state === "replaced") return "replaced";
      if (inspection.state === "invalid") return "unverifiable";
      if (inspection.state === "unverifiable") sawUnverifiable = true;

      const remaining = deadline - this.clock.monotonicMilliseconds();
      if (remaining <= 0) return sawUnverifiable ? "unverifiable" : "timeout";
      await this.clock.sleep(Math.min(WAIT_INTERVAL_MS, remaining), signal);
    }
  }

  /** @param {AnySpawnRequest} request @param {number} pid @param {string} instanceNonce */
  captureRecord(request, pid, instanceNonce) {
    if (request.role === "worker") {
      const record = this.identity.workerRecord(pid, request.command);
      if (this.identity.workerState(record) !== "current") {
        throw identityError("Unable to establish the supervised worker process identity.");
      }
      return record;
    }
    if (request.role === "live-engine") {
      const kernel = this.requiredKernelIdentity(pid);
      if (kernel.processGroup !== pid) {
        throw identityError("The supervised live engine did not own its process group.");
      }
      /** @type {LiveEngineProcessRecord} */
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
        throw identityError("Unable to establish the supervised live-engine identity.");
      }
      return record;
    }
    const snapshot = this.requiredDeliverySnapshot(pid);
    if (!request.commandFragments.every((fragment) => snapshot.command.includes(fragment))) {
      throw identityError("The supervised delivery command did not match its required identity.");
    }
    return {
      pid,
      startedAt: snapshot.startedAt,
      commandFragments: [...request.commandFragments],
    };
  }

  /** @param {number} pid @returns {KernelProcessIdentity} */
  requiredKernelIdentity(pid) {
    for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
      const identity = this.identity.kernelIdentity(pid);
      if (identity) return identity;
      sleepSync(IDENTITY_RETRY_MS);
    }
    throw identityError("Unable to read the supervised process kernel identity.");
  }

  /** @param {number} pid @returns {{ startedAt: string, command: string }} */
  requiredDeliverySnapshot(pid) {
    for (let attempt = 0; attempt < IDENTITY_ATTEMPTS; attempt += 1) {
      const snapshot = this.deliverySnapshot(pid);
      if (snapshot.startedAt && snapshot.command) return snapshot;
      sleepSync(IDENTITY_RETRY_MS);
    }
    throw identityError("Unable to read the supervised delivery process identity.");
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
    if (inspection.state !== "current") throw identityChangedError(inspection.state);
  }

  /** @param {number} pid @param {boolean} group */
  targetAlive(pid, group) {
    try {
      this.runtime.signal(group ? -pid : pid, 0);
      return true;
    } catch (error) {
      return hasCode(error, "EPERM");
    }
  }

  /** @param {number} target @param {"SIGTERM" | "SIGKILL"} signal */
  sendSignal(target, signal) {
    try {
      this.runtime.signal(target, signal);
    } catch (error) {
      if (!hasCode(error, "ESRCH")) throw error;
    }
  }

  /** @param {import("node:child_process").ChildProcess} child @param {SupervisedProcessRecord | undefined} record */
  rollback(child, record) {
    if (record && this.inspect(record).state === "current") {
      const group = isOwnedWorkerProcessRecord(record) || isLiveEngineProcessRecord(record);
      this.sendSignal(group ? -record.pid : record.pid, "SIGKILL");
      return;
    }
    terminateChild(child);
  }
}

/** @param {ProcessRuntime} runtime */
function assertRuntime(runtime) {
  if (!runtime || typeof runtime !== "object") {
    throw new TypeError("NodeProcessSupervisor requires an explicit process runtime.");
  }
  if (typeof runtime.spawn !== "function") {
    throw new TypeError("NodeProcessSupervisor runtime must provide spawn.");
  }
  if (typeof runtime.spawnSync !== "function") {
    throw new TypeError("NodeProcessSupervisor runtime must provide spawnSync.");
  }
  if (typeof runtime.signal !== "function") {
    throw new TypeError("NodeProcessSupervisor runtime must provide signal.");
  }
}

/** @param {ProcessIdentityAuthority} identity */
function assertIdentityAuthority(identity) {
  if (!identity || typeof identity !== "object") {
    throw new TypeError("NodeProcessSupervisor requires a process identity authority.");
  }
  if (typeof identity.prepareWorker !== "function") {
    throw new TypeError("Process identity authority must provide prepareWorker.");
  }
  if (typeof identity.workerRecord !== "function") {
    throw new TypeError("Process identity authority must provide workerRecord.");
  }
  if (typeof identity.workerState !== "function") {
    throw new TypeError("Process identity authority must provide workerState.");
  }
  if (typeof identity.prepareKernel !== "function") {
    throw new TypeError("Process identity authority must provide prepareKernel.");
  }
  if (typeof identity.kernelIdentity !== "function") {
    throw new TypeError("Process identity authority must provide kernelIdentity.");
  }
  if (typeof identity.liveEngineCurrent !== "function") {
    throw new TypeError("Process identity authority must provide liveEngineCurrent.");
  }
}

/** @param {AnySpawnRequest} request @returns {AnySpawnRequest} */
function normalizeSpawnRequest(request) {
  const common = normalizeSpawnCommon(request);
  if (request.role === "worker") {
    if (request.processGroup !== "new") {
      throw new TypeError("worker processes must own a new process group.");
    }
    return {
      ...common,
      role: "worker",
      processGroup: "new",
      command: nonempty(request.command, "Worker command identity"),
    };
  }
  if (request.role === "live-engine") {
    if (request.processGroup !== "new") {
      throw new TypeError("live-engine processes must own a new process group.");
    }
    return { ...common, role: "live-engine", processGroup: "new" };
  }
  if (!["gateway", "manager", "tunnel"].includes(request.role)) {
    throw new TypeError("The supervised process role is invalid.");
  }
  if (request.processGroup !== "inherit" && request.processGroup !== "new") {
    throw new TypeError("Supervised processGroup must be inherit or new.");
  }
  return {
    ...common,
    role: request.role,
    processGroup: request.processGroup,
    commandFragments: nonemptyStrings(request.commandFragments, "Delivery command fragments"),
  };
}

/** @param {AnySpawnRequest} request */
function normalizeSpawnCommon(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("A supervised process request is required.");
  }
  return {
    executable: nonempty(request.executable, "Process executable"),
    args: strings(request.args, "Process arguments", true),
    environment: environmentPolicy(request.environment),
    journalPath: nonempty(request.journalPath, "Process journal path"),
    ...(request.cwd === undefined ? {} : { cwd: nonempty(request.cwd, "Process cwd") }),
  };
}

/** @param {TerminationRequest} request @returns {TerminationRequest} */
function normalizeTerminationRequest(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("A process termination request is required.");
  }
  if (request.signal !== "SIGTERM" && request.signal !== "SIGKILL") {
    throw new TypeError("Process termination signal must be SIGTERM or SIGKILL.");
  }
  nonnegativeInteger(request.graceMs, "Process termination grace");
  if (request.terminateGroup) {
    if (!isOwnedWorkerProcessRecord(request.record) && !isLiveEngineProcessRecord(request.record)) {
      throw new TypeError("Only strong process records may authorize group termination.");
    }
  } else if (
    !isOwnedWorkerProcessRecord(request.record) &&
    !isLiveEngineProcessRecord(request.record) &&
    !isDeliveryProcessIdentity(request.record)
  ) {
    throw new TypeError("The process termination record is invalid.");
  }
  return request;
}

/** @param {CommandEnvironmentPolicy} policy */
function commandEnvironment(policy) {
  const normalized = environmentPolicy(policy);
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
function environmentPolicy(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new TypeError("Process environment policy is required.");
  }
  const inherit = environmentNames(policy.inherit);
  const unset = environmentNames(policy.unset);
  if (
    !policy.overrides ||
    typeof policy.overrides !== "object" ||
    Array.isArray(policy.overrides)
  ) {
    throw new TypeError("Process environment overrides must be an object.");
  }
  /** @type {Record<string, string | undefined>} */
  const overrides = {};
  for (const [name, value] of Object.entries(policy.overrides)) {
    environmentName(name);
    if (value !== undefined && (typeof value !== "string" || value.includes("\0"))) {
      throw new TypeError(`Process environment value for ${name} must be a NUL-free string.`);
    }
    overrides[name] = value;
  }
  return { inherit, overrides, unset };
}

/** @param {readonly string[]} values */
function environmentNames(values) {
  if (!Array.isArray(values)) {
    throw new TypeError("Process environment names must be an array.");
  }
  return values.map((value) => environmentName(value));
}

/** @param {string} value */
function environmentName(value) {
  if (typeof value !== "string" || !value || value.includes("=") || value.includes("\0")) {
    throw new TypeError("Process environment names must be non-empty and cannot contain = or NUL.");
  }
  return value;
}

/** @param {readonly string[]} values @param {string} label @param {boolean} [allowEmpty] */
function strings(values, label, allowEmpty = false) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array.`);
  return values.map((value) => checkedString(value, label, allowEmpty));
}

/** @param {readonly string[]} values @param {string} label */
function nonemptyStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError(`${label} must contain at least one value.`);
  }
  return values.map((value) => nonempty(value, label));
}

/** @param {unknown} value @param {string} label */
function nonempty(value, label) {
  return checkedString(value, label, false);
}

/** @param {unknown} value @param {string} label @param {boolean} allowEmpty */
function checkedString(value, label, allowEmpty) {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.includes("\0")) {
    throw new TypeError(
      `${label} must be a ${allowEmpty ? "NUL-free" : "non-empty NUL-free"} string.`,
    );
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

/** @param {SpawnSyncFunction} implementation @param {number} pid @param {string} field */
function psValue(implementation, pid, field) {
  const result = implementation("/bin/ps", ["-p", String(pid), "-o", field], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

/** @param {import("node:child_process").ChildProcess} child */
function terminateChild(child) {
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
function spawnError(error) {
  return Object.assign(
    new Error(
      `Unable to spawn the supervised process: ${error instanceof Error ? error.message : String(error)}`,
    ),
    { code: "SWIFT_SIM_PROCESS_SPAWN_FAILED" },
  );
}

/** @param {string} message */
function identityError(message) {
  return Object.assign(new Error(message), { code: "SWIFT_SIM_PROCESS_IDENTITY_UNAVAILABLE" });
}

/** @param {string} state */
function identityChangedError(state) {
  return Object.assign(
    new Error(`The supervised process identity is ${state}; termination was refused.`),
    { code: "SWIFT_SIM_PROCESS_IDENTITY_CHANGED" },
  );
}
