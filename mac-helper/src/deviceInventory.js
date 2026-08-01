import "./lockOwnershipPreload.js";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VERIFICATION_CACHE_MS = 5_000;
const MAX_VERIFICATION_CACHE_ENTRIES = 64;
const DEFAULT_DEVICECTL_DEADLINE_MS = 20_000;
const DEFAULT_VERIFICATION_DEADLINE_MS = 20_000;
const DEFAULT_FORCE_KILL_DELAY_MS = 1_000;
const DEVICE_VERIFICATION_TIMEOUT_CODE = "SWIFT_SIM_DEVICE_VERIFICATION_TIMEOUT";

export class DeviceInventoryAdapter {
  constructor({
    run = runDeviceCtl,
    now = () => Date.now(),
    verificationCacheMs = DEFAULT_VERIFICATION_CACHE_MS,
    verificationDeadlineMs = DEFAULT_VERIFICATION_DEADLINE_MS,
  } = {}) {
    this.run = run;
    this.now = now;
    this.verificationCacheMs = Math.max(0, Number(verificationCacheMs) || 0);
    this.verificationDeadlineMs = positiveMilliseconds(
      verificationDeadlineMs,
      DEFAULT_VERIFICATION_DEADLINE_MS,
    );
    this.verificationCache = new Map();
  }

  async verifyApp(bundleIdentifier, expected = {}) {
    if (!bundleIdentifier) {
      return verification("unknown", [], "A bundle identifier is required for device verification.");
    }

    const key = JSON.stringify([
      String(bundleIdentifier),
      String(expected.version || ""),
      String(expected.build || ""),
    ]);
    const now = this.now();
    this.pruneVerificationCache(now);
    const cached = this.verificationCache.get(key);
    if (cached?.result && cached.expiresAt > now) return structuredClone(cached.result);
    if (cached?.promise) return structuredClone(await cached.promise);
    if (!this.makeVerificationCacheRoom()) {
      throw new Error("Device verification is busy. Try again shortly.");
    }

    const promise = this.verifyAppUncached(bundleIdentifier, expected)
      .then((result) => {
        this.verificationCache.set(key, {
          result: structuredClone(result),
          expiresAt: this.now() + this.verificationCacheMs,
        });
        this.pruneVerificationCache(this.now());
        return result;
      })
      .catch((error) => {
        this.verificationCache.delete(key);
        throw error;
      });
    this.verificationCache.set(key, { promise, expiresAt: now + this.verificationCacheMs });
    return structuredClone(await promise);
  }

  async verifyAppUncached(bundleIdentifier, expected) {
    const deadlineAt = Date.now() + this.verificationDeadlineMs;
    const inventory = await this.runWithinVerificationDeadline(["list", "devices"], deadlineAt);
    const devices = physicalIOSDevices(inventory);
    const results = [];

    for (const device of devices) {
      try {
        const response = await this.runWithinVerificationDeadline([
          "device", "info", "apps",
          "--device", device.udid,
          "--bundle-id", bundleIdentifier,
        ], deadlineAt);
        const app = response?.result?.apps?.[0];
        const matchesVersion = app
          && (!expected.version || app.version === expected.version)
          && (!expected.build || app.bundleVersion === expected.build);
        results.push({
          name: device.name,
          state: matchesVersion ? "installed" : app ? "different-version" : "not-installed",
          version: app?.version || "",
          build: app?.bundleVersion || "",
        });
      } catch (error) {
        if (error?.code === DEVICE_VERIFICATION_TIMEOUT_CODE) throw error;
        results.push({
          name: device.name,
          state: "unreachable",
          version: "",
          build: "",
        });
      }
    }

    const state = results.some((device) => device.state === "installed")
      ? "verified"
      : results.some((device) => device.state === "different-version")
        ? "different-version"
        : results.some((device) => device.state === "not-installed")
          ? "not-installed"
          : "unknown";
    return verification(state, results);
  }

  async runWithinVerificationDeadline(args, deadlineAt) {
    const remainingMs = Math.floor(deadlineAt - Date.now());
    if (remainingMs <= 0) throw verificationTimeoutError(this.verificationDeadlineMs);
    const operation = Promise.resolve().then(() => this.run(args, { timeoutMs: remainingMs }));
    return promiseWithDeadline(operation, remainingMs, this.verificationDeadlineMs);
  }

  pruneVerificationCache(now) {
    for (const [key, value] of this.verificationCache) {
      if (!value.promise && value.expiresAt <= now) this.verificationCache.delete(key);
    }
  }

  makeVerificationCacheRoom() {
    if (this.verificationCache.size < MAX_VERIFICATION_CACHE_ENTRIES) return true;
    for (const [key, value] of this.verificationCache) {
      if (value.promise) continue;
      this.verificationCache.delete(key);
      return true;
    }
    return false;
  }
}

export function physicalIOSDevices(payload) {
  return (payload?.result?.devices || [])
    .filter((device) => device?.hardwareProperties?.platform === "iOS")
    .filter((device) => device?.hardwareProperties?.reality === "physical")
    .filter((device) => device?.hardwareProperties?.udid)
    .map((device) => ({
      // Capability-token verification results are remotely visible. Never
      // expose a user-assigned device name such as "Miguel's iPhone".
      name: device.hardwareProperties?.marketingName || "iPhone",
      udid: device.hardwareProperties.udid,
    }));
}

export function runCommandWithDeadline(command, args, {
  timeoutMs = DEFAULT_DEVICECTL_DEADLINE_MS,
  forceKillDelayMs = DEFAULT_FORCE_KILL_DELAY_MS,
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const deadlineMs = positiveMilliseconds(timeoutMs, DEFAULT_DEVICECTL_DEADLINE_MS);
    const forceDelayMs = nonnegativeMilliseconds(forceKillDelayMs, DEFAULT_FORCE_KILL_DELAY_MS);
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
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimers();
      resolve(result);
    };
    const timeoutMessage = () => `${command} ${args.join(" ")} exceeded its ${deadlineMs}ms deadline`;
    const timeoutResult = () => {
      const detail = timeoutMessage();
      return {
        code: null,
        stdout,
        stderr: stderr ? `${stderr.trim()}\n${detail}` : detail,
        timedOut: true,
      };
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      if (timedOut) finish(timeoutResult());
      else finish({ code: null, stdout, stderr: error.message, timedOut: false });
    });
    child.once("close", (code) => {
      if (timedOut) finish(timeoutResult());
      else finish({ code, stdout, stderr, timedOut: false });
    });

    deadlineTimer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      signalProcessGroup(child, "SIGTERM");
      forceTimer = setTimeout(() => {
        if (settled) return;
        signalProcessGroup(child, "SIGKILL");
        settleTimer = setTimeout(() => {
          child.stdout.destroy();
          child.stderr.destroy();
          finish(timeoutResult());
        }, 100);
      }, forceDelayMs);
    }, deadlineMs);
  });
}

function verification(state, devices, detail = "") {
  return {
    state,
    verifiedAt: new Date().toISOString(),
    devices,
    detail,
  };
}

async function runDeviceCtl(args, { timeoutMs = DEFAULT_DEVICECTL_DEADLINE_MS } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-devicectl-"));
  const outputPath = join(directory, "result.json");
  try {
    const result = await runCommandWithDeadline("xcrun", [
      "devicectl",
      ...args,
      "--json-output", outputPath,
      "--timeout", "15",
    ], { timeoutMs });
    let payload = null;
    try {
      payload = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      // The process error below includes the useful command output.
    }
    if (result.code !== 0 || payload?.info?.outcome === "failed") {
      const error = new Error(
        payload?.info?.error?.localizedDescription || result.stderr || "devicectl failed.",
      );
      if (result.timedOut) error.code = DEVICE_VERIFICATION_TIMEOUT_CODE;
      throw error;
    }
    return payload;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function promiseWithDeadline(operation, remainingMs, totalDeadlineMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      finish(reject, verificationTimeoutError(totalDeadlineMs));
    }, Math.max(1, remainingMs));
    operation.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function verificationTimeoutError(deadlineMs) {
  const error = new Error(`Physical-device verification exceeded its ${deadlineMs}ms deadline.`);
  error.code = DEVICE_VERIFICATION_TIMEOUT_CODE;
  return error;
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
