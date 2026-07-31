import "./lockOwnershipPreload.js";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DEFAULT_VERIFICATION_CACHE_MS = 5_000;
const MAX_VERIFICATION_CACHE_ENTRIES = 64;

export class DeviceInventoryAdapter {
  constructor({
    run = runDeviceCtl,
    now = () => Date.now(),
    verificationCacheMs = DEFAULT_VERIFICATION_CACHE_MS,
  } = {}) {
    this.run = run;
    this.now = now;
    this.verificationCacheMs = Math.max(0, Number(verificationCacheMs) || 0);
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
    const inventory = await this.run(["list", "devices"]);
    const devices = physicalIOSDevices(inventory);
    const results = [];

    for (const device of devices) {
      try {
        const response = await this.run([
          "device", "info", "apps",
          "--device", device.udid,
          "--bundle-id", bundleIdentifier,
        ]);
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
      } catch {
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

function verification(state, devices, detail = "") {
  return {
    state,
    verifiedAt: new Date().toISOString(),
    devices,
    detail,
  };
}

async function runDeviceCtl(args) {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-devicectl-"));
  const outputPath = join(directory, "result.json");
  try {
    const result = await run("xcrun", [
      "devicectl",
      ...args,
      "--json-output", outputPath,
      "--timeout", "15",
    ]);
    let payload = null;
    try {
      payload = JSON.parse(readFileSync(outputPath, "utf8"));
    } catch {
      // The process error below includes the useful command output.
    }
    if (result.code !== 0 || payload?.info?.outcome === "failed") {
      throw new Error(payload?.info?.error?.localizedDescription || result.stderr || "devicectl failed.");
    }
    return payload;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: null, stdout, stderr: error.message }));
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
