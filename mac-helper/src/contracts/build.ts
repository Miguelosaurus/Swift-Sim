import {
  hasLiteral,
  hasNumber,
  hasOptionalString,
  hasString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const APP_STATES = ["discovered", "building", "signed", "failed"] as const;
export type AppState = (typeof APP_STATES)[number];
export const DEVICE_BUILD_STATES = ["queued", "building", "ready", "delivered", "failed"] as const;
export type DeviceBuildState = (typeof DEVICE_BUILD_STATES)[number];

export interface AppRecord {
  appID: string;
  bundleID: string;
  projectPath: string;
  state: AppState;
  updatedAt: string;
  teamID?: string;
}

export interface DeviceBuildRecord {
  buildID: string;
  appID: string;
  deviceUDID: string;
  state: DeviceBuildState;
  createdAt: string;
  updatedAt: string;
  artifactPath?: string;
  version?: string;
  buildNumber?: number;
  installURL?: string;
}

export interface PublicAppProjection {
  appID: string;
  bundleID: string;
  state: AppState;
  updatedAt: string;
}

export interface PublicDeviceBuildProjection {
  buildID: string;
  appID: string;
  deviceUDID: string;
  state: DeviceBuildState;
  version?: string;
  buildNumber?: number;
  installURL?: string;
}

export const isAppRecord: Validator<AppRecord> = (value): value is AppRecord => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasString(value, "appID") &&
    hasString(value, "bundleID") &&
    hasString(value, "projectPath") &&
    hasLiteral(value, "state", APP_STATES) &&
    hasString(value, "updatedAt") &&
    hasOptionalString(value, "teamID")
  );
};

export const isDeviceBuildRecord: Validator<DeviceBuildRecord> = (
  value,
): value is DeviceBuildRecord => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasString(value, "buildID") &&
    hasString(value, "appID") &&
    hasString(value, "deviceUDID") &&
    hasLiteral(value, "state", DEVICE_BUILD_STATES) &&
    hasString(value, "createdAt") &&
    hasString(value, "updatedAt") &&
    hasOptionalString(value, "artifactPath") &&
    hasOptionalString(value, "version") &&
    (value.buildNumber === undefined || hasNumber(value, "buildNumber")) &&
    hasOptionalString(value, "installURL")
  );
};

export function parseAppRecord(value: unknown): AppRecord {
  return parseContract(value, isAppRecord, "app record");
}

export function parseDeviceBuildRecord(value: unknown): DeviceBuildRecord {
  return parseContract(value, isDeviceBuildRecord, "device build record");
}
