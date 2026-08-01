import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_VERIFICATION_INTERVAL_MS = 15_000;
const STALE_CLAIM_MS = 30_000;

export function claimDeviceVerification(build, {
  now = Date.now(),
  minimumIntervalMs = DEFAULT_VERIFICATION_INTERVAL_MS,
  path = defaultGatePath(build),
} = {}) {
  if (!path) return false;
  const interval = Math.max(1_000, Number(minimumIntervalMs) || DEFAULT_VERIFICATION_INTERVAL_MS);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const release = tryAcquireClaim(`${path}.lock`, now);
  if (!release) return false;
  try {
    const current = readMarker(path);
    const lastAttemptAt = Date.parse(current?.lastAttemptAt || "");
    if (Number.isFinite(lastAttemptAt) && now - lastAttemptAt < interval) return false;
    writeMarkerAtomically(path, build, now);
    return true;
  } finally {
    release();
  }
}

function defaultGatePath(build) {
  const id = String(build?.id || "").replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!id) return "";
  return join(homedir(), ".swift-sim", "verification-gates", `${id}.json`);
}

function tryAcquireClaim(lockPath, now) {
  const ownerPath = join(lockPath, "owner.json");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const owner = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: randomUUID(),
      createdAt: new Date(now).toISOString(),
    };
    try {
      mkdirSync(lockPath, { mode: 0o700 });
      writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
      return () => {
        const current = readMarker(ownerPath);
        if (Number(current?.pid) === owner.pid && current?.nonce === owner.nonce) {
          rmSync(lockPath, { recursive: true, force: true });
        }
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        try { rmSync(lockPath, { recursive: true, force: true }); } catch {}
        throw error;
      }
      const existing = readMarker(ownerPath);
      if (!claimIsStale(existing, now, lockPath)) return null;
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
  return null;
}

function claimIsStale(owner, now, lockPath) {
  const pid = Number(owner?.pid);
  if (Number.isInteger(pid) && pid > 0 && processIsAlive(pid)) {
    if (!owner?.startedAt) return false;
    const observed = processStartedAt(pid);
    if (!observed || observed === owner.startedAt) return false;
  }
  const createdAt = Date.parse(owner?.createdAt || "");
  if (Number.isFinite(createdAt)) return now - createdAt >= STALE_CLAIM_MS;
  try {
    return now - statSync(lockPath).mtimeMs >= STALE_CLAIM_MS;
  } catch {
    return false;
  }
}

function readMarker(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function writeMarkerAtomically(path, build, now) {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify({
      buildId: String(build?.id || ""),
      lastAttemptAt: new Date(now).toISOString(),
    }), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
    rmSync(temporary, { force: true });
    throw error;
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}
