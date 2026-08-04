import {
  hasBoolean,
  hasOptionalBoolean,
  hasOptionalNumber,
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

interface PendingRenewalPrevious {
  expiresAt: string;
  remoteBaseUrl: string;
  delivery: DeviceBuildDelivery | null;
  installTTLMinutes?: number;
}

interface PendingRenewalTarget {
  ttlMinutes: number;
  remoteBaseUrl: string;
  deliveryMode: "custom" | "quick-tunnel";
}

export interface DeviceBuildPendingRenewal {
  id?: string;
  token: string;
  createdAt: string;
  deadlineAt?: string;
  previous: PendingRenewalPrevious;
  target?: PendingRenewalTarget;
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
    host?: string;
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

const isInstallationDevice: Validator<InstallationDevice> = (value): value is InstallationDevice =>
  isRecord(value) &&
  hasStringValue(value, "name") &&
  hasStringValue(value, "state") &&
  hasStringValue(value, "version") &&
  hasStringValue(value, "build");

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
  value.devices.every(isInstallationDevice);

const isArtifacts: Validator<DeviceBuildArtifacts> = (value): value is DeviceBuildArtifacts =>
  isRecord(value) &&
  hasStringValue(value, "root") &&
  hasStringValue(value, "archivePath") &&
  hasStringValue(value, "exportPath") &&
  hasStringValue(value, "ipaPath") &&
  hasStringValue(value, "manifestPath") &&
  hasOptionalString(value, "resultBundlePath");

const isCapability: Validator<DeviceBuildCapability> = (value): value is DeviceBuildCapability =>
  isRecord(value) &&
  hasString(value, "token") &&
  hasStringValue(value, "expiresAt") &&
  hasStringValue(value, "remoteBaseUrl") &&
  (value.delivery === null || isDeviceBuildDelivery(value.delivery)) &&
  isInteger(value.installTTLMinutes) &&
  value.installTTLMinutes >= 5 &&
  value.installTTLMinutes <= 120 &&
  hasStringValue(value, "createdAt");

const isPendingRenewalPrevious = (value: unknown): value is PendingRenewalPrevious =>
  isRecord(value) &&
  hasStringValue(value, "expiresAt") &&
  hasStringValue(value, "remoteBaseUrl") &&
  (value.delivery === null || isDeviceBuildDelivery(value.delivery)) &&
  (!Object.prototype.hasOwnProperty.call(value, "installTTLMinutes") ||
    (isInteger(value.installTTLMinutes) &&
      value.installTTLMinutes >= 5 &&
      value.installTTLMinutes <= 120));

const isPendingRenewalTarget = (value: unknown): value is PendingRenewalTarget =>
  isRecord(value) &&
  isInteger(value.ttlMinutes) &&
  value.ttlMinutes >= 5 &&
  value.ttlMinutes <= 120 &&
  hasStringValue(value, "remoteBaseUrl") &&
  (value.deliveryMode === "custom" || value.deliveryMode === "quick-tunnel");

const isPendingRenewal: Validator<DeviceBuildPendingRenewal> = (
  value,
): value is DeviceBuildPendingRenewal =>
  isRecord(value) &&
  hasOptionalString(value, "id") &&
  hasString(value, "token") &&
  hasStringValue(value, "createdAt") &&
  hasOptionalString(value, "deadlineAt") &&
  isPendingRenewalPrevious(value.previous) &&
  (!Object.prototype.hasOwnProperty.call(value, "target") || isPendingRenewalTarget(value.target));

const isControl = (value: unknown): value is { cancelPath: string } =>
  isRecord(value) && hasStringValue(value, "cancelPath");

const isRebuild = (value: unknown): boolean =>
  isRecord(value) &&
  hasStringValue(value, "appID") &&
  hasStringValue(value, "sourceBuildID") &&
  hasStringValue(value, "idempotencyKey") &&
  hasStringValue(value, "expectedBundleIdentifier") &&
  hasStringValue(value, "expectedTeamID");

const isLiveReload = (value: unknown): boolean =>
  isRecord(value) &&
  hasOptionalBoolean(value, "eligible") &&
  hasOptionalBoolean(value, "engineReady") &&
  hasOptionalBoolean(value, "compilerReady") &&
  hasOptionalString(value, "error") &&
  hasOptionalString(value, "host") &&
  hasOptionalNumber(value, "capturedCompilations") &&
  (!Object.prototype.hasOwnProperty.call(value, "capturedCompilations") ||
    (isInteger(value.capturedCompilations) && value.capturedCompilations >= 0));

export const isDeviceBuildRecord: Validator<DeviceBuildRecord> = (
  value,
): value is DeviceBuildRecord => {
  if (
    !isRecord(value) ||
    !hasString(value, "id") ||
    !hasString(value, "token") ||
    !hasStringValue(value, "tokenExpiredAt") ||
    !isInteger(value.revision) ||
    value.revision < 0 ||
    !hasStringValue(value, "remoteBaseUrl") ||
    !isDeviceBuildDelivery(value.delivery) ||
    !hasStringValue(value, "project") ||
    !hasStringValue(value, "workspace") ||
    !hasStringValue(value, "scheme") ||
    !hasStringValue(value, "configuration") ||
    !hasStringValue(value, "exportMethod") ||
    !hasBoolean(value, "preserveData") ||
    !hasStringValue(value, "createdAt") ||
    !hasStringValue(value, "updatedAt") ||
    !isInteger(value.installTTLMinutes) ||
    value.installTTLMinutes < 5 ||
    value.installTTLMinutes > 120 ||
    !isInteger(value.ttlMinutes) ||
    value.ttlMinutes !== value.installTTLMinutes ||
    !hasStringValue(value, "expiresAt") ||
    !DEVICE_BUILD_STATES.includes(value.state as DeviceBuildState) ||
    !isDeviceBuildApp(value.app) ||
    !isSigning(value.signing) ||
    !isInstallation(value.installation) ||
    !isArtifacts(value.artifacts) ||
    !Array.isArray(value.logs) ||
    !value.logs.every((line) => typeof line === "string") ||
    !hasOptionalStringArray(value, "buildSettings") ||
    !hasOptionalBoolean(value, "allowProvisioningUpdates") ||
    !hasOptionalRecord(value, "control") ||
    (Object.prototype.hasOwnProperty.call(value, "control") && !isControl(value.control)) ||
    !hasOptionalRecord(value, "rebuild") ||
    (Object.prototype.hasOwnProperty.call(value, "rebuild") && !isRebuild(value.rebuild)) ||
    !hasOptionalRecord(value, "liveReload") ||
    (Object.prototype.hasOwnProperty.call(value, "liveReload") &&
      !isLiveReload(value.liveReload)) ||
    !hasOptionalRecord(value, "pendingRenewal") ||
    (Object.prototype.hasOwnProperty.call(value, "pendingRenewal") &&
      !isPendingRenewal(value.pendingRenewal))
  ) {
    return false;
  }
  return (
    !Object.prototype.hasOwnProperty.call(value, "capabilities") ||
    (Array.isArray(value.capabilities) && value.capabilities.every(isCapability))
  );
};

export const isAppRecord: Validator<AppRecord> = (value): value is AppRecord =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasStringValue(value, "name") &&
  hasStringValue(value, "bundleIdentifier") &&
  hasStringValue(value, "teamID") &&
  hasStringValue(value, "archivedAt") &&
  Array.isArray(value.builds) &&
  value.builds.every(isDeviceBuildRecord);

const isPublicInstallation = (value: unknown): boolean =>
  isRecord(value) &&
  INSTALLATION_STATES.includes(value.state as InstallationState) &&
  hasStringValue(value, "requestedAt") &&
  hasStringValue(value, "verifiedAt") &&
  Array.isArray(value.devices) &&
  value.devices.every(isInstallationDevice);

const isPublicSigning = (value: unknown): boolean =>
  isRecord(value) &&
  hasStringValue(value, "method") &&
  hasBoolean(value, "deviceInstallable") &&
  hasStringValue(value, "updateSafe") &&
  Array.isArray(value.warnings) &&
  value.warnings.every((warning) => typeof warning === "string");

export const isPublicDeviceBuildProjection: Validator<PublicDeviceBuildProjection> = (
  value,
): value is PublicDeviceBuildProjection =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasStringValue(value, "createdAt") &&
  hasStringValue(value, "updatedAt") &&
  hasStringValue(value, "expiresAt") &&
  DEVICE_BUILD_STATES.includes(value.state as DeviceBuildState) &&
  hasStringValue(value, "configuration") &&
  isRecord(value.liveReload) &&
  hasBoolean(value.liveReload, "eligible") &&
  value.liveReload.mode === "debug-only" &&
  hasBoolean(value.liveReload, "engineReady") &&
  hasBoolean(value.liveReload, "compilerReady") &&
  isInteger(value.liveReload.capturedCompilations) &&
  value.liveReload.capturedCompilations >= 0 &&
  hasStringValue(value.liveReload, "error") &&
  isDeviceBuildApp(value.app) &&
  isPublicSigning(value.signing) &&
  isDeviceBuildDelivery(value.delivery) &&
  hasBoolean(value, "preserveData") &&
  isPublicInstallation(value.installation) &&
  isRecord(value.links) &&
  hasStringValue(value.links, "universalLink") &&
  hasStringValue(value.links, "customScheme") &&
  hasStringValue(value.links, "installURL");

export const isPublicAppProjection: Validator<PublicAppProjection> = (
  value,
): value is PublicAppProjection =>
  isRecord(value) &&
  hasString(value, "id") &&
  hasStringValue(value, "name") &&
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
