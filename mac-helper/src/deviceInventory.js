import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export class DeviceInventoryAdapter {
  constructor({ run = runDeviceCtl } = {}) {
    this.run = run;
  }

  async verifyApp(bundleIdentifier) {
    if (!bundleIdentifier) {
      return verification("unknown", [], "A bundle identifier is required for device verification.");
    }

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
        results.push({
          name: device.name,
          state: app ? "installed" : "not-installed",
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
      : results.some((device) => device.state === "not-installed")
        ? "not-installed"
        : "unknown";
    return verification(state, results);
  }
}

export function physicalIOSDevices(payload) {
  return (payload?.result?.devices || [])
    .filter((device) => device?.hardwareProperties?.platform === "iOS")
    .filter((device) => device?.hardwareProperties?.reality === "physical")
    .filter((device) => device?.hardwareProperties?.udid)
    .map((device) => ({
      name: device.deviceProperties?.name || device.hardwareProperties?.marketingName || "iPhone",
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
