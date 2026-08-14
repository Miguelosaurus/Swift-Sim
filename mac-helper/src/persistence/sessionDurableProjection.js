// @ts-check

import { createHash } from "node:crypto";
import { projectDurableSession } from "./sessionBoundaryProjection.js";
import { normalizeDurableSessions } from "./sqliteDurableSessionRepository.js";

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */

/**
 * Parse the legacy session aggregate without constructing SessionStore. Runtime
 * fields are accepted only as legacy input and are discarded immediately by
 * the frozen durable projection.
 *
 * @param {string} raw
 * @param {string} [sourcePath]
 * @returns {DurableSessionRecord[]}
 */
export function parseLegacyDurableSessions(raw, sourcePath = "sessions.json") {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid JSON in session legacy source ${sourcePath}.`, { cause: error });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Session legacy source must contain an object: ${sourcePath}.`);
  }
  const sessions = /** @type {Record<string, unknown>} */ (parsed).sessions;
  if (!Array.isArray(sessions)) {
    throw new Error(`Session legacy source must contain a sessions array: ${sourcePath}.`);
  }
  return normalizeDurableSessions(sessions.map((record) => projectDurableSession(record)));
}

/** @param {readonly unknown[]} records */
export function durableSessionProjectionHash(records) {
  return sha256(JSON.stringify(normalizeDurableSessions(records)));
}

/** @param {string} value */
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
