// @ts-check

/** @typedef {import("../contracts/durableSession.js").DurableSessionRecord} DurableSessionRecord */
/** @typedef {import("../contracts/session.js").SessionRecord} SessionRecord */
/** @typedef {import("../contracts/session.js").SessionBuildRecord} SessionBuildRecord */
/** @typedef {import("../contracts/session.js").SessionStreamRecord} SessionStreamRecord */

const DURABLE_FIELDS = Object.freeze(["id", "token", "project", "scheme", "simulatorUDID", "createdAt"]);

/** @param {unknown} value @returns {DurableSessionRecord} */
export function projectDurableSession(value) {
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

/** @param {unknown} value @returns {DurableSessionRecord} */
export function parseDurableSession(value) {
  const record = sessionLikeRecord(value);
  const keys = Object.keys(record).sort();
  const expected = [...DURABLE_FIELDS].sort();
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error("Durable session record contains fields outside the frozen boundary.");
  }
  return projectDurableSession(record);
}

/** @param {DurableSessionRecord} durableValue @param {unknown} runtimeValue @returns {Readonly<SessionRecord & { orientation?: string }>} */
export function joinSessionForPresentation(durableValue, runtimeValue) {
  const durable = parseDurableSession(durableValue);
  const runtime = sessionLikeRecord(runtimeValue);
  const build = presentationBuild(runtime.build);
  const stream = presentationStream(runtime.stream);
  const logs = Array.isArray(runtime.logs) ? runtime.logs.map(String) : [];
  const orientation = runtime.orientation === undefined ? undefined : optionalString(runtime.orientation, "session orientation");
  return deepFreeze({
    ...durable,
    updatedAt: optionalString(runtime.updatedAt, "session updatedAt"),
    revision: optionalRevision(runtime.revision),
    remoteBaseUrl: optionalString(runtime.remoteBaseUrl, "session remoteBaseUrl"),
    build,
    stream,
    logs,
    ...(orientation === undefined ? {} : { orientation }),
  });
}

export function durableSessionFieldNames() {
  return [...DURABLE_FIELDS];
}

/** @param {unknown} value @returns {SessionBuildRecord} */
function presentationBuild(value) {
  if (!isRecord(value)) return { state: "external-or-not-run" };
  const record = structuredClone(value);
  if (typeof record.state !== "string") throw new Error("Session presentation build state must be a string.");
  return /** @type {SessionBuildRecord} */ (record);
}

/** @param {unknown} value @returns {SessionStreamRecord} */
function presentationStream(value) {
  if (!isRecord(value)) return { state: "stopped", transport: "serve-sim", raw: {}, limitations: [] };
  const record = structuredClone(value);
  if (!["starting", "running", "stopped", "failed"].includes(String(record.state || ""))) {
    throw new Error("Session presentation stream state is invalid.");
  }
  return /** @type {SessionStreamRecord} */ (/** @type {unknown} */ (record));
}

/** @param {unknown} value @returns {Record<string, unknown>} */
function sessionLikeRecord(value) {
  if (!isRecord(value)) throw new Error("Session boundary value must be an object.");
  return value;
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @param {string} label @returns {string} */
function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

/** @param {unknown} value @param {string} label @returns {string} */
function optionalString(value, label) {
  if (value === undefined) return "";
  if (typeof value !== "string") throw new Error(`${label} must be a string when present.`);
  return value;
}

/** @param {unknown} value @returns {number} */
function optionalRevision(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("session revision must be a non-negative safe integer when present.");
  return Number(value);
}

/** @template T @param {T} value @returns {Readonly<T>} */
function deepFreeze(value) {
  if (isRecord(value) || Array.isArray(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return /** @type {Readonly<T>} */ (value);
}
