import "./lockOwnershipPreload.js";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const STATE_LOCK_WAIT_MS = 5_000;
const OWNERLESS_LOCK_GRACE_MS = 250;
const LEGACY_LOCK_MAX_AGE_MS = 30_000;
let currentProcessStartedAt;

export class DeviceDeliveryStateError extends Error {
  constructor(path, error) {
    super(
      `Swift Sim delivery state at ${path} could not be read safely: ${error instanceof Error ? error.message : String(error)}`,
    );
    this.code = "SWIFT_SIM_DELIVERY_STATE_INVALID";
  }
}

export function readDeliveryGenerationState(path, { allowMissing = true } = {}) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (allowMissing && error?.code === "ENOENT") return null;
    throw new DeviceDeliveryStateError(path, error);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
    validateDeliveryState(parsed);
  } catch (error) {
    throw new DeviceDeliveryStateError(path, error);
  }
  return parsed;
}

export function publishDeliveryGenerationState(path, state) {
  const generation = requiredGeneration(state?.generation);
  return mutateDeliveryGenerationState(path, generation, (current) => ({
    ...(current || {}),
    ...structuredClone(state),
    generation,
    references: generationReferences(current || state),
  }), { allowMissing: true });
}

export function addDeliveryGenerationReference(path, generation, referenceID) {
  const normalizedReference = String(referenceID || "").trim();
  if (!normalizedReference) {
    return readDeliveryGenerationState(path, { allowMissing: false });
  }
  return mutateDeliveryGenerationState(path, generation, (current) => {
    if (current.status !== "ready" || !current.publicBaseUrl) {
      throw new Error("The delivery generation is no longer reusable.");
    }
    const references = generationReferences(current);
    if (!references.includes(normalizedReference)) references.push(normalizedReference);
    return {
      ...current,
      references,
      updatedAt: new Date().toISOString(),
    };
  });
}

export function removeDeliveryGenerationReference(path, generation, referenceID) {
  const normalizedReference = String(referenceID || "").trim();
  return mutateDeliveryGenerationState(path, generation, (current) => ({
    ...current,
    references: normalizedReference
      ? generationReferences(current).filter((value) => value !== normalizedReference)
      : generationReferences(current),
    updatedAt: new Date().toISOString(),
  }));
}

export function mutateDeliveryGenerationState(path, generation, updater, {
  allowMissing = false,
} = {}) {
  const expectedGeneration = requiredGeneration(generation);
  return withDeliveryStateLock(path, () => {
    const current = readDeliveryGenerationState(path, { allowMissing });
    if (!current && !allowMissing) {
      throw new DeviceDeliveryStateError(path, new Error("the delivery generation is missing"));
    }
    if (current && current.generation !== expectedGeneration) {
      throw new DeviceDeliveryStateError(path, new Error("the delivery generation identity changed"));
    }
    const next = updater(current ? structuredClone(current) : null);
    validateDeliveryState(next);
    if (next.generation !== expectedGeneration) {
      throw new DeviceDeliveryStateError(path, new Error("the delivery generation identity was changed"));
    }
    writeDeliveryStateUnlocked(path, next);
    return structuredClone(next);
  });
}

export function generationReferences(state) {
  return [...new Set((Array.isArray(state?.references) ? state.references : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function validateDeliveryState(value) {
  if (!isPlainObject(value)) throw new Error("the delivery record is not an object");
  requiredGeneration(value.generation);
  requireString(value, "status", { nonempty: true });
  for (const field of [
    "provider",
    "publicBaseUrl",
    "createdAt",
    "expiresAt",
    "localBaseUrl",
    "error",
    "updatedAt",
    "stoppedAt",
  ]) {
    requireString(value, field, { optional: true });
  }
  if (value.references !== undefined
      && (!Array.isArray(value.references)
        || !value.references.every((reference) => typeof reference === "string"))) {
    throw new Error("the delivery record has invalid references");
  }
  for (const field of ["managerIdentity", "gatewayIdentity", "tunnelIdentity"]) {
    if (value[field] !== undefined && value[field] !== null) validateProcessIdentity(value[field], field);
  }
  for (const field of ["managerPid", "gatewayPid", "tunnelPid"]) {
    const pid = value[field];
    if (pid !== undefined && pid !== null && (!Number.isInteger(pid) || pid <= 0)) {
      throw new Error(`the delivery record has an invalid ${field}`);
    }
  }
}

function validateProcessIdentity(value, field) {
  if (!isPlainObject(value)) throw new Error(`the delivery record has an invalid ${field}`);
  if (!Number.isInteger(value.pid) || value.pid <= 0) {
    throw new Error(`the delivery record has an invalid ${field} pid`);
  }
  if (typeof value.startedAt !== "string" || !value.startedAt) {
    throw new Error(`the delivery record has an invalid ${field} start identity`);
  }
  if (!Array.isArray(value.commandFragments)
      || !value.commandFragments.every((fragment) => typeof fragment === "string" && fragment.length > 0)) {
    throw new Error(`the delivery record has invalid ${field} command fragments`);
  }
}

function requireString(value, field, { optional = false, nonempty = false } = {}) {
  const candidate = value[field];
  if (candidate === undefined && optional) return;
  if (typeof candidate !== "string" || (nonempty && candidate.length === 0)) {
    throw new Error(`the delivery record has an invalid ${field}`);
  }
}

function requiredGeneration(value) {
  const generation = String(value || "").trim();
  if (!generation) throw new Error("A delivery generation is required.");
  return generation;
}

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function withDeliveryStateLock(path, operation) {
  const lockPath = `${path}.state.lock`;
  const ownerPath = join(lockPath, "owner.json");
  const owner = {
    pid: process.pid,
    startedAt: processStartIdentity(),
    nonce: randomUUID(),
    createdAt: new Date().toISOString(),
  };
  const deadline = Date.now() + STATE_LOCK_WAIT_MS;

  while (true) {
    let created = false;
    try {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
      mkdirSync(lockPath, { mode: 0o700 });
      created = true;
      writeFileSync(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: "wx" });
      break;
    } catch (error) {
      if (created) {
        rmSync(lockPath, { recursive: true, force: true });
        throw error;
      }
      if (error?.code !== "EEXIST") throw error;
      let current;
      try { current = JSON.parse(readFileSync(ownerPath, "utf8")); } catch {}
      if ((current && !lockOwnerIsAlive(current))
          || (!current && ownerlessLockIsStale(lockPath))) {
        rmSync(lockPath, { recursive: true, force: true });
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error("Timed out waiting for the Swift Sim delivery-state lock.");
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }

  try {
    return operation();
  } finally {
    try {
      const current = JSON.parse(readFileSync(ownerPath, "utf8"));
      if (current.pid === owner.pid && current.nonce === owner.nonce) {
        rmSync(lockPath, { recursive: true, force: true });
      }
    } catch {}
  }
}

function writeDeliveryStateUnlocked(path, state) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2), {
      mode: 0o600,
      flag: "wx",
    });
    renameSync(temporaryPath, path);
  } catch (error) {
    try { rmSync(temporaryPath, { force: true }); } catch {}
    throw error;
  }
}

function lockOwnerIsAlive(owner) {
  if (!processIsAlive(owner?.pid)) return false;
  if (!owner?.startedAt) {
    const createdAt = Date.parse(owner?.createdAt || "");
    return Number.isFinite(createdAt) && Date.now() - createdAt < LEGACY_LOCK_MAX_AGE_MS;
  }
  return processStartedAt(owner.pid) === owner.startedAt;
}

function processStartIdentity() {
  currentProcessStartedAt ||= requiredProcessStartedAt(process.pid);
  return currentProcessStartedAt;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish a process start identity for the Swift Sim delivery-state lock.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
}

function ownerlessLockIsStale(path) {
  try {
    return Date.now() - statSync(path).mtimeMs >= OWNERLESS_LOCK_GRACE_MS;
  } catch {
    return false;
  }
}
