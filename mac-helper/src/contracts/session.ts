import {
  hasLiteral,
  hasNumber,
  hasOptionalString,
  hasString,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export const SESSION_PHASES = ["starting", "ready", "stopping", "stopped", "failed"] as const;
export type SessionPhase = (typeof SESSION_PHASES)[number];

export interface StreamState {
  streamID: string;
  simulatorUDID: string;
  port: number;
  startedAt: string;
  state: "starting" | "ready" | "stopping" | "stopped";
}

export interface SessionRecord {
  schemaVersion: number;
  sessionID: string;
  projectPath: string;
  createdAt: string;
  updatedAt: string;
  phase: SessionPhase;
  stream: StreamState;
  remoteBaseURL?: string;
  accessToken: string;
}

export interface PublicSessionProjection {
  sessionID: string;
  projectPath: string;
  phase: SessionPhase;
  stream: Pick<StreamState, "streamID" | "simulatorUDID" | "port" | "state">;
}

export interface PrivateSessionProjection extends PublicSessionProjection {
  accessToken: string;
  remoteBaseURL?: string;
}

const isStreamState: Validator<StreamState> = (value): value is StreamState => {
  if (!isRecord(value) || !hasString(value, "streamID") || !hasString(value, "simulatorUDID")) {
    return false;
  }
  return (
    hasNumber(value, "port") &&
    hasString(value, "startedAt") &&
    hasLiteral(value, "state", ["starting", "ready", "stopping", "stopped"] as const)
  );
};

export const isSessionRecord: Validator<SessionRecord> = (value): value is SessionRecord => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    hasNumber(value, "schemaVersion") &&
    hasString(value, "sessionID") &&
    hasString(value, "projectPath") &&
    hasString(value, "createdAt") &&
    hasString(value, "updatedAt") &&
    hasLiteral(value, "phase", SESSION_PHASES) &&
    isStreamState(value.stream) &&
    hasOptionalString(value, "remoteBaseURL") &&
    hasString(value, "accessToken")
  );
};

export function parseSessionRecord(value: unknown): SessionRecord {
  return parseContract(value, isSessionRecord, "session record");
}
