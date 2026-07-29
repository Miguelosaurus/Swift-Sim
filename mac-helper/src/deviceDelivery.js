import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { createServer } from "node:net";
import {
  DEFAULT_DEVICE_BUILD_TTL_MINUTES,
  normalizeDeviceBuildTTLMinutes,
} from "./deviceBuildDefaults.js";
import {
  DeviceDeliveryAdapter as DeviceDeliveryAdapterCore,
  DeviceDeliveryError as DeviceDeliveryErrorCore,
} from "./deviceDeliveryCore.js";

export {
  deviceDeliveryRequestAllowed,
  parseQuickTunnelUrl,
} from "./deviceDeliveryCore.js";

const LIFECYCLE_LOCK_WAIT_MS = 60_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const GENERATION_PREFIX = ".generation-";

export class DeviceDeliveryError extends DeviceDeliveryErrorCore {}

export class DeviceDeliveryAdapter extends DeviceDeliveryAdapterCore {
  constructor(options = {}) {
    super(options);
    this.lifecycleLockPath = `${this.statePath}.lifecycle.lock`;
  }

  async ensure({ ttlMinutes = DEFAULT_DEVICE_BUILD_TTL_MINUTES } = {}) {
    ttlMinutes = normalizeDeviceBuildTTLMinutes(ttlMinutes);
    const release = await acquireLifecycleLock(this.lifecycleLockPath);
    try {
      this.reapExpiredGenerations();
      const records = deliveryStateRecords(this.statePath);
      const reusable = records
        .map((record) => record.state)
        .filter((state) => deliveryIsReusable(state, ttlMinutes))
        .sort((a, b) => Date.parse(a.expiresAt || "") - Date.parse(b.expiresAt || ""))[0];
      if (reusable) return reusable;

      const generation = randomUUID();
      const generationStatePath = deliveryGenerationStatePath(this.statePath, generation);
      const generationLogPath = deliveryGenerationLogPath(this.logPath, generation);
      const hasLiveGeneration = records.some(({ state }) => recordedDeliveryProcessesAlive(state));
      const gatewayPort = this.gatewayPort && !hasLiveGeneration
        ? this.gatewayPort
        : await availableLoopbackPort();
      const child = spawn(process.execPath, [
        this.managerPath,
        "--generation", generation,
        "--state-path", generationStatePath,
        "--log-path", generationLogPath,
        "--helper-path", this.helperPath,
        "--gateway-port", String(gatewayPort),
        "--ttl-minutes", String(ttlMinutes),
      ], {
        detached: true,
        stdio: "ignore",
        env: process.env,
      });
      child.unref();

      const deadline = Date.now() + 45_000;
      while (Date.now() < deadline) {
        await sleep(250);
        const state = readStateFile(generationStatePath);
        if (!state || state.generation !== generation) continue;
        if (state.status === "ready" && state.publicBaseUrl && deliveryProcessesAreOwned(state)) {
          return state;
        }
        if (state.status === "failed") {
          throw new DeviceDeliveryError(state.error || `Temporary delivery tunnel failed. Log: ${generationLogPath}`);
        }
      }

      const timedOut = readStateFile(generationStatePath);
      if (timedOut?.generation === generation) {
        const outcome = terminateOwnedDelivery(timedOut);
        persistShutdownOutcome(generationStatePath, timedOut, outcome);
      }
      throw new DeviceDeliveryError(`Temporary delivery tunnel did not become ready. Log: ${generationLogPath}`);
    } finally {
      release();
    }
  }

  statuses() {
    return deliveryStateRecords(this.statePath).map(({ state }) => state);
  }

  status() {
    const states = this.statuses();
    const active = states.filter((state) => recordedDeliveryProcessesAlive(state));
    const selected = active
      .filter((state) => state.status === "ready")
      .sort(newestFirst)[0]
      || active.sort(newestFirst)[0]
      || states.sort(newestFirst)[0]
      || {
        status: "stopped",
        provider: "cloudflare-quick-tunnel",
        publicBaseUrl: "",
      };
    return {
      ...selected,
      activeGenerations: active.length,
    };
  }

  stop() {
    const release = acquireLifecycleLockSync(this.lifecycleLockPath);
    try {
      const records = deliveryStateRecords(this.statePath);
      let signalled = false;
      const survivors = [];
      for (const { path, state } of records) {
        const outcome = terminateOwnedDelivery(state);
        signalled = outcome.signalled || signalled;
        if (outcome.allExited) {
          removeGenerationFiles({
            statePath: this.statePath,
            logPath: this.logPath,
            recordPath: path,
            state,
          });
        } else {
          survivors.push(state.generation || path);
          persistShutdownOutcome(path, state, outcome);
        }
      }

      if (survivors.length === 0) {
        writeStateFile(this.statePath, {
          generation: randomUUID(),
          status: "stopped",
          provider: "cloudflare-quick-tunnel",
          publicBaseUrl: "",
          activeGenerations: 0,
          stoppedAt: new Date().toISOString(),
        });
      } else if (!records.some(({ path }) => path === this.statePath)) {
        writeStateFile(this.statePath, {
          generation: randomUUID(),
          status: "failed-shutdown",
          provider: "cloudflare-quick-tunnel",
          publicBaseUrl: "",
          activeGenerations: survivors.length,
          survivingGenerations: survivors,
          error: "One or more delivery processes are still alive or could not be safely verified.",
          updatedAt: new Date().toISOString(),
        });
      }
      return signalled && survivors.length === 0;
    } finally {
      release();
    }
  }

  reapExpiredGenerations() {
    const now = Date.now();
    for (const { path, state } of deliveryStateRecords(this.statePath)) {
      const expired = Number.isFinite(Date.parse(state.expiresAt || ""))
        && Date.parse(state.expiresAt) <= now;
      const terminal = ["expired", "failed", "stopped", "failed-shutdown"].includes(state.status);
      if (!expired && !terminal) continue;
      const outcome = terminateOwnedDelivery(state);
      if (outcome.allExited) {
        removeGenerationFiles({
          statePath: this.statePath,
          logPath: this.logPath,
          recordPath: path,
          state,
        });
      } else {
        persistShutdownOutcome(path, state, outcome);
      }
    }
  }
}

export function deliveryGenerationStatePath(statePath, generation) {
  return `${statePath}${GENERATION_PREFIX}${generation}.json`;
}

export function deliveryGenerationLogPath(logPath, generation) {
  return `${logPath}${GENERATION_PREFIX}${generation}.log`;
}

function deliveryStateRecords(statePath) {
  const records = [];
  const legacy = readStateFile(statePath);
  if (legacy) records.push({ path: statePath, state: legacy });

  const directory = dirname(statePath);
  const prefix = `${basename(statePath)}${GENERATION_PREFIX}`;
  try {
    for (const name of readdirSync(directory)) {
      if (!name.startsWith(prefix) || !name.endsWith(".json")) continue;
      const path = join(directory, name);
      const state = readStateFile(path);
      if (state) records.push({ path, state });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  return records;
}

function readStateFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function newestFirst(a, b) {
  return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
}

function deliveryIsReusable(state, ttlMinutes) {
  if (state.status !== "ready" || !state.publicBaseUrl) return false;
  if (!deliveryProcessesAreOwned(state)) return false;
  const requiredLifetime = normalizeDeviceBuildTTLMinutes(ttlMinutes) * 60_000 - 30_000;
  return Date.parse(state.expiresAt || "") > Date.now() + requiredLifetime;
}

function deliveryProcessesAreOwned(state) {
  return processIdentityMatches(state.managerIdentity)
    && processIdentityMatches(state.gatewayIdentity)
    && processIdentityMatches(state.tunnelIdentity);
}

function recordedDeliveryProcessesAlive(state) {
  return deliveryIdentities(state).some((identity) => processIsAlive(identity.pid))
    || legacyDeliveryPIDs(state).some(processIsAlive);
}

function recordedDeliveryProcessesExited(state) {
  return deliveryIdentities(state).every((identity) => !processIsAlive(identity.pid))
    && legacyDeliveryPIDs(state).every((pid) => !processIsAlive(pid));
}

function deliveryIdentities(state) {
  return [state.managerIdentity, state.gatewayIdentity, state.tunnelIdentity].filter(Boolean);
}

function legacyDeliveryPIDs(state) {
  if (deliveryIdentities(state).length > 0) return [];
  return [state.managerPid, state.gatewayPid, state.tunnelPid]
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

function terminateOwnedDelivery(state) {
  const identities = deliveryIdentities(state);
  const legacyPIDs = legacyDeliveryPIDs(state);
  if (identities.length === 0 && legacyPIDs.length === 0) {
    return { signalled: false, allExited: true, survivors: [] };
  }
  let signalled = false;

  if (processIdentityMatches(state.managerIdentity)) {
    signalled = true;
    const managerPid = Number(state.managerIdentity.pid);
    try { process.kill(-managerPid, "SIGTERM"); } catch {
      try { process.kill(managerPid, "SIGTERM"); } catch {}
    }
    waitForIdentityExit(state.managerIdentity, 5_000);
  }

  for (const identity of [state.gatewayIdentity, state.tunnelIdentity]) {
    if (!processIdentityMatches(identity)) continue;
    signalled = true;
    try { process.kill(Number(identity.pid), "SIGTERM"); } catch {}
  }
  for (const identity of [state.gatewayIdentity, state.tunnelIdentity]) {
    waitForIdentityExit(identity, 2_000);
    if (!processIdentityMatches(identity)) continue;
    try { process.kill(Number(identity.pid), "SIGKILL"); } catch {}
    waitForIdentityExit(identity, 1_000);
  }

  if (processIdentityMatches(state.managerIdentity)) {
    try { process.kill(Number(state.managerIdentity.pid), "SIGKILL"); } catch {}
    waitForIdentityExit(state.managerIdentity, 2_000);
  }

  const survivors = [
    ...identities
      .filter((identity) => processIsAlive(identity.pid))
      .map((identity) => ({
        pid: Number(identity.pid),
        ownershipVerified: processIdentityMatches(identity),
      })),
    ...legacyDeliveryPIDs(state)
      .filter(processIsAlive)
      .map((pid) => ({ pid, ownershipVerified: false, legacy: true })),
  ];
  return {
    signalled,
    allExited: recordedDeliveryProcessesExited(state),
    survivors,
  };
}

function persistShutdownOutcome(path, state, outcome) {
  if (outcome.allExited) return;
  writeStateFile(path, {
    ...state,
    status: "failed-shutdown",
    publicBaseUrl: "",
    error: "Delivery shutdown could not confirm that every recorded process exited.",
    survivingProcesses: outcome.survivors,
    updatedAt: new Date().toISOString(),
  });
}

function removeGenerationFiles({ statePath, logPath, recordPath, state }) {
  if (recordPath !== statePath) rmSync(recordPath, { force: true });
  if (state.generation) {
    rmSync(deliveryGenerationLogPath(logPath, state.generation), { force: true });
  }
}

function processIdentityMatches(identity) {
  if (!identity || !identity.startedAt || !processIsAlive(identity.pid)) return false;
  const command = processCommand(identity.pid);
  if (!command) return false;
  const fragments = Array.isArray(identity.commandFragments) ? identity.commandFragments : [];
  if (!fragments.every((fragment) => command.includes(String(fragment)))) return false;
  return processStartedAt(identity.pid) === identity.startedAt;
}

function processCommand(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new DeviceDeliveryError("Unable to establish a process start identity for the delivery lifecycle lock.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function waitForIdentityExit(identity, timeoutMs) {
  if (!identity) return;
  const deadline = Date.now() + timeoutMs;
  while (processIdentityMatches(identity) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}

async function acquireLifecycleLock(lockPath) {
  const deadline = Date.now() + LIFECYCLE_LOCK_WAIT_MS;
  while (true) {
    const release = tryAcquireLifecycleLock(lockPath);
    if (release) return release;
    if (Date.now() >= deadline) throw new DeviceDeliveryError("Timed out waiting for the device-delivery lifecycle lock.");
    await sleep(50);
  }
}

function acquireLifecycleLockSync(lockPath) {
  const deadline = Date.now() + LIFECYCLE_LOCK_WAIT_MS;
  while (true) {
    const release = tryAcquireLifecycleLock(lockPath);
    if (release) return release;
    if (Date.now() >= deadline) throw new DeviceDeliveryError("Timed out waiting for the device-delivery lifecycle lock.");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  }
}

function tryAcquireLifecycleLock(lockPath) {
  const ownerPath = join(lockPath, "owner.json");
  const owner = {
    pid: process.pid,
    startedAt: requiredProcessStartedAt(process.pid),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  let created = false;
  try {
    mkdirSync(lockPath, { mode: 0o700 });
    created = true;
    writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
    return () => {
      try {
        const current = JSON.parse(readFileSync(ownerPath, "utf8"));
        if (current.pid === owner.pid && current.nonce === owner.nonce) {
          rmSync(lockPath, { recursive: true, force: true });
        }
      } catch {}
    };
  } catch (error) {
    if (created) {
      rmSync(lockPath, { recursive: true, force: true });
      throw error;
    }
    if (error?.code !== "EEXIST") throw error;
    let current;
    try { current = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
    if ((current && !lockOwnerIsAlive(current)) || (!current && ownerlessLockIsStale(lockPath))) {
      rmSync(lockPath, { recursive: true, force: true });
    }
    return null;
  }
}

function lockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) return true;
  return processStartedAt(owner.pid) === owner.startedAt;
}

function ownerlessLockIsStale(lockPath) {
  try {
    return Date.now() - statSync(lockPath).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}

function writeStateFile(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, path);
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function availableLoopbackPort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
