// @ts-check

import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { createSessionLegacyProcessIdentity } from "../infrastructure/sessionLegacyProcessIdentity.js";
import { NodeAtomicFileStore } from "../infrastructure/nodeAtomicFileStore.js";

/** @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike */

const JOURNAL_VERSION = 1;
const JOURNAL_ROLE = "swift-sim-helper";
const JOURNAL_RELATIVE_PATH = Object.freeze(["runtime", "helper-process-identity.json"]);
const JOURNAL_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: true,
  syncDirectory: true,
});

/** @param {string} stateRoot */
export function phase4HelperProcessIdentityPath(stateRoot) {
  if (typeof stateRoot !== "string" || !stateRoot) {
    throw new TypeError("Phase-4 helper identity requires an explicit state root.");
  }
  return join(stateRoot, ...JOURNAL_RELATIVE_PATH);
}

/**
 * Persist the exact helper/service process identity before the long-running
 * helper starts serving. The record intentionally remains on disk after exit:
 * maintenance uses the recorded PID plus the exact Darwin process-start token
 * to distinguish a stopped helper from PID reuse.
 *
 * @param {{ stateRoot?: string, spawnSync: SpawnSyncLike, fileStore?: NodeAtomicFileStore }} options
 */
export function publishPhase4HelperProcessIdentity({
  stateRoot = join(homedir(), ".swift-sim"),
  spawnSync,
  fileStore = new NodeAtomicFileStore(),
}) {
  const identify = createSessionLegacyProcessIdentity({ spawnSync: /** @type {any} */ (spawnSync) });
  const identity = identify(process.pid);
  if (!identity?.startToken) {
    throw new Error("Swift Sim helper could not establish its exact Darwin process-start identity.");
  }
  const record = Object.freeze({
    version: JOURNAL_VERSION,
    role: JOURNAL_ROLE,
    pid: process.pid,
    startedAt: identity.startToken,
  });
  fileStore.writeJSONSync(phase4HelperProcessIdentityPath(stateRoot), record, JOURNAL_WRITE_OPTIONS);
  return record;
}

/**
 * Inspect the actual helper identity recorded by the helper entrypoint. A
 * matching journal whose PID no longer exists proves that exact helper is
 * quiesced. A live matching token means the helper is still running. A live
 * different token is PID reuse and fails closed. Missing/malformed/stale
 * journals never count as proof of quiescence.
 *
 * @param {{
 *   stateRoot: string,
 *   spawnSync: SpawnSyncLike,
 *   expectedIdentity: { pid: number, startedAt: string },
 * }} options
 */
export function inspectPhase4HelperProcessIdentity({ stateRoot, spawnSync, expectedIdentity }) {
  const expected = normalizeExpectedIdentity(expectedIdentity);
  const path = phase4HelperProcessIdentityPath(stateRoot);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (hasCode(error, "ENOENT")) {
      return frozenResult({
        state: "unrecorded",
        journalPresent: false,
        journalMatchesExpected: false,
        exactIdentityVerified: false,
        helperQuiesced: false,
        pid: expected.pid,
        startedAt: expected.startedAt,
        observedStartedAt: null,
      });
    }
    throw new Error("Phase-4 helper process identity journal is unreadable.", { cause: error });
  }
  const journal = normalizeJournal(parsed);
  const journalMatchesExpected =
    journal.pid === expected.pid && journal.startedAt === expected.startedAt;
  if (!journalMatchesExpected) {
    return frozenResult({
      state: "stale-journal",
      journalPresent: true,
      journalMatchesExpected: false,
      exactIdentityVerified: false,
      helperQuiesced: false,
      pid: journal.pid,
      startedAt: journal.startedAt,
      observedStartedAt: null,
    });
  }

  const identify = createSessionLegacyProcessIdentity({ spawnSync: /** @type {any} */ (spawnSync) });
  const observed = identify(journal.pid);
  if (observed === null) {
    return frozenResult({
      state: "absent",
      journalPresent: true,
      journalMatchesExpected: true,
      exactIdentityVerified: true,
      helperQuiesced: true,
      pid: journal.pid,
      startedAt: journal.startedAt,
      observedStartedAt: null,
    });
  }
  if (observed.startToken === journal.startedAt) {
    return frozenResult({
      state: "running",
      journalPresent: true,
      journalMatchesExpected: true,
      exactIdentityVerified: true,
      helperQuiesced: false,
      pid: journal.pid,
      startedAt: journal.startedAt,
      observedStartedAt: observed.startToken,
    });
  }
  return frozenResult({
    state: "pid-reused",
    journalPresent: true,
    journalMatchesExpected: true,
    exactIdentityVerified: false,
    helperQuiesced: false,
    pid: journal.pid,
    startedAt: journal.startedAt,
    observedStartedAt: observed.startToken,
  });
}

/** @param {unknown} value */
function normalizeExpectedIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 expected helper identity must be an object.");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  return Object.freeze({
    pid: requirePid(record.pid),
    startedAt: requireStartToken(record.startedAt),
  });
}

/** @param {unknown} value */
function normalizeJournal(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Phase-4 helper identity journal must contain an object.");
  }
  const record = /** @type {Record<string, unknown>} */ (value);
  if (record.version !== JOURNAL_VERSION || record.role !== JOURNAL_ROLE) {
    throw new Error("Phase-4 helper identity journal has an unsupported identity/role.");
  }
  return Object.freeze({
    pid: requirePid(record.pid),
    startedAt: requireStartToken(record.startedAt),
  });
}

/** @param {unknown} value */
function requirePid(value) {
  if (!Number.isSafeInteger(value) || Number(value) <= 1) {
    throw new Error("Phase-4 helper identity PID must be greater than one.");
  }
  return Number(value);
}

/** @param {unknown} value */
function requireStartToken(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Phase-4 helper identity requires an exact process-start token.");
  }
  return value.trim();
}

/** @param {Record<string, unknown>} value */
function frozenResult(value) {
  return Object.freeze({ ...value });
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
