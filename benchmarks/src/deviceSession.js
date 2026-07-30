import { execFileSync, spawn as nodeSpawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function launchDeviceConsole({
  device,
  bundleID,
  environment = {},
  spawnProcess = nodeSpawn,
  timeoutSeconds = 600,
} = {}) {
  if (!device) throw new Error("A trusted physical device must be selected explicitly with --device.");
  if (!bundleID) throw new Error("A fixture bundle identifier is required.");
  const args = [
    "devicectl", "device", "process", "launch",
    "--device", device,
    "--terminate-existing",
    "--console",
    "--timeout", String(timeoutSeconds),
  ];
  if (Object.keys(environment).length) {
    args.push("--environment-variables", JSON.stringify(environment));
  }
  args.push(bundleID);
  const child = spawnProcess("xcrun", args, { stdio: ["ignore", "pipe", "pipe"] });
  const output = createLineQueue(child.stdout);
  const errors = [];
  child.stderr?.on("data", (chunk) => errors.push(String(chunk)));
  return {
    child,
    ...output,
    stderr: errors,
    close(signal = "SIGTERM") {
      if (!child.killed) child.kill(signal);
    },
  };
}

export function createLineQueue(stream) {
  const readline = createInterface({ input: stream });
  const waiters = [];
  const buffered = [];
  let ended = false;
  let endError = null;
  readline.on("line", (line) => {
    for (let index = 0; index < waiters.length; index += 1) {
      const waiter = waiters[index];
      if (!waiter.predicate(line)) continue;
      waiters.splice(index, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(line);
      return;
    }
    buffered.push(line);
  });
  readline.on("close", () => {
    ended = true;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(endError || new Error("Device console ended before the expected marker."));
    }
  });
  return {
    async waitForLine({ predicate = () => true, timeoutMs = 30_000 } = {}) {
      const bufferedIndex = buffered.findIndex(predicate);
      if (bufferedIndex >= 0) return buffered.splice(bufferedIndex, 1)[0];
      if (ended) throw endError || new Error("Device console ended before the expected marker.");
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject };
        waiter.timer = setTimeout(() => {
          const index = waiters.indexOf(waiter);
          if (index >= 0) waiters.splice(index, 1);
          reject(Object.assign(new Error("Timed out waiting for device console output."), { code: "PATCH_TIMEOUT" }));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    async *lines() {
      while (!ended || buffered.length) {
        if (buffered.length) {
          yield buffered.shift();
          continue;
        }
        yield await this.waitForLine();
      }
    },
  };
}

export function listDevices({ spawnProcess = nodeSpawn, timeoutSeconds = 30 } = {}) {
  const outputDirectory = mkdtempSync(join(tmpdir(), "swift-sim-benchmark-devices-"));
  const outputPath = join(outputDirectory, `${randomUUID()}.json`);
  try {
    const result = spawnSync("xcrun", ["devicectl", "list", "devices", "--json-output", outputPath, "--timeout", String(timeoutSeconds)], { spawnProcess });
    if (result.status !== 0) throw new Error(result.stderr || "devicectl could not list devices.");
    return JSON.parse(readFileSync(outputPath, "utf8"));
  } finally {
    rmSync(outputDirectory, { recursive: true, force: true });
  }
}

export function selectTrustedDevice({ device, devices }) {
  if (!device) throw new Error("Refusing to guess a physical device. Pass --device explicitly.");
  const entries = normalizeDeviceEntries(devices);
  const matches = entries.filter((entry) => [entry.identifier, entry.udid, entry.name, entry.dnsName].includes(device));
  if (matches.length !== 1) throw new Error(`Expected exactly one trusted device matching --device; found ${matches.length}.`);
  return matches[0];
}

function normalizeDeviceEntries(value) {
  const candidates = value?.result?.devices || value?.devices || value?.deviceList || value?.result?.deviceList || [];
  return candidates.map((entry) => ({
    identifier: entry.identifier || entry.udid || entry.deviceIdentifier || entry.device?.identifier,
    udid: entry.udid || entry.deviceIdentifier,
    name: entry.name || entry.deviceName || entry.deviceProperties?.name,
    dnsName: entry.dnsName || entry.networkAddress,
    platform: entry.hardwareProperties?.platform || entry.platform,
    trusted: entry.connectionProperties?.isTrusted ?? entry.trusted ?? true,
    raw: entry,
  })).filter((entry) => entry.trusted !== false
    && (!entry.platform || /iphoneos|ios/i.test(String(entry.platform))));
}

function spawnSync(command, args, { spawnProcess }) {
  // The benchmark runner injects this adapter in tests. The production path
  // intentionally uses a synchronous child process so device discovery is a
  // gate before any app is launched.
  if (spawnProcess.sync) return spawnProcess.sync(command, args);
  return { status: 0, stdout: execFileSync(command, args, { encoding: "utf8" }), stderr: "" };
}
