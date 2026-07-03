#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { parseQuickTunnelUrl } from "../src/deviceDelivery.js";

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
const ttlMinutes = Math.max(5, Math.min(120, Number(values["ttl-minutes"] || 30)));
const localBaseUrl = `http://127.0.0.1:${gatewayPort}`;
const createdAt = new Date().toISOString();
const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
let gateway;
let tunnel;
let finished = false;

mkdirSync(dirname(statePath), { recursive: true });
mkdirSync(dirname(logPath), { recursive: true });
writeState({ status: "starting", provider: "cloudflare-quick-tunnel", publicBaseUrl: "" });

try {
  gateway = spawn(process.execPath, [
    helperPath,
    "serve",
    "--host", "127.0.0.1",
    "--port", String(gatewayPort),
    "--device-builds-only",
  ], { stdio: ["ignore", "pipe", "pipe"] });
  pipeLogs(gateway, "gateway");
  await waitForHealth(localBaseUrl, 10_000);

  const command = tunnelCommand(localBaseUrl);
  tunnel = spawn(command.executable, command.args, { stdio: ["pipe", "pipe", "pipe"] });
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
    if (!finished) fail(`Tunnel exited before expiry (${signal || code || "unknown"}).`);
  });
  gateway.on("exit", (code, signal) => {
    if (!finished) fail(`Device delivery gateway exited (${signal || code || "unknown"}).`);
  });

  const timeout = setTimeout(() => shutdown("expired"), ttlMinutes * 60 * 1000);
  process.on("SIGTERM", () => { clearTimeout(timeout); shutdown("stopped"); });
  process.on("SIGINT", () => { clearTimeout(timeout); shutdown("stopped"); });
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

function tunnelCommand(url) {
  const explicit = process.env.SWIFT_SIM_QUICK_TUNNEL_COMMAND?.trim();
  if (explicit) {
    return { executable: "/bin/sh", args: ["-lc", `${explicit} ${shellQuote(url)}`] };
  }
  if (spawnSync("cloudflared", ["--version"], { stdio: "ignore" }).status === 0) {
    return {
      executable: "cloudflared",
      args: ["tunnel", "--url", url, "--no-autoupdate", "--loglevel", "info"],
    };
  }
  return {
    executable: "npx",
    args: ["--yes", "wrangler@4", "tunnel", "quick-start", url],
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
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Device delivery gateway did not become healthy.");
}

function shutdown(status) {
  if (finished) return;
  finished = true;
  try { tunnel?.kill("SIGTERM"); } catch {}
  try { gateway?.kill("SIGTERM"); } catch {}
  writeState({ status, provider: "cloudflare-quick-tunnel", publicBaseUrl: "" });
  setTimeout(() => process.exit(0), 200);
}

function fail(message) {
  if (finished) return;
  finished = true;
  appendLog(`[manager] ${message}\n`);
  try { tunnel?.kill("SIGTERM"); } catch {}
  try { gateway?.kill("SIGTERM"); } catch {}
  writeState({ status: "failed", provider: "cloudflare-quick-tunnel", publicBaseUrl: "", error: message });
  setTimeout(() => process.exit(1), 100);
}

function writeState(extra) {
  const state = {
    generation,
    createdAt,
    expiresAt,
    managerPid: process.pid,
    gatewayPid: gateway?.pid || null,
    tunnelPid: tunnel?.pid || null,
    localBaseUrl,
    ...extra,
  };
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
  renameSync(temporaryPath, statePath);
}

function appendLog(value) {
  appendFileSync(logPath, value);
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
