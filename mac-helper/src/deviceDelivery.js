import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import {
  DEFAULT_DEVICE_BUILD_TTL_MINUTES,
  normalizeDeviceBuildTTLMinutes,
} from "./deviceBuildDefaults.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const LIFECYCLE_LOCK_WAIT_MS = 60_000;
const OWNERLESS_LOCK_GRACE_MS = 250;

export class DeviceDeliveryError extends Error {}

export class DeviceDeliveryAdapter {
  constructor({
    statePath = join(homedir(), ".swift-sim", "device-delivery.json"),
    logPath = join(homedir(), ".swift-sim", "device-delivery.log"),
    managerPath = join(moduleDirectory, "..", "bin", "swift-sim-device-delivery.js"),
    helperPath = join(moduleDirectory, "..", "bin", "swift-sim-helper-entry.js"),
    gatewayPort = Number(process.env.SWIFT_SIM_DEVICE_GATEWAY_PORT || 0),
  } = {}) {
    this.statePath = statePath;
    this.logPath = logPath;
    this.managerPath = managerPath;
    this.helperPath = helperPath;
    this.gatewayPort = gatewayPort;
    this.lifecycleLockPath = `${statePath}.lifecycle.lock`;
  }

  async ensure({ ttlMinutes = DEFAULT_DEVICE_BUILD_TTL_MINUTES } = {}) {
    ttlMinutes = normalizeDeviceBuildTTLMinutes(ttlMinutes);
    const release = await acquireLifecycleLock(this.lifecycleLockPath);
    try {
      const current = this.status();
      if (deliveryIsReusable(current, ttlMinutes)) return current;
      terminateOwnedDelivery(current);

      const generation = randomUUID();
      const gatewayPort = this.gatewayPort || await availableLoopbackPort();
      const child = spawn(process.execPath, [
        this.managerPath,
        "--generation", generation,
        "--state-path", this.statePath,
        "--log-path", this.logPath,
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
        const state = this.status();
        if (state.generation !== generation) continue;
        if (state.status === "ready" && state.publicBaseUrl && deliveryProcessesAreOwned(state)) return state;
        if (state.status === "failed") {
          throw new DeviceDeliveryError(state.error || `Temporary delivery tunnel failed. Log: ${this.logPath}`);
        }
      }

      const timedOutState = this.status();
      if (timedOutState.generation === generation) terminateOwnedDelivery(timedOutState);
      throw new DeviceDeliveryError(`Temporary delivery tunnel did not become ready. Log: ${this.logPath}`);
    } finally {
      release();
    }
  }

  status() {
    try {
      return JSON.parse(readFileSync(this.statePath, "utf8"));
    } catch {
      return {
        status: "stopped",
        provider: "cloudflare-quick-tunnel",
        publicBaseUrl: "",
      };
    }
  }

  stop() {
    const release = acquireLifecycleLockSync(this.lifecycleLockPath);
    try {
      const state = this.status();
      const stopped = terminateOwnedDelivery(state);
      const shutdownGeneration = randomUUID();
      writeStateFile(this.statePath, {
        ...state,
        generation: shutdownGeneration,
        managerPid: 0,
        gatewayPid: 0,
        tunnelPid: 0,
        managerIdentity: null,
        gatewayIdentity: null,
        tunnelIdentity: null,
        status: "stopped",
        publicBaseUrl: "",
        stoppedAt: new Date().toISOString(),
      });
      return stopped;
    } finally {
      release();
    }
  }
}

export function deviceDeliveryRequestAllowed(method, pathname) {
  const verb = String(method || "").toUpperCase();
  if (verb === "POST") {
    return /^\/api\/device-builds\/[^/]+\/install-request$/.test(pathname);
  }
  if (verb !== "GET") return false;
  if (pathname === "/health") return true;
  if (/^\/d\/[^/]+$/.test(pathname)) return true;
  return /^\/api\/device-builds\/[^/]+(?:\/links|\/artifact\/(?:ipa|manifest))?$/.test(pathname);
}

export function parseQuickTunnelUrl(output) {
  const normalized = String(output || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return normalized.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] || "";
}

function deliveryIsReusable(state, ttlMinutes) {
  if (state.status !== "ready" || !state.publicBaseUrl) return false;
  if (!deliveryProcessesAreOwned(state)) return false;
  const requiredLifetime = normalizeDeviceBuildTTLMinutes(ttlMinutes) * 60_000 - 30_000;
  if (Date.parse(state.expiresAt || "") <= Date.now() + requiredLifetime) return false;
  return true;
}

function deliveryProcessesAreOwned(state) {
  return processIdentityMatches(state.managerIdentity)
    && processIdentityMatches(state.gatewayIdentity)
    && processIdentityMatches(state.tunnelIdentity);
}

function terminateOwnedDelivery(state) {
  const identities = [state.managerIdentity, state.gatewayIdentity, state.tunnelIdentity].filter(Boolean);
  if (identities.length === 0) return false;
  let signalled = false;

  if (processIdentityMatches(state.managerIdentity)) {
    signalled = true;
    const managerPid = Number(state.managerIdentity.pid);
    try { process.kill(-managerPid, "SIGTERM"); } catch { try { process.kill(managerPid, "SIGTERM"); } catch {} }
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
  return signalled;
}

function processIdentityMatches(identity) {
  if (!identity || !processIsAlive(identity.pid)) return false;
  const command = processCommand(identity.pid);
  if (!command) return false;
  const fragments = Array.isArray(identity.commandFragments) ? identity.commandFragments : [];
  if (!fragments.every((fragment) => command.includes(String(fragment)))) return false;
  return !identity.startedAt || processStartedAt(identity.pid) === identity.startedAt;
}

function processCommand(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
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
  const owner = { pid: process.pid, nonce: randomUUID(), createdAt: new Date().toISOString() };
  try {
    mkdirSync(lockPath, { mode: 0o700 });
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
    if (error?.code !== "EEXIST") {
      try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
      throw error;
    }
    let current;
    try { current = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
    if ((current && !processIsAlive(current.pid)) || (!current && ownerlessLockIsStale(lockPath))) {
      rmSync(lockPath, { recursive: true, force: true });
    }
    return null;
  }
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
