// @ts-check

const DEVICE_BUILD_STATES = new Set([
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
  "ready",
  "failed",
]);
const INSTALLATION_STATES = new Set([
  "unknown",
  "requested",
  "not-installed",
  "different-version",
  "verified",
]);

/**
 * Source-loadable runtime predicate for the canonical DeviceBuildRecord shape.
 * The typed `build.ts` contract delegates to this function so raw-source and
 * emitted runtimes validate the same record rather than maintaining separate
 * persistence validators.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isDeviceBuildRecordRuntime(value) {
  if (!isRecord(value)) return false;
  if (
    !hasNonEmptyString(value, "id") ||
    !hasNonEmptyString(value, "token") ||
    !hasString(value, "tokenExpiredAt") ||
    !isNonNegativeInteger(value.revision) ||
    !hasString(value, "remoteBaseUrl") ||
    !isDelivery(value.delivery) ||
    !hasString(value, "project") ||
    !hasString(value, "workspace") ||
    !hasString(value, "scheme") ||
    !hasString(value, "configuration") ||
    !hasString(value, "exportMethod") ||
    typeof value.preserveData !== "boolean" ||
    !hasString(value, "createdAt") ||
    !hasString(value, "updatedAt") ||
    !isTTL(value.installTTLMinutes) ||
    !isTTL(value.ttlMinutes) ||
    value.ttlMinutes !== value.installTTLMinutes ||
    !hasString(value, "expiresAt") ||
    !DEVICE_BUILD_STATES.has(value.state) ||
    !isApp(value.app) ||
    !isSigning(value.signing) ||
    !isInstallation(value.installation) ||
    !isArtifacts(value.artifacts) ||
    !Array.isArray(value.logs) ||
    !value.logs.every((line) => typeof line === "string") ||
    !optionalStringArray(value, "buildSettings") ||
    !optionalBoolean(value, "allowProvisioningUpdates") ||
    !optionalRecord(value, "control", isControl) ||
    !optionalRecord(value, "rebuild", isRebuild) ||
    !optionalRecord(value, "liveReload", isLiveReload) ||
    !optionalRecord(value, "pendingRenewal", isPendingRenewal)
  ) {
    return false;
  }
  return (
    !hasOwn(value, "capabilities") ||
    (Array.isArray(value.capabilities) && value.capabilities.every(isCapability))
  );
}

/** @param {unknown} value */
function isDelivery(value) {
  return (
    isRecord(value) &&
    (value.mode === "custom" || value.mode === "quick-tunnel") &&
    (value.provider === "user-configured" || value.provider === "cloudflare-quick-tunnel") &&
    hasString(value, "expiresAt") &&
    optionalString(value, "generation") &&
    optionalString(value, "referenceID")
  );
}

/** @param {unknown} value */
function isApp(value) {
  return (
    isRecord(value) &&
    hasString(value, "identity") &&
    hasString(value, "name") &&
    hasString(value, "bundleIdentifier") &&
    hasString(value, "version") &&
    hasString(value, "build") &&
    hasString(value, "teamID")
  );
}

/** @param {unknown} value */
function isSigning(value) {
  return (
    isRecord(value) &&
    hasString(value, "style") &&
    hasString(value, "method") &&
    typeof value.deviceInstallable === "boolean" &&
    hasString(value, "updateSafe") &&
    Array.isArray(value.warnings) &&
    value.warnings.every((warning) => typeof warning === "string")
  );
}

/** @param {unknown} value */
function isInstallation(value) {
  return (
    isRecord(value) &&
    INSTALLATION_STATES.has(value.state) &&
    hasString(value, "requestedAt") &&
    hasString(value, "verifiedAt") &&
    hasString(value, "updatedAt") &&
    hasString(value, "verificationDeadlineAt") &&
    Array.isArray(value.devices) &&
    value.devices.every(isInstallationDevice)
  );
}

/** @param {unknown} value */
function isInstallationDevice(value) {
  return (
    isRecord(value) &&
    hasString(value, "name") &&
    hasString(value, "state") &&
    hasString(value, "version") &&
    hasString(value, "build")
  );
}

/** @param {unknown} value */
function isArtifacts(value) {
  return (
    isRecord(value) &&
    hasString(value, "root") &&
    hasString(value, "archivePath") &&
    hasString(value, "exportPath") &&
    hasString(value, "ipaPath") &&
    hasString(value, "manifestPath") &&
    optionalString(value, "resultBundlePath")
  );
}

/** @param {unknown} value */
function isCapability(value) {
  return (
    isRecord(value) &&
    hasNonEmptyString(value, "token") &&
    hasString(value, "expiresAt") &&
    hasString(value, "remoteBaseUrl") &&
    (value.delivery === null || isDelivery(value.delivery)) &&
    isTTL(value.installTTLMinutes) &&
    hasString(value, "createdAt")
  );
}

/** @param {unknown} value */
function isPendingRenewal(value) {
  if (!isRecord(value)) return false;
  return (
    optionalString(value, "id") &&
    hasNonEmptyString(value, "token") &&
    hasString(value, "createdAt") &&
    optionalString(value, "deadlineAt") &&
    isPendingRenewalPrevious(value.previous) &&
    (!hasOwn(value, "target") || isPendingRenewalTarget(value.target))
  );
}

/** @param {unknown} value */
function isPendingRenewalPrevious(value) {
  return (
    isRecord(value) &&
    hasString(value, "expiresAt") &&
    hasString(value, "remoteBaseUrl") &&
    (value.delivery === null || isDelivery(value.delivery)) &&
    (!hasOwn(value, "installTTLMinutes") || isTTL(value.installTTLMinutes))
  );
}

/** @param {unknown} value */
function isPendingRenewalTarget(value) {
  return (
    isRecord(value) &&
    isTTL(value.ttlMinutes) &&
    hasString(value, "remoteBaseUrl") &&
    (value.deliveryMode === "custom" || value.deliveryMode === "quick-tunnel")
  );
}

/** @param {unknown} value */
function isControl(value) {
  return isRecord(value) && hasString(value, "cancelPath");
}

/** @param {unknown} value */
function isRebuild(value) {
  return (
    isRecord(value) &&
    hasString(value, "appID") &&
    hasString(value, "sourceBuildID") &&
    hasString(value, "idempotencyKey") &&
    hasString(value, "expectedBundleIdentifier") &&
    hasString(value, "expectedTeamID")
  );
}

/** @param {unknown} value */
function isLiveReload(value) {
  return (
    isRecord(value) &&
    optionalBoolean(value, "eligible") &&
    optionalBoolean(value, "engineReady") &&
    optionalBoolean(value, "compilerReady") &&
    optionalString(value, "error") &&
    optionalString(value, "host") &&
    optionalFiniteNumber(value, "capturedCompilations") &&
    (!hasOwn(value, "capturedCompilations") || isNonNegativeInteger(value.capturedCompilations))
  );
}

/** @param {unknown} value */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** @param {Record<string, unknown>} record @param {string} key */
function hasOwn(record, key) {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/** @param {Record<string, unknown>} record @param {string} key */
function hasString(record, key) {
  return hasOwn(record, key) && typeof record[key] === "string";
}

/** @param {Record<string, unknown>} record @param {string} key */
function hasNonEmptyString(record, key) {
  return typeof record[key] === "string" && record[key].length > 0;
}

/** @param {Record<string, unknown>} record @param {string} key */
function optionalString(record, key) {
  return !hasOwn(record, key) || typeof record[key] === "string";
}

/** @param {Record<string, unknown>} record @param {string} key */
function optionalBoolean(record, key) {
  return !hasOwn(record, key) || typeof record[key] === "boolean";
}

/** @param {Record<string, unknown>} record @param {string} key */
function optionalFiniteNumber(record, key) {
  return !hasOwn(record, key) || (typeof record[key] === "number" && Number.isFinite(record[key]));
}

/** @param {Record<string, unknown>} record @param {string} key */
function optionalStringArray(record, key) {
  return (
    !hasOwn(record, key) ||
    (Array.isArray(record[key]) && record[key].every((item) => typeof item === "string"))
  );
}

/**
 * @param {Record<string, unknown>} record
 * @param {string} key
 * @param {(value: unknown) => boolean} validator
 */
function optionalRecord(record, key, validator) {
  return !hasOwn(record, key) || (isRecord(record[key]) && validator(record[key]));
}

/** @param {unknown} value */
function isTTL(value) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 5 && value <= 120;
}

/** @param {unknown} value */
function isNonNegativeInteger(value) {
  return Number.isInteger(value) && Number.isFinite(value) && value >= 0;
}
