// @ts-check

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */
/** @typedef {import("../contracts/session.js").SessionRecord} SessionRecord */
/** @typedef {import("../contracts/session.js").SessionBuildRecord} SessionBuildRecord */
/** @typedef {import("../contracts/session.js").SessionStreamRecord} SessionStreamRecord */

const DURABLE_FIELDS = Object.freeze([
  "id",
  "token",
  "project",
  "scheme",
  "simulatorUDID",
  "createdAt",
]);

/**
 * Extract the only fields currently approved for transactional session-domain
 * persistence. Everything else in the legacy SessionRecord is deliberately
 * ignored here so a future repository cannot persist process/runtime ownership
 * merely because the legacy JSON object contained it.
 *
 * @param {unknown} value
 * @returns {DurableSessionRecord}
 */
export function projectDurableSession(value) {
  const record = sessionLikeRecord(value);
  return normalizeDurableSession({
    id: requiredNonEmptyString(record.id, "session id"),
    token: requiredNonEmptyString(record.token, "session token"),
    project: optionalString(record.project, "session project"),
    scheme: optionalString(record.scheme, "session scheme"),
    simulatorUDID: optionalString(record.simulatorUDID, "session simulatorUDID"),
    createdAt: optionalString(record.createdAt, "session createdAt"),
  });
}

/**
 * Parse a future durable repository value. Unknown keys are rejected rather
 * than discarded so transient stream/process fields and unresolved legacy
 * aggregate metadata can never silently enter durable storage.
 *
 * @param {unknown} value
 * @returns {DurableSessionRecord}
 */
export function parseDurableSession(value) {
  const record = sessionLikeRecord(value);
  const keys = Object.keys(record).sort();
  const expected = [...DURABLE_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Durable session record contains fields outside the frozen boundary.");
  }
  return projectDurableSession(record);
}

/**
 * Build a detached read-only compatibility view for current consumers.
 * Durable fields come only from the durable source. Legacy runtime/presentation
 * fields come only from the current runtime source. No field has two writers.
 *
 * This is a projection seam, not a persistence object: the return value is
 * recursively frozen. `updatedAt`, `revision`, and `build` remain supplied by
 * legacy/runtime compatibility until their authority is explicitly resolved.
 *
 * @param {DurableSessionRecord} durableValue
 * @param {unknown} runtimeValue
 * @returns {Readonly<SessionRecord & { orientation?: string }>}
 */
export function joinSessionForPresentation(durableValue, runtimeValue) {
  const durable = parseDurableSession(durableValue);
  const runtime = sessionLikeRecord(runtimeValue);
  const build = normalizePresentationBuild(runtime.build);
  const stream = normalizePresentationStream(runtime.stream);
  const logs = Array.isArray(runtime.logs) ? runtime.logs.map((line) => String(line)) : [];
  const remoteBaseUrl = optionalString(runtime.remoteBaseUrl, "session remoteBaseUrl");
  const updatedAt = optionalString(runtime.updatedAt, "session updatedAt");
  const revision = optionalRevision(runtime.revision);
  const orientation = runtime.orientation === undefined
    ? undefined
    : optionalString(runtime.orientation, "session orientation");

  return deepFreeze({
    ...durable,
    updatedAt,
    revision,
    remoteBaseUrl,
    build,
    stream,
    logs,
    ...(orientation === undefined ? {} : { orientation }),
  });
}

export function durableSessionFieldNames() {
  return [...DURABLE_FIELDS];
}

/** @param {unknown} value @returns {DurableSessionRecord} */
function normalizeDurableSession(value) {
  const record = sessionLikeRecord(value);
  return {
    id: requiredNonEmptyString(record.id, "session id"),
    token: requiredNonEmptyString(record.token, "session token"),
    project: optionalString(record.project, "session project"),
    scheme: optionalString(record.scheme, "session scheme"),
    simulatorUDID: optionalString(record.simulatorUDID, "session simulatorUDID"),
    createdAt: optionalString(record.createdAt, "session createdAt"),
  };
}

/** @param {unknown} value @returns {SessionBuildRecord} */
function normalizePresentationBuild(value) {
  if (!plainObject(value)) return { state: "external-or-not-run" };
  const record = /** @type {Record<string, unknown>} */ (structuredClone(value));
  if (typeof record.state !== "string") {
    throw new Error("Session presentation build state must be a string.");
  }
  return /** @type {SessionBuildRecord} */ (record);
}

/** @param {unknown} value @returns {SessionStreamRecord} */
function normalizePresentationStream(value) {
  if (!plainObject(value)) {
    return { state: "stopped", transport: "serve-sim", raw: {}, limitations: [] };
  }
  const record = /** @type {Record<string, unknown>} */ (structuredClone(value));
  if (!["starting", "running", "stopped", "failed"].includes(String(record.state || ""))) {
    throw new Error("Session presentation stream state is invalid.");
  }
  return /** @type {SessionStreamRecord} */ (record);
}

/** @param {unknown} value */
function sessionLikeRecord(value) {
  if (!plainObject(value)) throw new Error("Session boundary value must be an object.");
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value */
function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {string} label */
function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

/** @param {unknown} value @param {string} label */
function optionalString(value, label) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} must be a string when present.`);
  return value;
}

/** @param {unknown} value */
function optionalRevision(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("session revision must be a non-negative safe integer when present.");
  }
  return Number(value);
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(/** @type {Record<string, unknown>} */ (value))) deepFreeze(nested);
    Object.freeze(value);
  }
  return /** @type {Readonly<T>} */ (value);
}
