import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));

export class DeviceDeliveryError extends Error {}

export class DeviceDeliveryAdapter {
  constructor({
    statePath = join(homedir(), ".swift-sim", "device-delivery.json"),
    logPath = join(homedir(), ".swift-sim", "device-delivery.log"),
    managerPath = join(moduleDirectory, "..", "bin", "swift-sim-device-delivery.js"),
    helperPath = join(moduleDirectory, "..", "bin", "swift-sim-helper.js"),
    gatewayPort = Number(process.env.SWIFT_SIM_DEVICE_GATEWAY_PORT || 0),
  } = {}) {
    this.statePath = statePath;
    this.logPath = logPath;
    this.managerPath = managerPath;
    this.helperPath = helperPath;
    this.gatewayPort = gatewayPort;
  }

  async ensure({ ttlMinutes = 30 } = {}) {
    const current = this.status();
    if (deliveryIsReusable(current, ttlMinutes)) return current;
    if (processIsAlive(current.managerPid)) {
      this.stop();
      await waitForProcessExit(current.managerPid, 5_000);
    }

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
      if (state.status === "ready" && state.publicBaseUrl) {
        return state;
      }
      if (state.status === "failed") {
        throw new DeviceDeliveryError(state.error || `Temporary delivery tunnel failed. Log: ${this.logPath}`);
      }
    }

    throw new DeviceDeliveryError(`Temporary delivery tunnel did not become ready. Log: ${this.logPath}`);
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
    const state = this.status();
    let stopped = false;
    if (processIsAlive(state.managerPid)) {
      process.kill(state.managerPid, "SIGTERM");
      stopped = true;
    }
    mkdirSync(dirname(this.statePath), { recursive: true });
    writeFileSync(this.statePath, JSON.stringify({
      ...state,
      status: "stopped",
      publicBaseUrl: "",
      stoppedAt: new Date().toISOString(),
    }, null, 2));
    return stopped;
  }
}

export function deviceDeliveryRequestAllowed(method, pathname) {
  if (String(method || "").toUpperCase() !== "GET") return false;
  if (pathname === "/health") return true;
  if (/^\/d\/[^/]+$/.test(pathname)) return true;
  return /^\/api\/device-builds\/[^/]+(?:\/logs|\/links|\/artifact\/(?:ipa|manifest))?$/.test(pathname);
}

export function parseQuickTunnelUrl(output) {
  const normalized = String(output || "").replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
  return normalized.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0] || "";
}

function deliveryIsReusable(state, ttlMinutes) {
  if (state.status !== "ready" || !state.publicBaseUrl) return false;
  if (!processIsAlive(state.managerPid)) return false;
  const requiredLifetime = Math.max(5, Number(ttlMinutes) || 30) * 60_000 - 30_000;
  if (Date.parse(state.expiresAt || "") <= Date.now() + requiredLifetime) return false;
  return true;
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(pid) && Date.now() < deadline) {
    await sleep(100);
  }
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
