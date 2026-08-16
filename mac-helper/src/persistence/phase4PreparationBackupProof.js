// @ts-check

import { createHash } from "node:crypto";
import { lstatSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

/**
 * Prove the four exact legacy backups emitted by the locked snapshot readers.
 * Each source is re-read as bytes, compared with its preflight cryptographic
 * identity, and compared byte-for-byte with the exact backup path returned by
 * the reader that parsed/applied those same bytes.
 *
 * @param {{ stateRoot: string, domains: any, sourceHashes: Record<string, any> }} options
 */
export function verifyPhase4PreparationBackups({
  stateRoot,
  domains,
  sourceHashes,
}) {
  const pairingBackups = requireBackupArray(
    domains?.pairing?.backups,
    "pairing",
  );
  const deviceBackups = requireBackupArray(
    domains?.deviceBuild?.backups,
    "device-build",
  );
  const sessionBackups = requireBackupArray(
    domains?.sessions?.backups,
    "sessions",
  );
  if (
    pairingBackups.length !== 2 ||
    deviceBackups.length !== 1 ||
    sessionBackups.length !== 1
  ) {
    throw new Error(
      "Phase-4 preparation requires exactly four legacy backup files.",
    );
  }

  const plans = [
    {
      key: "credential",
      sourceName: "pairing.json",
      backup: requireBackupRole(pairingBackups, "credential-"),
    },
    {
      key: "invitations",
      sourceName: "pairing-invites.json",
      backup: requireBackupRole(pairingBackups, "invitations-"),
    },
    {
      key: "deviceBuilds",
      sourceName: "device-builds.json",
      backup: deviceBackups[0],
    },
    {
      key: "sessions",
      sourceName: "sessions.json",
      backup: sessionBackups[0],
    },
  ];

  const proofs = plans.map((plan) => {
    const expected = sourceHashes?.[plan.key];
    if (!expected?.present || typeof expected.sha256 !== "string") {
      throw new Error(
        `Phase-4 ${plan.key} preflight source identity is missing.`,
      );
    }
    if (typeof plan.backup !== "string" || !plan.backup) {
      throw new Error(`Phase-4 ${plan.key} backup path is missing.`);
    }
    const sourceBytes = readFileSync(join(stateRoot, plan.sourceName));
    const backupBytes = readFileSync(plan.backup);
    assertPrivateFile(plan.backup, `Phase-4 ${plan.key} backup`);
    const sourceDigest = sha256(sourceBytes);
    const backupDigest = sha256(backupBytes);
    if (
      sourceDigest !== expected.sha256 ||
      sourceBytes.length !== expected.byteLength
    ) {
      throw new Error(`Phase-4 ${plan.key} source changed after preflight.`);
    }
    if (!sourceBytes.equals(backupBytes) || backupDigest !== sourceDigest) {
      throw new Error(
        `Phase-4 ${plan.key} backup bytes do not match the exact source bytes.`,
      );
    }
    return Object.freeze({
      role: plan.key,
      sourceSHA256: sourceDigest,
      backupSHA256: backupDigest,
      byteLength: sourceBytes.length,
      equal: true,
    });
  });

  return Object.freeze({
    verified: true,
    count: proofs.length,
    proofs: Object.freeze(proofs),
  });
}

/** @param {unknown} value @param {string} label */
function requireBackupArray(value, label) {
  if (
    !Array.isArray(value) ||
    !value.every((path) => typeof path === "string" && path)
  ) {
    throw new Error(`Phase-4 ${label} backup paths are invalid.`);
  }
  return /** @type {string[]} */ ([...value]);
}

/** @param {string[]} paths @param {string} prefix */
function requireBackupRole(paths, prefix) {
  const matches = paths.filter((path) => basename(path).startsWith(prefix));
  if (matches.length !== 1) {
    throw new Error(`Phase-4 backup role ${prefix} is missing or ambiguous.`);
  }
  const match = matches[0];
  if (!match) throw new Error(`Phase-4 backup role ${prefix} is missing.`);
  return match;
}

/** @param {string} path @param {string} label */
function assertPrivateFile(path, label) {
  const entry = lstatSync(path);
  if (
    entry.isSymbolicLink() ||
    !entry.isFile() ||
    (statSync(path).mode & 0o077) !== 0
  ) {
    throw new Error(`${label} is not a private regular file.`);
  }
}

/** @param {Buffer} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
