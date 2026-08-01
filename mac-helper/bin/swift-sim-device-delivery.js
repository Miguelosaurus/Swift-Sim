#!/usr/bin/env node
import "../src/lockOwnershipPreload.js";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { parseQuickTunnelUrl } from "../src/deviceDelivery.js";
import { normalizeDeviceBuildTTLMinutes } from "../src/deviceBuildDefaults.js";
import { publishDeliveryGenerationState } from "../src/deviceDeliveryState.js";

const MAX_LOG_BYTES = 2 * 1024 * 1024;
const RETAIN_LOG_BYTES = 1024 * 1024;

const { values } = parseArgs({
  options: {
    generation: { type: "string" },
    "state-path": { type: "string" },
    "log-path": { type: "string" },
    "helper-path": { type: "string" },
    "gateway-port": { type: "string" },
    "ttl-minutes": { type: "string" },
  },
});

const generation = required(values.generation, "generation");
const statePath = required(values["state-path"], "state path");
const logPath = required(values["log-path"], "log path");
const helperPath = required(values["helper-path"], "gateway path");
const gatewayPort = Number(values["gateway-port"] || 47218);
const ttlMinutes = normalizeDeviceBuildTTLMinutes(values["ttl-minutes"]);
const localBaseUrl = `http://127.0.0.1:${gatewayPort}`;
const createdAt = new Date().toISOString();
let readyAt = "";
let expiresAt = "";
let startupTimeout;
let gateway;
let tunnel;
let tunnelSpec;
const managerIdentity = processIdentity(process.pid, [process.argv[1], "--generation", generation]);
let gatewayIdentity = null;
let tunnelIdentity = null;
let finished = false;
let readyPublished = false;
let expiryTimer;

mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
writeState({ status: "starting", provider: "cloudflare-quick-tunnel", publicBaseUrl: "" });
startupTimeout = setTimeout(
  () => fail("Temporary delivery tunnel did not become ready."),
  45_000
);

try {
  gateway = spawn(process.execPath, [
    helperPath,
    "--host", "127.0.0.1",
    "--port", String(gatewayPort),
  ], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SWIFT_SIM_PUBLIC_GATEWAY: "1" },
  });
  gatewayIdentity = processIdentity(gateway.pid, [helperPath, "--port", String(gatewayPort)]);
  writeState({ status: "starting", provider: "cloudflare-quick-tunnel", publicBaseUrl: "" });
  pipeLogs(gateway, "gateway");
  await waitForHealth(localBaseUrl, 10_000);

  tunnelSpec = tunnelCommand(localBaseUrl);
  tunnel = spawn(tunnelSpec.executable, tunnelSpec.args, {
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
  tunnelIdentity = processIdentity(tunnel.pid, tunnelSpec.identityFragments);
  writeState({ status: "starting", provider: "cloudflare-quick-tunnel", publicBaseUrl: "" });
  let combinedOutput = "";
  let publicBaseUrl = "";
  let connected = false;
  const capture = (source, chunk) => {
    const value = chunk.toString("utf8");
    appendLog(`[${source}] ${value}`);
    if (finished) return;
    combinedOutput = `${combinedOutput}${value}`.slice(-40_000);
    publicBaseUrl = publicBaseUrl || parseQuickTunnelUrl(combinedOutput);
    connected = connected || combinedOutput.includes("Registered tunnel connection");
    if (!readyPublished && publicBaseUrl && connected) {
      readyPublished = true;
      readyAt = new Date().toISOString();
      expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
      clearTimeout(startupTimeout);
      writeState({ status: "ready", provider: "cloudflare-quick-tunnel", publicBaseUrl });
      expiryTimer = setTimeout(() => { void shutdown("expired"); }, ttlMinutes * 60 * 1000);
    }
  };
  tunnel.stdout.on("data", (chunk) => capture("tunnel", chunk));
  tunnel.stderr.on("data", (chunk) => capture("tunnel", chunk));
  tunnel.stdin.write("y\n");

  tunnel.on("exit", (code, signal) => {
    if (!finished) void fail(`Tunnel exited before expiry (${signal || code || "unknown"}).`);
  });
  gateway.on("exit", (code, signal) => {
    if (!finished) void fail(`Device delivery gateway exited (${signal || code || "unknown"}).`);
  });

  process.on("SIGTERM", () => { void shutdown("stopped"); });
  process.on("SIGINT", () => { void shutdown("stopped"); });
} catch (error) {
  await fail(error instanceof Error ? error.message : String(error));
}

function tunnelCommand(url) {
  const explicit = process.env.SWIFT_SIM_QUICK_TUNNEL_COMMAND?.trim();
  if (explicit) {
    return {
      executable: "/bin/sh",
      args: ["-lc", `${explicit} ${shellQuote(url)}`],
      identityFragments: [explicit, url],
    };
  }
  if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0) {
    return {
      executable: "cloudflared",
      args: ["tunnel", "--url", url, "--no-autoupdate", "--loglevel", "info"],
      identityFragments: ["cloudflared", "tunnel", "--url", url],
    };
  }
  return {
    executable: "npx",
    args: ["--yes", "wrangler@4", "tunnel", "quick-start", url],
    identityFragments: ["wrangler@4", "quick-start", url],
  };
}

function pipeLogs(child, source) {
  child.stdout.on("data", (chunk) => appendLog(`[${source}] ${chunk.toString("utf8")}`));
  child.stderr.on("data", (chunk) => appendLog(`[${source}] ${chunk.toString("utf8")}`));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { cache: "no-store" });
      if (response.ok) return;
    } catch {}
    await sleep(200);
  }
  throw new Error("Device delivery gateway did not become healthy.");
}

async function shutdown(status, error = "") {
  if (finished) return;
  finished = true;
  clearTimeout(startupTimeout);
  if (expiryTimer) clearTimeout(expiryTimer);
  const exits = await Promise.all([
    terminateChildProcessGroup(tunnel, 5_000),
    terminateChildProcessGroup(gateway, 5_000),
  ]);
  const allExited = exits.every(Boolean);
  writeState({
    status: allExited ? status : "failed-shutdown",
    provider: "cloudflare-quick-tunnel",
    publicBaseUrl: "",
    ...(!allExited ? { error: error || "Delivery shutdown could not confirm that every child process exited." } : error ? { error } : {}),
  });
  process.exitCode = status === "failed" || !allExited ? 1 : 0;
}

async function fail(message) {
  if (finished) return;
  appendLog(`[manager] ${message}\n`);
  await shutdown("failed", message);
}

async function terminateChildProcessGroup(child, timeoutMs) {
  if (!child?.pid) return true;
  signalProcessGroup(child.pid, "SIGTERM");
  if (await waitForProcessGroupExit(child.pid, timeoutMs)) return true;
  signalProcessGroup(child.pid, "SIGKILL");
  return waitForProcessGroupExit(child.pid, 2_000);
}

function signalProcessGroup(pid, signal) {
  try { process.kill(-Number(pid), signal); } catch {
    try { process.kill(Number(pid), signal); } catch {}
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupIsAlive(pid) && Date.now() < deadline) {
    await sleep(100);
  }
  return !processGroupIsAlive(pid);
}

function processGroupIsAlive(pid) {
  if (!Number.isInteger(Number(pid)) || Number(pid) <= 0) return false;
  try {
    process.kill(-Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function writeState(extra) {
  return publishDeliveryGenerationState(statePath, {
    generation,
    createdAt,
    readyAt,
    expiresAt,
    managerPid: process.pid,
    gatewayPid: gateway?.pid || null,
    tunnelPid: tunnel?.pid || null,
    managerIdentity,
    gatewayIdentity,
    tunnelIdentity,
    localBaseUrl,
    ...extra,
  });
}

function processIdentity(pid, commandFragments) {
  const startedAt = requiredProcessStartedAt(pid);
  return { pid, startedAt, commandFragments };
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error(`Unable to establish process identity for pid ${pid}.`);
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function appendLog(value) {
  appendFileSync(logPath, value, { mode: 0o600 });
  try {
    if (statSync(logPath).size <= MAX_LOG_BYTES) return;
    const content = readFileSync(logPath);
    const tail = content.subarray(Math.max(0, content.length - RETAIN_LOG_BYTES));
    writeFileSync(logPath, tail, { mode: 0o600 });
  } catch {}
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
