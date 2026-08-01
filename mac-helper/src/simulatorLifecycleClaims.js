import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const CLAIM_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function writeSimulatorClaim(claim, options = {}) {
  const path = claimPath(claim, options);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const persisted = { ...claim };
    delete persisted.storeID;
    writeFileSync(temporary, JSON.stringify(persisted, null, 2), { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    try { rmSync(temporary, { force: true }); } catch {}
    throw error;
  }
}

export function updateSimulatorClaim(claim, patch, options = {}) {
  const current = readSimulatorClaim(claim.simulatorUDID, claim.claimID, options) || claim;
  writeSimulatorClaim({ ...current, ...patch }, options);
}

export function readSimulatorClaim(simulatorUDID, claimID, options = {}) {
  const path = join(claimDirectory(simulatorUDID, options), `${requiredClaimID(claimID)}.json`);
  try {
    const claim = JSON.parse(readFileSync(path, "utf8"));
    return validClaim(claim, simulatorUDID, claimID) ? claim : null;
  } catch {
    return null;
  }
}

export function listSimulatorClaims(simulatorUDID, options = {}) {
  const directory = claimDirectory(simulatorUDID, options);
  let names;
  try { names = readdirSync(directory); } catch { return []; }
  const now = Date.now();
  const claims = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const claim = readSimulatorClaim(simulatorUDID, name.slice(0, -5), options);
    if (!claim) continue;
    const updatedAt = Date.parse(claim.updatedAt || claim.createdAt || "");
    if (Number.isFinite(updatedAt) && now - updatedAt > CLAIM_MAX_AGE_MS) {
      removeSimulatorClaim(claim, options);
      continue;
    }
    claims.push(claim);
  }
  return claims;
}

export function removeSimulatorClaim(claim, options = {}) {
  try { rmSync(claimPath(claim, options), { force: true }); } catch {}
}

function claimRoot({ rootPath } = {}) {
  return rootPath
    || process.env.SWIFT_SIM_SIMULATOR_CLAIM_ROOT
    || join(homedir(), ".swift-sim", "simulator-runtime-claims");
}

function claimDirectory(simulatorUDID, options = {}) {
  return join(claimRoot(options), createHash("sha256").update(requiredUDID(simulatorUDID)).digest("hex"));
}

function claimPath(claim, options = {}) {
  return join(claimDirectory(claim.simulatorUDID, options), `${requiredClaimID(claim.claimID)}.json`);
}

function validClaim(claim, simulatorUDID, claimID) {
  return Boolean(claim && typeof claim === "object" && !Array.isArray(claim)
    && claim.simulatorUDID === requiredUDID(simulatorUDID)
    && claim.claimID === requiredClaimID(claimID)
    && typeof claim.sessionID === "string"
    && typeof claim.kind === "string");
}

function requiredUDID(value) {
  const result = String(value || "").trim();
  if (!result) throw new Error("A Simulator UDID is required.");
  return result;
}

function requiredClaimID(value) {
  const result = String(value || "").trim();
  if (!result || !/^[A-Za-z0-9._:-]+$/.test(result)) {
    throw new Error("A valid Simulator lifecycle claim id is required.");
  }
  return result;
}
