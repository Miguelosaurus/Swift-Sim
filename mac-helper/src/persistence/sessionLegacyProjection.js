// @ts-check
import { createHash } from "node:crypto";
import { normalizeSessionStateSnapshot } from "./sqliteSessionStateRepository.js";

export function parseSessionLegacyJSON(raw, sourcePath = "sessions.json") {
  let parsed;
  try { parsed = JSON.parse(raw); } catch (error) { throw new Error(`Invalid JSON in session legacy source ${sourcePath}.`, { cause: error }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !Array.isArray(parsed.sessions)) throw new Error(`Session legacy source must contain a sessions array: ${sourcePath}.`);
  return normalizeSessionStateSnapshot(parsed.sessions);
}

export function sessionProjectionHash(snapshot) {
  return createHash("sha256").update(JSON.stringify(normalizeSessionStateSnapshot(snapshot))).digest("hex");
}
