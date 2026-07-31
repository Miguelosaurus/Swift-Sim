import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELPER_RUNTIME_ROLE,
  inspectRuntimeHealth,
  runtimeHealthMatches,
} from "./runtimeHealth.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const helperEntrypoint = join(moduleDirectory, "..", "bin", "swift-sim-helper-entry.js");
const rawFetch = globalThis.fetch;
let fetchBoundaryInstalled = false;

export async function rememberHelperStateForUpdate() {
  const health = await currentHelperRuntimeHealth();
  if (health.reachable) process.env.SWIFT_SIM_HELPER_WAS_RUNNING = "1";
  else delete process.env.SWIFT_SIM_HELPER_WAS_RUNNING;
  return health;
}

export async function reconcileHelperRuntime({ startIfStopped = true } = {}) {
  const port = helperPort();
  const health = await currentHelperRuntimeHealth();
  if (health.ok) {
    return { id: "helper", state: "unchanged", detail: `Mac helper ${health.version} is already running` };
  }

  const brew = findCommand("brew");
  if (brew && process.env.SWIFT_SIM_MARKETPLACE_ROOT) {
    if (!health.reachable && !startIfStopped) {
      return { id: "helper", state: "skipped", detail: "Mac helper was not running before the update" };
    }
    const action = health.reachable ? "restart" : "start";
    const service = runCapture(brew, ["services", action, "swift-sim"]);
    if (service.status === 0 && await waitForCompatibleHelper()) {
      return {
        id: "helper",
        state: action === "restart" ? "restarted" : "started",
        detail: `Mac helper ${action === "restart" ? "restarted" : "started"} with Homebrew services`,
      };
    }
    throw new Error(
      compactError(service)
        || `Homebrew could not ${action} a compatible Swift Sim helper on port ${port}.`
    );
  }

  if (health.reachable) {
    await stopOwnedStandaloneHelper(port);
  } else if (!startIfStopped) {
    return { id: "helper", state: "skipped", detail: "Mac helper is intentionally stopped" };
  }

  startStandaloneHelper();
  if (!await waitForCompatibleHelper()) {
    throw new Error(`A compatible Mac helper did not start. Check ${helperLogPath()}.`);
  }
  return { id: "helper", state: "started", detail: "Compatible Mac helper started for this user session" };
}

export function installCompatibleHelperHealthFetchBoundary() {
  if (fetchBoundaryInstalled || typeof globalThis.fetch !== "function") return;
  fetchBoundaryInstalled = true;
  const healthURL = new URL("/health", helperBaseURL()).href;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function compatibleHelperFetch(input, init) {
    const response = await originalFetch.call(this, input, init);
    if (requestURL(input) !== healthURL || !response.ok) return response;
    let payload = null;
    try { payload = await response.clone().json(); } catch {}
    if (runtimeHealthMatches(payload, HELPER_RUNTIME_ROLE)) return response;
    return new Response(JSON.stringify({ error: "A different or outdated helper is running." }), {
      status: 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  };
}

export function helperCommandLooksOwned(command) {
  const value = String(command || "");
  return /(?:^|\s)(?:[^\s]*\/)?swift-sim-helper(?:-entry)?\.js(?:\s|$)/.test(value)
    && /(?:^|\s)serve(?:\s|$)/.test(value);
}

async function currentHelperRuntimeHealth() {
  return inspectRuntimeHealth(new URL("/health", helperBaseURL()), {
    expectedRole: HELPER_RUNTIME_ROLE,
    fetchImpl: rawFetch,
  });
}

async function waitForCompatibleHelper() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await currentHelperRuntimeHealth()).ok) return true;
    await sleep(250);
  }
  return false;
}

function startStandaloneHelper() {
  const logPath = helperLogPath();
  mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
  const output = openSync(logPath, "a", 0o600);
  try {
    const child = spawn(process.execPath, [helperEntrypoint, "serve"], {
      detached: true,
      stdio: ["ignore", output, output],
      env: process.env,
    });
    child.once("error", () => {});
    child.unref();
  } finally {
    closeSync(output);
  }
}

async function stopOwnedStandaloneHelper(port) {
  const lsof = existingCommand("/usr/sbin/lsof") || findCommand("lsof");
  if (!lsof) {
    throw new Error(
      `Port ${port} is occupied by an incompatible helper, and lsof is unavailable to identify it safely.`
    );
  }
  const result = runCapture(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  const pids = [...new Set(String(result.stdout || "")
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid))];
  if (pids.length === 0) {
    throw new Error(`Port ${port} answered as an incompatible helper, but its process could not be identified safely.`);
  }

  const identities = pids.map((pid) => {
    const command = processCommand(pid);
    const startedAt = processStartedAt(pid);
    if (!command || !startedAt || !helperCommandLooksOwned(command)) {
      throw new Error(`Port ${port} is used by another process. Stop it before starting Swift Sim.`);
    }
    return { pid, startedAt };
  });

  for (const identity of identities) signalOwnedIdentity(identity, "SIGTERM");
  const deadline = Date.now() + 8_000;
  while (identities.some(identityMatches) && Date.now() < deadline) await sleep(100);
  for (const identity of identities) {
    if (identityMatches(identity)) signalOwnedIdentity(identity, "SIGKILL");
  }
  const forceDeadline = Date.now() + 2_000;
  while (identities.some(identityMatches) && Date.now() < forceDeadline) await sleep(100);
  if (identities.some(identityMatches)) {
    throw new Error("The outdated Swift Sim helper could not be stopped safely.");
  }
}

function signalOwnedIdentity(identity, signal) {
  if (!identityMatches(identity)) return;
  try { process.kill(identity.pid, signal); } catch {}
}

function identityMatches(identity) {
  return processIsAlive(identity.pid) && processStartedAt(identity.pid) === identity.startedAt;
}

function processCommand(pid) {
  const result = spawnSync("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function helperPort() {
  const value = Number(process.env.SWIFT_SIM_PORT || 47217);
  return Number.isInteger(value) && value > 0 && value <= 65_535 ? value : 47217;
}

function helperBaseURL() {
  return `http://127.0.0.1:${helperPort()}`;
}

function helperLogPath() {
  return join(homedir(), ".swift-sim", "helper.log");
}

function requestURL(input) {
  try {
    if (typeof input === "string" || input instanceof URL) return new URL(String(input)).href;
    return new URL(String(input?.url || "")).href;
  } catch {
    return "";
  }
}

function existingCommand(path) {
  return existsSync(path) ? path : "";
}

function findCommand(name) {
  const result = spawnSync("/usr/bin/which", [name], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function compactError(result) {
  return String(result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-2).join(" ");
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
