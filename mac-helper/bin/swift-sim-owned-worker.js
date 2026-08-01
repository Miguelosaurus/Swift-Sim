#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "ready-path": { type: "string" },
    "display-command": { type: "string" },
    payload: { type: "string" },
  },
});
const readyPath = required(values["ready-path"], "ready path");
const payload = JSON.parse(Buffer.from(required(values.payload, "payload"), "base64url").toString("utf8"));
const command = required(payload.command, "command");
const args = Array.isArray(payload.args) ? payload.args.map(String) : [];

const handshakeTimeoutMs = normalizeTimeout(process.env.SWIFT_SIM_WORKER_HANDSHAKE_TIMEOUT_MS);
const deadline = Date.now() + handshakeTimeoutMs;
while (!existsSync(readyPath) && Date.now() < deadline) {
  await sleep(10);
}
if (!existsSync(readyPath)) {
  process.stderr.write("Swift Sim worker journal handshake timed out.\n");
  process.exitCode = 78;
} else {
  rmSync(readyPath, { force: true });
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    detached: false,
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.once("error", (error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
  await new Promise((resolve) => child.once("close", resolve));
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}.`);
  return value;
}

function normalizeTimeout(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(50, Math.min(5_000, Math.floor(parsed))) : 5_000;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
