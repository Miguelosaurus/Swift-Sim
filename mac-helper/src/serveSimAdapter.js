import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const bundledServeSim = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "node_modules", ".bin", "serve-sim");
const pinnedServeSimPackage = "serve-sim@0.1.44";
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_KILL_TIMEOUT_MS = 10_000;
const DEFAULT_FORCE_KILL_DELAY_MS = 1_000;

export class ServeSimError extends Error {}

export class ServeSimAdapter {
  constructor({
    command = process.env.SWIFT_SIM_SERVE_SIM_COMMAND || (existsSync(bundledServeSim) ? bundledServeSim : "npx"),
    packageName = pinnedServeSimPackage,
    commandTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS,
    killTimeoutMs = DEFAULT_KILL_TIMEOUT_MS,
    forceKillDelayMs = DEFAULT_FORCE_KILL_DELAY_MS,
  } = {}) {
    this.command = command;
    this.packageName = packageName;
    this.commandTimeoutMs = positiveMilliseconds(commandTimeoutMs, DEFAULT_COMMAND_TIMEOUT_MS);
    this.killTimeoutMs = positiveMilliseconds(killTimeoutMs, DEFAULT_KILL_TIMEOUT_MS);
    this.forceKillDelayMs = nonnegativeMilliseconds(forceKillDelayMs, DEFAULT_FORCE_KILL_DELAY_MS);
  }

  async inspect() {
    const [version, help] = await Promise.all([
      this.run(this.arguments(["--version"]), { allowFailure: true }),
      this.run(this.arguments(["--help"]), { allowFailure: true }),
    ]);
    return {
      command: this.command,
      packageName: this.packageName,
      version: firstLine(version.stdout || version.stderr),
      supports: {
        detach: has(help.stdout, "--detach"),
        quiet: has(help.stdout, "--quiet"),
        host: has(help.stdout, "--host"),
        port: has(help.stdout, "--port"),
        list: has(help.stdout, "--list"),
        kill: has(help.stdout, "--kill"),
        tap: has(help.stdout, "tap [options]"),
        gesture: has(help.stdout, "gesture [options]"),
        type: has(help.stdout, "type [options]"),
        rotate: has(help.stdout, "rotate [options]"),
      },
      help: help.stdout || help.stderr,
    };
  }

  async start({ simulatorUDID, port } = {}) {
    if (!simulatorUDID) throw new ServeSimError("Missing simulator UDID.");
    const args = ["--detach", "--quiet", "--host", "127.0.0.1"];
    if (port) args.push("--port", String(port));
    args.push(simulatorUDID);

    const result = await this.run(this.arguments(args), { allowFailure: false });
    const parsed = parseServeSimOutput(result.stdout, result.stderr);
    if (!parsed.previewUrl) {
      throw new ServeSimError(`serve-sim did not return a preview URL. Output: ${result.stdout || result.stderr}`);
    }
    return {
      ...parsed,
      raw: { stdout: result.stdout, stderr: result.stderr },
      logs: compact([result.stderr.trim(), result.stdout.trim()]),
    };
  }

  async kill(simulatorUDID) {
    if (!simulatorUDID) throw new ServeSimError("Refusing to run unscoped serve-sim --kill.");
    return this.run(this.arguments(["--kill", simulatorUDID]), {
      allowFailure: true,
      timeoutMs: this.killTimeoutMs,
    });
  }

  async tap({ simulatorUDID, x, y }) {
    return this.run(this.arguments(["tap", String(x), String(y), "-d", simulatorUDID]));
  }

  async gesture({ simulatorUDID, event }) {
    return this.run(this.arguments(["gesture", JSON.stringify(event), "-d", simulatorUDID]));
  }

  async type({ simulatorUDID, text }) {
    return this.run(this.arguments(["type", text, "-d", simulatorUDID]));
  }

  async rotate({ simulatorUDID, orientation }) {
    return this.run(this.arguments(["rotate", orientation, "-d", simulatorUDID]));
  }

  async button({ simulatorUDID, name = "home" }) {
    return this.run(this.arguments(["button", name, "-d", simulatorUDID]));
  }

  async ui({ simulatorUDID, args = [] }) {
    return this.run(this.arguments(["ui", ...args, "-d", simulatorUDID]));
  }

  async caDebug({ simulatorUDID, option, state }) {
    return this.run(this.arguments(["ca-debug", option, state, "-d", simulatorUDID]));
  }

  async memoryWarning({ simulatorUDID }) {
    return this.run(this.arguments(["memory-warning", "-d", simulatorUDID]));
  }

  arguments(args) {
    return this.command === "npx" ? ["--yes", this.packageName, ...args] : args;
  }

  run(args, {
    allowFailure = false,
    timeoutMs = this.commandTimeoutMs,
  } = {}) {
    return new Promise((resolve, reject) => {
      const deadlineMs = positiveMilliseconds(timeoutMs, this.commandTimeoutMs);
      const child = spawn(this.command, args, {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timedOut = false;
      let deadlineTimer;
      let forceTimer;
      let settleTimer;

      const clearTimers = () => {
        clearTimeout(deadlineTimer);
        clearTimeout(forceTimer);
        clearTimeout(settleTimer);
      };
      const resolveOnce = (result) => {
        if (settled) return;
        settled = true;
        clearTimers();
        resolve(result);
      };
      const rejectOnce = (error) => {
        if (settled) return;
        settled = true;
        clearTimers();
        reject(error);
      };
      const timeoutError = () => new ServeSimError(
        `serve-sim timed out after ${deadlineMs}ms: ${stderr || stdout}`,
      );

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.once("error", (error) => {
        if (timedOut) return;
        rejectOnce(new ServeSimError(`serve-sim could not start: ${error.message}`));
      });
      child.once("close", (code) => {
        if (timedOut) return;
        if (code !== 0 && !allowFailure) {
          rejectOnce(new ServeSimError(`serve-sim failed with exit code ${code}: ${stderr || stdout}`));
          return;
        }
        resolveOnce({ code, stdout, stderr });
      });

      deadlineTimer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        forceTimer = setTimeout(() => {
          if (settled) return;
          signalProcessGroup(child, "SIGKILL");
          settleTimer = setTimeout(() => {
            child.stdout.destroy();
            child.stderr.destroy();
            rejectOnce(timeoutError());
          }, 100);
        }, this.forceKillDelayMs);
        signalProcessGroup(child, "SIGTERM");
      }, deadlineMs);
    });
  }
}

export function parseServeSimOutput(stdout = "", stderr = "") {
  const combined = `${stdout}\n${stderr}`.trim();
  const json = parseFirstJson(combined);
  const urlFromJson = findUrl(json);
  const urlFromText = combined.match(/https?:\/\/[^\s"'<>]+/)?.[0];
  const previewUrl = urlFromJson || urlFromText || "";
  return {
    previewUrl,
    wsUrl: findWsUrl(json) || combined.match(/wss?:\/\/[^\s"'<>]+/)?.[0] || "",
    port: previewUrl ? Number(new URL(previewUrl).port || defaultPort(new URL(previewUrl).protocol)) : undefined,
    pid: findPid(json),
  };
}

function signalProcessGroup(child, signal) {
  const pid = Number(child?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try { child.kill(signal); } catch {}
  }
}

function positiveMilliseconds(value, fallback) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? Math.floor(milliseconds)
    : fallback;
}

function nonnegativeMilliseconds(value, fallback) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds >= 0
    ? Math.floor(milliseconds)
    : fallback;
}

function parseFirstJson(text) {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      // Continue; serve-sim may print human-readable lines around JSON.
    }
  }
  return null;
}

function findUrl(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["streamUrl", "previewUrl", "url", "serverUrl", "href"]) {
    if (typeof value[key] === "string" && value[key].startsWith("http")) return value[key];
  }
  for (const nested of Object.values(value)) {
    const result = findUrl(nested);
    if (result) return result;
  }
  return "";
}

function findWsUrl(value) {
  if (!value || typeof value !== "object") return "";
  for (const key of ["wsUrl", "webSocketUrl", "websocketUrl"]) {
    if (typeof value[key] === "string" && value[key].startsWith("ws")) return value[key];
  }
  for (const nested of Object.values(value)) {
    const result = findWsUrl(nested);
    if (result) return result;
  }
  return "";
}

function findPid(value) {
  if (!value || typeof value !== "object") return undefined;
  if (typeof value.pid === "number") return value.pid;
  for (const nested of Object.values(value)) {
    const result = findPid(nested);
    if (result) return result;
  }
  return undefined;
}

function defaultPort(protocol) {
  return protocol === "https:" ? 443 : 80;
}

function firstLine(value = "") {
  return value.trim().split(/\r?\n/)[0] || "";
}

function has(text = "", needle) {
  return text.includes(needle);
}

function compact(values) {
  return values.filter(Boolean);
}
