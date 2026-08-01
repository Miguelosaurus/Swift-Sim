import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HELPER_RUNTIME_ROLE,
  inspectRuntimeHealth,
  runtimeHealthMatches,
} from "./runtimeHealth.js";

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const helperEntrypoint = join(moduleDirectory, "..", "bin", "swift-sim-helper-entry.js");
const rawFetch = globalThis.fetch;
const compatibleHealthURLs = new Set();
let fetchBoundaryInstalled = false;

export async function rememberHelperStateForUpdate() {
  const health = await currentHelperRuntimeHealth();
  const ownedListener = health.reachable ? false : ownedHelperListener(helperPort());
  if (health.reachable || ownedListener) process.env.SWIFT_SIM_HELPER_WAS_RUNNING = "1";
  else delete process.env.SWIFT_SIM_HELPER_WAS_RUNNING;
  return { ...health, ownedListener };
}

export async function reconcileHelperRuntime({ startIfStopped = true } = {}) {
  const port = helperPort();
  const health = await currentHelperRuntimeHealth();
  const restartAfterUpdate = process.env.SWIFT_SIM_HELPER_WAS_RUNNING === "1";
  if (health.ok) {
    return { id: "helper", state: "unchanged", detail: `Mac helper ${health.version} is already running` };
  }

  const brew = findCommand("brew");
  if (brew && process.env.SWIFT_SIM_MARKETPLACE_ROOT) {
    if (!health.reachable && !startIfStopped && !restartAfterUpdate) {
      return { id: "helper", state: "skipped", detail: "Mac helper was not running before the update" };
    }
    const action = health.reachable || restartAfterUpdate ? "restart" : "start";
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

  if (health.reachable || restartAfterUpdate) {
    await stopOwnedStandaloneHelper(port, {
      allowMissing: restartAfterUpdate && !health.reachable,
    });
  } else if (!startIfStopped) {
    return { id: "helper", state: "skipped", detail: "Mac helper is intentionally stopped" };
  }

  startStandaloneHelper();
  if (!await waitForCompatibleHelper()) {
    throw new Error(`A compatible Mac helper did not start. Check ${helperLogPath()}.`);
  }
  return { id: "helper", state: "started", detail: "Compatible Mac helper started for this user session" };
}

export function installCompatibleHelperHealthFetchBoundary({
  healthURLs = helperHealthURLsFromProcess(),
} = {}) {
  for (const url of healthURLs) {
    const normalized = requestURL(url);
    if (normalized) compatibleHealthURLs.add(normalized);
  }
  compatibleHealthURLs.add(new URL("/health", helperBaseURL()).href);
  if (fetchBoundaryInstalled || typeof globalThis.fetch !== "function") return;
  fetchBoundaryInstalled = true;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function compatibleHelperFetch(input, init) {
    const response = await originalFetch.call(this, input, init);
    if (!compatibleHealthURLs.has(requestURL(input)) || !response.ok) return response;
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

export function helperHealthURLsFromProcess(argv = process.argv) {
  const urls = [new URL("/health", helperBaseURL()).href];
  if (String(argv?.[2] || "") !== "setup-status") return urls;
  const values = parseHelperEndpointArgs(Array.isArray(argv) ? argv.slice(3) : []);
  const host = values.host || process.env.SWIFT_SIM_HOST || "127.0.0.1";
  const port = validPort(values.port) || helperPort();
  urls.push(`http://${urlHost(host)}:${port}/health`);
  return [...new Set(urls.map((url) => new URL(url).href))];
}

export function helperCommandLooksOwned(command) {
  const value = String(command || "").trim();
  const match = value.match(
    /^("[^"]+"|'[^']+'|\S+)\s+("[^"]+"|'[^']+'|\S+)\s+serve(?:\s|$)/
  );
  if (!match) return false;
  const executable = unquote(match[1]);
  const script = unquote(match[2]);
  return /^node(?:[.-]\d+)*$/.test(basename(executable))
    && /(?:^|\/)mac-helper\/bin\/swift-sim-helper(?:-entry)?\.js$/.test(script);
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

async function stopOwnedStandaloneHelper(port, { allowMissing = false } = {}) {
  const lsof = existingCommand("/usr/sbin/lsof") || findCommand("lsof");
  if (!lsof) {
    if (allowMissing) return false;
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
    if (allowMissing) return false;
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
  return true;
}

function ownedHelperListener(port) {
  const lsof = existingCommand("/usr/sbin/lsof") || findCommand("lsof");
  if (!lsof) return false;
  const result = runCapture(lsof, ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"]);
  if (result.status !== 0) return false;
  return String(result.stdout || "")
    .split(/\s+/)
    .map(Number)
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid)
    .some((pid) => {
      const command = processCommand(pid);
      return Boolean(command) && helperCommandLooksOwned(command);
    });
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
  return validPort(process.env.SWIFT_SIM_PORT) || 47217;
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

function parseHelperEndpointArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const argument = String(args[index] || "");
    if (argument === "--host" && args[index + 1] !== undefined) {
      values.host = String(args[index + 1]);
      index += 1;
    } else if (argument.startsWith("--host=")) {
      values.host = argument.slice("--host=".length);
    } else if (["--port", "-p"].includes(argument) && args[index + 1] !== undefined) {
      values.port = String(args[index + 1]);
      index += 1;
    } else if (argument.startsWith("--port=")) {
      values.port = argument.slice("--port=".length);
    } else if (argument.startsWith("-p=")) {
      values.port = argument.slice(3);
    }
  }
  return values;
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : 0;
}

function urlHost(value) {
  const host = String(value || "127.0.0.1").trim();
  if (host.startsWith("[") && host.endsWith("]")) return host;
  return host.includes(":") ? `[${host}]` : host;
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

function unquote(value) {
  const text = String(value || "");
  if ((text.startsWith('"') && text.endsWith('"'))
      || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
