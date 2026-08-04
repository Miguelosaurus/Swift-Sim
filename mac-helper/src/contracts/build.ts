import {
  hasBoolean,
  hasOptionalNullableNumber,
  hasOptionalRecord,
  hasOptionalString,
  hasOptionalStringArray,
  hasString,
  hasStringValue,
  isInteger,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const DEVICE_BUILD_STATES = [
  "queued",
  "validating",
  "preparing",
  "archiving",
  "building",
  "exporting",
  "delivering",
  "ready",
  "failed",
] as const;
export type DeviceBuildState = (typeof DEVICE_BUILD_STATES)[number];
export const INSTALLATION_STATES = [
  "unknown",
  "requested",
  "not-installed",
  "different-version",
  "verified",
] as const;
export type InstallationState = (typeof INSTALLATION_STATES)[number];

export interface DeviceBuildApp {
  identity: string;
  name: string;
  bundleIdentifier: string;
  version: string;
  build: string;
  teamID: string;
}

export interface DeviceBuildSigning {
  style: string;
  method: string;
  deviceInstallable: boolean;
  updateSafe: string;
  warnings: readonly string[];
}

export interface InstallationDevice {
  name: string;
  state: string;
  version: string;
  build: string;
}

export interface DeviceBuildInstallation {
  state: InstallationState;
  requestedAt: string;
  verifiedAt: string;
  updatedAt: string;
  verificationDeadlineAt: string;
  devices: readonly InstallationDevice[];
}

export interface DeviceBuildDelivery {
  mode: "custom" | "quick-tunnel";
  provider: "user-configured" | "cloudflare-quick-tunnel";
  expiresAt: string;
  generation?: string;
  referenceID?: string;
}

export interface DeviceBuildArtifacts {
  root: string;
  archivePath: string;
  exportPath: string;
  ipaPath: string;
  manifestPath: string;
  resultBundlePath?: string;
}

export interface DeviceBuildCapability {
  token: string;
  expiresAt: string;
  remoteBaseUrl: string;
  delivery: DeviceBuildDelivery | null;
  installTTLMinutes: number;
  createdAt: string;
}

export interface DeviceBuildPendingRenewal {
  id: string;
  token: string;
  createdAt: string;
  deadlineAt: string;
  previous: {
    expiresAt: string;
    remoteBaseUrl: string;
    delivery: DeviceBuildDelivery | null;
    installTTLMinutes: number;
  };
  target: {
    ttlMinutes: number;
    remoteBaseUrl: string;
    deliveryMode: "custom" | "quick-tunnel";
  };
}

export interface DeviceBuildRecord {
  id: string;
  token: string;
  tokenExpiredAt: string;
  revision: number;
  remoteBaseUrl: string;
  delivery: DeviceBuildDelivery;
  project: string;
  workspace: string;
  scheme: string;
  configuration: string;
  exportMethod: string;
  preserveData: boolean;
  createdAt: string;
  updatedAt: string;
  installTTLMinutes: number;
  ttlMinutes: number;
  expiresAt: string;
  state: DeviceBuildState;
  app: DeviceBuildApp;
  signing: DeviceBuildSigning;
  installation: DeviceBuildInstallation;
  artifacts: DeviceBuildArtifacts;
  logs: readonly string[];
  buildSettings?: readonly string[];
  allowProvisioningUpdates?: boolean;
  capabilities?: readonly DeviceBuildCapability[];
  pendingRenewal?: DeviceBuildPendingRenewal;
  control?: { cancelPath: string };
  rebuild?: {
    appID: string;
    sourceBuildID: string;
    idempotencyKey: string;
    expectedBundleIdentifier: string;
    expectedTeamID: string;
  };
  liveReload?: {
    eligible?: boolean;
    engineReady?: boolean;
    compilerReady?: boolean;
    capturedCompilations?: number;
    error?: string;
  };
}

export interface AppRecord {
  id: string;
  name: string;
  bundleIdentifier: string;
  teamID: string;
  archivedAt: string;
  builds: readonly DeviceBuildRecord[];
}

export interface PublicDeviceBuildProjection {
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  state: DeviceBuildState;
  configuration: string;
  liveReload: {
    eligible: boolean;
    mode: "debug-only";
    engineReady: boolean;
    compilerReady: boolean;
    capturedCompilations: number;
    error: string;
  };
  app: DeviceBuildApp;
  signing: Pick<DeviceBuildSigning, "method" | "deviceInstallable" | "updateSafe" | "warnings">;
  delivery: DeviceBuildDelivery;
  preserveData: boolean;
  installation: Pick<DeviceBuildInstallation, "state" | "requestedAt" | "verifiedAt" | "devices">;
  links: { universalLink: string; customScheme: string; installURL: string };
}

export interface PublicAppProjection {
  id: string;
  name: string;
  bundleIdentifier: string;
  archivedAt: string;
  latestBuild: PublicDeviceBuildProjection | null;
  builds: readonly PublicDeviceBuildProjection[];
}

const isDeviceBuildDelivery: Validator<DeviceBuildDelivery> = (
  value,
): value is DeviceBuildDelivery =>
  isRecord(value) &&
  (value.mode === "custom" || value.mode === "quick-tunnel") &&
  (value.provider === "user-configured" || value.provider === "cloudflare-quick-tunnel") &&
  hasStringValue(value, "expiresAt") &&
  hasOptionalString(value, "generation") &&
  hasOptionalString(value, "referenceID");

const isDeviceBuildApp: Validator<DeviceBuildApp> = (value): value is DeviceBuildApp =>
  isRecord(value) &&
  hasStringValue(value, "identity") &&
  hasStringValue(value, "name") &&
  hasStringValue(value, "bundleIdentifier") &&
  hasStringValue(value, "version") &&
  hasStringValue(value, "build") &&
  hasStringValue(value, "teamID");

const isSigning: Validator<DeviceBuildSigning> = (value): value is DeviceBuildSigning =>
  isRecord(value) &&
  hasStringValue(value, "style") &&
  hasStringValue(value, "method") &&
  hasBoolean(value, "deviceInstallable") &&
  hasStringValue(value, "updateSafe") &&
  Array.isArray(value.warnings) &&
  value.warnings.every((warning) => typeof warning === "string");

const isInstallation: Validator<DeviceBuildInstallation> = (
  value,
): value is DeviceBuildInstallation =>
  isRecord(value) &&
  INSTALLATION_STATES.includes(value.state as InstallationState) &&
  hasStringValue(value, "requestedAt") &&
  hasStringValue(value, "verifiedAt") &&
  hasStringValue(value, "updatedAt") &&
  hasStringValue(value, "verificationDeadlineAt") &&
  Array.isArray(value.devices) &&
  value.devices.every(
    (device) =>
      isRecord(device) &&
      hasStringValue(device, "name") &&
      hasStringValue(device, "state") &&
      hasStringValue(device, "version") &&
      hasStringValue(device, "build"),
  );

export const isDeviceBuildRecord: Validator<DeviceBuildRecord> = (
  value,
): value is DeviceBuildRecord => {
  if (
    !isRecord(value) ||
    !hasString(value, "id") ||
    !hasString(value, "token") ||
    !hasOptionalString(value, "tokenExpiredAt") ||
    !isInteger(value.revision) ||
    value.revision < 0 ||
    !hasOptionalString(value, "remoteBaseUrl") ||
    !isDeviceBuildDelivery(value.delivery) ||
    !hasStringValue(value, "project") ||
    !hasStringValue(value, "workspace") ||
    !hasStringValue(value, "scheme") ||
    !hasStringValue(value, "configuration") ||
    !hasStringValue(value, "exportMethod") ||
    typeof value.preserveData !== "boolean" ||
    !hasStringValue(value, "createdAt") ||
    !hasStringValue(value, "updatedAt") ||
    typeof value.installTTLMinutes !== "number" ||
    !Number.isFinite(value.installTTLMinutes) ||
    value.installTTLMinutes < 5 ||
    value.installTTLMinutes > 120 ||
    typeof value.ttlMinutes !== "number" ||
    value.ttlMinutes !== value.installTTLMinutes ||
    !hasOptionalString(value, "expiresAt") ||
    !DEVICE_BUILD_STATES.includes(value.state as DeviceBuildState) ||
    !isDeviceBuildApp(value.app) ||
    !isSigning(value.signing) ||
    !isInstallation(value.installation) ||
    !isRecord(value.artifacts) ||
    !Array.isArray(value.logs) ||
    !value.logs.every((line) => typeof line === "string")
  )
    return false;
  return (
    hasStringValue(value.artifacts, "root") &&
    hasStringValue(value.artifacts, "archivePath") &&
    hasStringValue(value.artifacts, "exportPath") &&
    hasStringValue(value.artifacts, "ipaPath") &&
    hasStringValue(value.artifacts, "manifestPath") &&
    hasOptionalString(value.artifacts, "resultBundlePath") &&
    hasOptionalStringArray(value, "buildSettings") &&
    (value.allowProvisioningUpdates === undefined ||
      typeof value.allowProvisioningUpdates === "boolean") &&
    hasOptionalRecord(value, "control") &&
    hasOptionalRecord(value, "rebuild") &&
    hasOptionalRecord(value, "liveReload") &&
    hasOptionalNullableNumber(value, "revision")
  );
};

export const isAppRecord: Validator<AppRecord> = (value): value is AppRecord =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "name") &&
  hasStringValue(value, "bundleIdentifier") &&
  hasStringValue(value, "teamID") &&
  hasStringValue(value, "archivedAt") &&
  Array.isArray(value.builds) &&
  value.builds.every(isDeviceBuildRecord);

export const isPublicDeviceBuildProjection: Validator<PublicDeviceBuildProjection> = (
  value,
): value is PublicDeviceBuildProjection =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "createdAt") &&
  hasString(value, "updatedAt") &&
  hasStringValue(value, "expiresAt") &&
  DEVICE_BUILD_STATES.includes(value.state as DeviceBuildState) &&
  hasString(value, "configuration") &&
  isRecord(value.liveReload) &&
  typeof value.liveReload.eligible === "boolean" &&
  value.liveReload.mode === "debug-only" &&
  typeof value.liveReload.engineReady === "boolean" &&
  typeof value.liveReload.compilerReady === "boolean" &&
  isInteger(value.liveReload.capturedCompilations) &&
  value.liveReload.capturedCompilations >= 0 &&
  hasStringValue(value.liveReload, "error") &&
  isDeviceBuildApp(value.app) &&
  isRecord(value.signing) &&
  hasStringValue(value.signing, "method") &&
  hasBoolean(value.signing, "deviceInstallable") &&
  hasStringValue(value.signing, "updateSafe") &&
  Array.isArray(value.signing.warnings) &&
  isDeviceBuildDelivery(value.delivery) &&
  typeof value.preserveData === "boolean" &&
  isPublicInstallation(value.installation) &&
  isRecord(value.links) &&
  hasOptionalString(value.links, "universalLink") &&
  hasString(value.links, "customScheme") &&
  hasOptionalString(value.links, "installURL");

function isPublicInstallation(value: unknown): boolean {
  return (
    isRecord(value) &&
    INSTALLATION_STATES.includes(value.state as InstallationState) &&
    hasStringValue(value, "requestedAt") &&
    hasStringValue(value, "verifiedAt") &&
    Array.isArray(value.devices) &&
    value.devices.every(
      (device) =>
        isRecord(device) &&
        hasStringValue(device, "name") &&
        hasStringValue(device, "state") &&
        hasStringValue(device, "version") &&
        hasStringValue(device, "build"),
    )
  );
}

export const isPublicAppProjection: Validator<PublicAppProjection> = (
  value,
): value is PublicAppProjection =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasString(value, "name") &&
  hasStringValue(value, "bundleIdentifier") &&
  hasStringValue(value, "archivedAt") &&
  (value.latestBuild === null || isPublicDeviceBuildProjection(value.latestBuild)) &&
  Array.isArray(value.builds) &&
  value.builds.every(isPublicDeviceBuildProjection);

export function parseDeviceBuildRecord(value: unknown): DeviceBuildRecord {
  return parseContract(value, isDeviceBuildRecord, "device build record");
}

export function parseAppRecord(value: unknown): AppRecord {
  return parseContract(value, isAppRecord, "app record");
}
