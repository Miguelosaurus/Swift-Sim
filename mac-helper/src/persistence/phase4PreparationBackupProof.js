// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";

const SOURCES = Object.freeze([
  { key: "credential", fileName: "pairing.json", optional: false },
  { key: "invitations", fileName: "pairing-invites.json", optional: true },
  { key: "deviceBuilds", fileName: "device-builds.json", optional: false },
  { key: "sessions", fileName: "sessions.json", optional: true },
]);

/**
 * Every present source must have a byte-identical private backup. A genuinely
 * absent optional source has an explicit absence witness and no manufactured
 * empty file/backup. Re-read absence so absent -> present is stale evidence.
 * @param {{ stateRoot: string, domains: any, sourceHashes: Record<string, any> }} options
 */
export function verifyPhase4PreparationBackups({ stateRoot, domains, sourceHashes }) {
  const presence = normalizeSourcePresence(sourceHashes);
  const plans = backupPlans(domains, presence);
  const proofs = plans.map((plan) => {
    const expected = presence[plan.key];
    if (!expected) throw new Error(`Phase-4 ${plan.key} source identity is missing.`);
    const sourcePath = join(stateRoot, plan.fileName);
    if (expected.present === false) {
      assertAbsentSource(sourcePath, plan.key);
      return Object.freeze({
        role: plan.key,
        present: false,
        sourceSHA256: null,
        backupSHA256: null,
        byteLength: null,
        absenceVerified: true,
        equal: true,
      });
    }
    const backupPath = requireBackupPath(plan.backup, plan.key);
    assertPrivateFile(sourcePath, `Phase-4 ${plan.key} source`);
    assertPrivateFile(backupPath, `Phase-4 ${plan.key} backup`);
    const sourceBytes = readFileSync(sourcePath);
    const backupBytes = readFileSync(backupPath);
    const sourceDigest = sha256(sourceBytes);
    const backupDigest = sha256(backupBytes);
    if (sourceDigest !== expected.sha256 || sourceBytes.length !== expected.byteLength) {
      throw new Error(`Phase-4 ${plan.key} source changed after preflight.`);
    }
    if (!sourceBytes.equals(backupBytes) || backupDigest !== sourceDigest) {
      throw new Error(`Phase-4 ${plan.key} backup bytes do not match the exact source bytes.`);
    }
    return Object.freeze({
      role: plan.key,
      present: true,
      sourceSHA256: sourceDigest,
      backupSHA256: backupDigest,
      byteLength: sourceBytes.length,
      equal: true,
    });
  });
  return Object.freeze({
    verified: true,
    count: proofs.length,
    backupCount: plans.filter((plan) => plan.backup !== null).length,
    absenceCount: proofs.filter((proof) => proof.present === false).length,
    sourcePresence: presence,
    proofs: Object.freeze(proofs),
  });
}

/**
 * During rollback retry, current legacy files may already contain partial
 * CURRENT SQLite exports. Verify preserved backups and persisted absence facts
 * independently of those mutable files. Historical all-present evidence is
 * supported; optional absence is accepted only with an explicit persisted fact.
 * @param {{stateRoot: string, domains: any, sourcePresence?: unknown}} options
 */
export function verifyPhase4RollbackBackups({ stateRoot, domains, sourcePresence }) {
  const presence = sourcePresence === undefined ? null : normalizeSourcePresence(sourcePresence);
  const plans = backupPlans(domains, presence);
  const directory = realpathSync(join(stateRoot, "migration-backups", "phase4-cutover"));
  for (const plan of plans) {
    if (plan.backup === null) continue; // explicit optional absence from immutable evidence
    assertPrivateFile(plan.backup, "Phase-4 rollback backup");
    if (dirname(realpathSync(plan.backup)) !== directory) {
      throw new Error("Phase-4 rollback backup is outside the preparation directory.");
    }
    const digest = /\.([a-f0-9]{64})\.bak$/.exec(basename(plan.backup))?.[1];
    const bytes = readFileSync(plan.backup);
    if (!digest || sha256(bytes) !== digest) {
      throw new Error("Phase-4 rollback backup bytes do not match the evidence-bound digest.");
    }
    const expected = presence?.[plan.key];
    if (expected && (expected.sha256 !== digest || expected.byteLength !== bytes.length)) {
      throw new Error("Phase-4 rollback backup differs from persisted source identity.");
    }
    JSON.parse(bytes.toString("utf8"));
  }
  return Object.freeze({
    verified: true,
    count: plans.length,
    backupCount: plans.filter((plan) => plan.backup !== null).length,
    absenceCount: plans.filter((plan) => plan.backup === null).length,
  });
}

/** @param {unknown} value @returns {Readonly<Record<string, {present: boolean, fileName: string, byteLength: number | null, sha256: string | null}>>} */
function normalizeSourcePresence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 source presence evidence is missing or malformed.");
  }
  const values = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, {present: boolean, fileName: string, byteLength: number | null, sha256: string | null}>} */
  const normalized = {};
  for (const source of SOURCES) {
    const rawFact = values[source.key];
    if (!rawFact || typeof rawFact !== "object" || Array.isArray(rawFact)) {
      throw new Error(`Phase-4 ${source.key} source identity is missing.`);
    }
    const fact = /** @type {Record<string, unknown>} */ (rawFact);
    if (fact.fileName !== source.fileName) {
      throw new Error(`Phase-4 ${source.key} source identity is missing.`);
    }
    if (
      fact.present === false &&
      source.optional &&
      fact.byteLength === null &&
      fact.sha256 === null
    ) {
      normalized[source.key] = Object.freeze({
        present: false,
        fileName: source.fileName,
        byteLength: null,
        sha256: null,
      });
    } else if (
      fact.present === true &&
      typeof fact.byteLength === "number" &&
      Number.isSafeInteger(fact.byteLength) &&
      fact.byteLength >= 0 &&
      typeof fact.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(fact.sha256)
    ) {
      normalized[source.key] = Object.freeze({
        present: true,
        fileName: source.fileName,
        byteLength: fact.byteLength,
        sha256: fact.sha256,
      });
    } else {
      throw new Error(`Phase-4 ${source.key} source presence evidence is invalid.`);
    }
  }
  return Object.freeze(normalized);
}

/** @param {any} domains @param {Readonly<Record<string, {present: boolean}>> | null} presence */
function backupPlans(domains, presence) {
  const pairing = requireBackupArray(domains?.pairing?.backups, "pairing");
  const device = requireBackupArray(domains?.deviceBuild?.backups, "device-build");
  const sessions = requireBackupArray(domains?.sessions?.backups, "sessions");
  const invitationsPresent = presence?.invitations?.present !== false;
  const sessionsPresent = presence?.sessions?.present !== false;
  if (
    pairing.length !== 1 + Number(invitationsPresent) ||
    device.length !== 1 ||
    sessions.length !== Number(sessionsPresent)
  ) {
    throw new Error(
      "Phase-4 requires an exact backup for every present legacy source and no backup for witnessed absence.",
    );
  }
  const paths = {
    credential: requireBackupRole(pairing, "credential-"),
    invitations: invitationsPresent ? requireBackupRole(pairing, "invitations-") : null,
    deviceBuilds: requireBackupPath(device[0], "device-build"),
    sessions: sessionsPresent ? requireBackupPath(sessions[0], "sessions") : null,
  };
  return SOURCES.map((source) => ({
    ...source,
    backup: paths[/** @type {keyof typeof paths} */ (source.key)],
  }));
}

/** @param {unknown} value @param {string} label */
function requireBackupArray(value, label) {
  if (!Array.isArray(value) || !value.every((path) => typeof path === "string" && path)) {
    throw new Error(`Phase-4 ${label} backup paths are invalid.`);
  }
  return /** @type {string[]} */ ([...value]);
}

/** @param {string[]} paths @param {string} prefix */
function requireBackupRole(paths, prefix) {
  const matches = paths.filter((path) => basename(path).startsWith(prefix));
  if (matches.length !== 1)
    throw new Error(`Phase-4 backup role ${prefix} is missing or ambiguous.`);
  return requireBackupPath(matches[0], prefix);
}

/** @param {string | null | undefined} value @param {string} label */
function requireBackupPath(value, label) {
  if (typeof value !== "string" || !value)
    throw new Error(`Phase-4 ${label} backup path is missing.`);
  return value;
}

/** @param {string} path @param {string} key */
function assertAbsentSource(path, key) {
  try {
    lstatSync(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`Phase-4 ${key} source changed from absent to present after preflight.`);
}

/** @param {string} path @param {string} label */
function assertPrivateFile(path, label) {
  const entry = lstatSync(path);
  if (entry.isSymbolicLink() || !entry.isFile() || (statSync(path).mode & 0o077) !== 0) {
    throw new Error(`${label} is not a private regular file.`);
  }
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
