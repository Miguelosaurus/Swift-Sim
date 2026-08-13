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

export function parseDurableSession(value) {
  const record = sessionLikeRecord(value);
  const keys = Object.keys(record).sort();
  const expected = [...DURABLE_FIELDS].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error("Durable session record contains fields outside the frozen boundary.");
  }
  return projectDurableSession(record);
}

export function joinSessionForPresentation(durableValue, runtimeValue) {
  const durable = parseDurableSession(durableValue);
  const runtime = sessionLikeRecord(runtimeValue);
  const build = normalizePresentationBuild(runtime.build);
  const stream = normalizePresentationStream(runtime.stream);
  const logs = Array.isArray(runtime.logs)
    ? runtime.logs.map((line) => String(line))
    : [];
  const remoteBaseUrl = optionalString(runtime.remoteBaseUrl, "session remoteBaseUrl");
  const updatedAt = optionalString(runtime.updatedAt, "session updatedAt");
  const revision = optionalRevision(runtime.revision);
  const orientation =
    runtime.orientation === undefined
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

function normalizePresentationBuild(value) {
  if (!plainObject(value)) return { state: "external-or-not-run" };
  const record = /** @type {Record<string, unknown>} */ (
    structuredClone(value)
  );
  if (typeof record.state !== "string") {
    throw new Error("Session presentation build state must be a string.");
  }
  return /** @type {SessionBuildRecord} */ (record);
}

function normalizePresentationStream(value) {
  if (!plainObject(value)) {
    return {
      state: "stopped",
      transport: "serve-sim",
      raw: {},
      limitations: [],
    };
  }
  const record = /** @type {Record<string, unknown>} */ (
    structuredClone(value)
  );
  if (
    !["starting", "running", "stopped", "failed"].includes(
      String(record.state || ""),
    )
  ) {
    throw new Error("Session presentation stream state is invalid.");
  }
  const validated = /** @type {unknown} */ (record);
  return /** @type {SessionStreamRecord} */ (validated);
}

function sessionLikeRecord(value) {
  if (!plainObject(value)) {
    throw new Error("Session boundary value must be an object.");
  }
  return /** @type {Record<string, unknown>} */ (value);
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requiredNonEmptyString(value, label) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value, label) {
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string when present.`);
  }
  return value;
}

function optionalRevision(value) {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("session revision must be a non-negative safe integer when present.");
  }
  return Number(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    const record = /** @type {Record<string, unknown>} */ (value);
    for (const nested of Object.values(record)) {
      deepFreeze(nested);
    }
    Object.freeze(value);
  }
  return value;
}
