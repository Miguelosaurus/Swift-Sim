import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_VERIFICATION_INTERVAL_MS = 15_000;

export function claimDeviceVerification(build, {
  now = Date.now(),
  minimumIntervalMs = DEFAULT_VERIFICATION_INTERVAL_MS,
  path = defaultGatePath(build),
} = {}) {
  if (!path) return false;
  const interval = Math.max(1_000, Number(minimumIntervalMs) || DEFAULT_VERIFICATION_INTERVAL_MS);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = readMarker(path);
    const lastAttemptAt = Date.parse(current?.lastAttemptAt || "");
    if (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < interval) return false;

    if (!current) {
      try {
        writeMarker(path, build, now);
        return true;
      } catch (error) {
        if (error?.code === "EEXIST") continue;
        throw error;
      }
    }

    const stalePath = `${path}.${process.pid}.${randomUUID()}.stale`;
    try {
      renameSync(path, stalePath);
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    try {
      try {
        writeMarker(path, build, now);
        return true;
      } catch (error) {
        if (error?.code === "EEXIST") return false;
        throw error;
      }
    } finally {
      rmSync(stalePath, { force: true });
    }
  }
  return false;
}

function defaultGatePath(build) {
  const id = String(build?.id || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!id) return "";
  return join(homedir(), ".swift-sim", "verification-gates", `${id}.json`);
}

function readMarker(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    return { lastAttemptAt: "" };
  }
}

function writeMarker(path, build, now) {
  let descriptor;
  try {
    descriptor = openSync(path, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({
      buildId: String(build?.id || ""),
      lastAttemptAt: new Date(now).toISOString(),
    }), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    if (error?.code !== "EEXIST") rmSync(path, { force: true });
    throw error;
  }
}
