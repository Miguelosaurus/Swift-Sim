import {
  hasOptionalNullableNumber,
  hasOptionalNumber,
  hasOptionalRecord,
  hasOptionalString,
  hasOptionalStringArray,
  hasString,
  isInteger,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const SESSION_STREAM_STATES = ["starting", "running", "stopped", "failed"] as const;
export type SessionStreamState = (typeof SESSION_STREAM_STATES)[number];

export interface SessionBuildRecord {
  state: string;
  [key: string]: unknown;
}

export interface SessionStreamRecord {
  state: SessionStreamState;
  transport?: string;
  quality?: string;
  localUrl?: string;
  previewUrl?: string;
  wsUrl?: string;
  port?: number | null;
  pid?: number | null;
  raw?: Record<string, unknown>;
  limitations?: readonly string[];
}

/** The JSON record written by SessionStore. Optional fields are legacy fields. */
export interface SessionRecord {
  id: string;
  token: string;
  project?: string;
  scheme?: string;
  simulatorUDID?: string;
  remoteBaseUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  revision?: number;
  build: SessionBuildRecord;
  stream: SessionStreamRecord;
  logs: readonly string[];
}

export interface PublicSessionProjection {
  id: string;
  recentProjectID: string;
  project: "set" | "";
  scheme?: string;
  createdAt?: string;
  updatedAt?: string;
  build: SessionBuildRecord;
  stream: {
    state: SessionStreamState;
    transport: string;
    quality: string;
    limitations: readonly string[];
  };
  links: {
    universalLink: string;
    customScheme: string;
  };
}

export interface PrivateSessionProjection extends PublicSessionProjection {
  codex: {
    localPreviewUrl: string;
    simulatorUDID: string;
    note: string;
  };
}

export const isSessionBuildRecord: Validator<SessionBuildRecord> = (
  value,
): value is SessionBuildRecord => isRecord(value) && hasString(value, "state");

export const isSessionStreamRecord: Validator<SessionStreamRecord> = (
  value,
): value is SessionStreamRecord => {
  if (
    !isRecord(value) ||
    !hasString(value, "state") ||
    !SESSION_STREAM_STATES.includes(value.state as SessionStreamState)
  ) {
    return false;
  }
  return (
    hasOptionalString(value, "transport") &&
    hasOptionalString(value, "quality") &&
    hasOptionalString(value, "localUrl") &&
    hasOptionalString(value, "previewUrl") &&
    hasOptionalString(value, "wsUrl") &&
    hasOptionalNullableNumber(value, "port") &&
    hasOptionalNullableNumber(value, "pid") &&
    hasOptionalRecord(value, "raw") &&
    hasOptionalStringArray(value, "limitations") &&
    optionalNonNegativeInteger(value, "port") &&
    optionalPositiveInteger(value, "pid")
  );
};

export const isSessionRecord: Validator<SessionRecord> = (value): value is SessionRecord => {
  if (
    !isRecord(value) ||
    !hasString(value, "id") ||
    !hasString(value, "token") ||
    !isSessionBuildRecord(value.build) ||
    !isSessionStreamRecord(value.stream) ||
    !Array.isArray(value.logs) ||
    !value.logs.every((line) => typeof line === "string")
  ) {
    return false;
  }
  return (
    hasOptionalString(value, "project") &&
    hasOptionalString(value, "scheme") &&
    hasOptionalString(value, "simulatorUDID") &&
    hasOptionalString(value, "remoteBaseUrl") &&
    hasOptionalString(value, "createdAt") &&
    hasOptionalString(value, "updatedAt") &&
    hasOptionalNumber(value, "revision") &&
    optionalNonNegativeInteger(value, "revision")
  );
};

export const isPublicSessionProjection: Validator<PublicSessionProjection> = (
  value,
): value is PublicSessionProjection => {
  if (
    !isRecord(value) ||
    !hasString(value, "id") ||
    !hasString(value, "recentProjectID") ||
    (value.project !== "set" && value.project !== "") ||
    !isSessionBuildRecord(value.build) ||
    !isRecord(value.stream) ||
    !isSessionStreamRecord(value.stream) ||
    !isRecord(value.links) ||
    !Object.prototype.hasOwnProperty.call(value.links, "universalLink") ||
    typeof value.links.universalLink !== "string" ||
    !hasString(value.links, "customScheme")
  )
    return false;
  return (
    hasOptionalString(value, "scheme") &&
    hasOptionalString(value, "createdAt") &&
    hasOptionalString(value, "updatedAt") &&
    hasString(value.stream, "transport") &&
    hasString(value.stream, "quality") &&
    Array.isArray(value.stream.limitations) &&
    value.stream.limitations.every((item) => typeof item === "string")
  );
};

export function parseSessionRecord(value: unknown): SessionRecord {
  return parseContract(value, isSessionRecord, "session record");
}

function optionalNonNegativeInteger(record: Record<string, unknown>, key: string): boolean {
  return (
    !Object.prototype.hasOwnProperty.call(record, key) ||
    (isInteger(record[key]) && Number(record[key]) >= 0)
  );
}

function optionalPositiveInteger(record: Record<string, unknown>, key: string): boolean {
  return (
    !Object.prototype.hasOwnProperty.call(record, key) ||
    (isInteger(record[key]) && Number(record[key]) > 0)
  );
}
