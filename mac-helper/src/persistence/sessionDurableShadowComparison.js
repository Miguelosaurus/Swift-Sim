// @ts-check

import { createHash } from "node:crypto";
import { parseDurableSession, projectDurableSession } from "./sessionBoundaryProjection.js";

/** @typedef {import("../contracts/durableSessionRepository.js").DurableSessionShadowComparisonResult} DurableSessionShadowComparisonResult */

/**
 * Compare a mixed legacy record with an optional SQLite durable record. The
 * legacy side is projected before hashing, so runtime-only mutations cannot
 * create a mismatch.
 *
 * @param {unknown | null} legacyValue
 * @param {unknown | null} sqliteValue
 * @returns {DurableSessionShadowComparisonResult}
 */
export function compareDurableSessionShadow(legacyValue, sqliteValue) {
  const legacy = legacyValue === null ? null : projectDurableSession(legacyValue);
  const sqlite = sqliteValue === null ? null : parseDurableSession(sqliteValue);
  const legacyProjectionHash = projectionHash(legacy);
  const sqliteProjectionHash = projectionHash(sqlite);
  if (legacyProjectionHash === sqliteProjectionHash) {
    return { matched: true, mismatch: null };
  }

  const key = legacy?.id || sqlite?.id || "missing-session";
  const keyHash = sha256(key);
  const mismatchID = sha256(
    JSON.stringify({ keyHash, legacyProjectionHash, sqliteProjectionHash }),
  );
  return {
    matched: false,
    mismatch: { mismatchID, keyHash, legacyProjectionHash, sqliteProjectionHash },
  };
}

/** @param {unknown | null} value */
function projectionHash(value) {
  return value === null ? null : sha256(JSON.stringify(value));
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
