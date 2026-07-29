#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { parseQuickTunnelUrl } from "../src/deviceDelivery.js";
import { normalizeDeviceBuildTTLMinutes } from "../src/deviceBuildDefaults.js";

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
const helperPath = required(values["helper-path"], "helper path");
const gatewayPort = Number(values["gateway-port"] || 47218);
const ttlMinutes = normalizeDeviceBuildTTLMinutes(values["ttl-minutes"]);
const localBaseUrl = `http://127.0.0.1:${gatewayPort}`;
const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
let gateway;
let tunnel;
let tunnelSpec;
let finished = false;
let expiryTimer;

mkdirSync(dirname(statePath), { recursive: true, mode: 0o700 });
mkdirSync(dirname(logPath), { recursive: true, mode: 0o700 });
writeState({ status: "starting", provider: "cloudflare-quick-tunnel", publicBaseUrl: "" });

try {
  gateway = spawn(process.execPath, [
    helperPath,
    "serve",
    "--host", "127.0.0.1",
    "--port", String(gatewayPort),
    "--device-builds-only",
  ], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, SWIFT_SIM_PUBLIC_GATEWAY: "1" },
  });
  pipeLogs(gateway, "gateway");
  await waitForHealth(localBaseUrl, 10_000);

  tunnelSpec = tunnelCommand(localBaseUrl);
  tunnel = spawn(tunnelSpec.executable, tunnelSpec.args, { stdio: ["pipe", "pipe", "pipe"] });
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
    if (publicBaseUrl && connected) {
      writeState({ status: "ready", provider: "cloudflare-quick-tunnel", publicBaseUrl });
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

  expiryTimer = setTimeout(() => { void shutdown("expired"); }, ttlMinutes * 60 * 1000);
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
  if (expiryTimer) clearTimeout(expiryTimer);
  await Promise.all([
    terminateChild(tunnel, 5_000),
    terminateChild(gateway, 5_000),
  ]);
  writeState({
    status,
    provider: "cloudflare-quick-tunnel",
    publicBaseUrl: "",
    ...(error ? { error } : {}),
  });
  process.exitCode = status === "failed" ? 1 : 0;
}

async function fail(message) {
  if (finished) return;
  appendLog(`[manager] ${message}\n`);
  await shutdown("failed", message);
}

async function terminateChild(child, timeoutMs) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  try { child.kill("SIGTERM"); } catch {}
  if (await waitForChildExit(child, timeoutMs)) return;
  try { child.kill("SIGKILL"); } catch {}
  await waitForChildExit(child, 2_000);
}

function waitForChildExit(child, timeoutMs) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
  });
}

function writeState(extra) {
  const managerIdentity = processIdentity(process.pid, [process.argv[1], "--generation", generation]);
  const gatewayIdentity = gateway?.pid
    ? processIdentity(gateway.pid, [helperPath, "serve", "--device-builds-only"])
    : null;
  const tunnelIdentity = tunnel?.pid && tunnelSpec
    ? processIdentity(tunnel.pid, tunnelSpec.identityFragments)
    : null;
  const state = {
    generation,
    createdAt,
    expiresAt,
    managerPid: process.pid,
    gatewayPid: gateway?.pid || null,
    tunnelPid: tunnel?.pid || null,
    managerIdentity,
    gatewayIdentity,
    tunnelIdentity,
    localBaseUrl,
    ...extra,
  };
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(temporaryPath, statePath);
}

function processIdentity(pid, commandFragments) {
  const startedAt = processStartedAt(pid);
  return startedAt ? { pid, startedAt, commandFragments } : null;
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function appendLog(value) {
  appendFileSync(logPath, value, { mode: 0o600 });
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
