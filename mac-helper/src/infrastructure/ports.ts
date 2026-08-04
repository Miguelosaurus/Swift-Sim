import type { CommandResult } from "../contracts/command.js";
import type {
  DeliveryProcessIdentity,
  LiveEngineProcessRecord,
  OwnedWorkerProcessRecord,
} from "../contracts/process.js";
import type { RuntimeJournal } from "../contracts/runtime.js";

export type CommandEnvironment = Readonly<Record<string, string | undefined>>;

export interface CommandEnvironmentPolicy {
  inherit: readonly string[];
  overrides: CommandEnvironment;
  unset: readonly string[];
}

export interface CommandPolicy {
  timeoutMs: number;
  outputLimitBytes: number;
  processGroup: "inherit" | "new";
  acceptedExitCodes: readonly number[];
}

export interface CommandRequest {
  executable: string;
  args: readonly string[];
  cwd?: string;
  environment: CommandEnvironmentPolicy;
  input?: string | Uint8Array;
  cancellationSignal?: AbortSignal;
  policy: CommandPolicy;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
  runSync(request: CommandRequest): CommandResult;
}

export type ProcessRole = "worker" | "live-engine" | "gateway" | "manager" | "tunnel";
export type GroupOwnedProcessRecord = OwnedWorkerProcessRecord | LiveEngineProcessRecord;
export type SupervisedProcessRecord = DeliveryProcessIdentity | GroupOwnedProcessRecord;

export type ProcessRecordForRole<Role extends ProcessRole> = Role extends "worker"
  ? OwnedWorkerProcessRecord
  : Role extends "live-engine"
    ? LiveEngineProcessRecord
    : DeliveryProcessIdentity;

export interface SpawnRequest<Role extends ProcessRole = ProcessRole> {
  executable: string;
  args: readonly string[];
  cwd?: string;
  environment: CommandEnvironmentPolicy;
  processGroup: "inherit" | "new";
  journalPath: string;
  role: Role;
}

export interface SupervisedProcess<Role extends ProcessRole = ProcessRole> {
  pid: number;
  role: Role;
  record: ProcessRecordForRole<Role>;
}

export type ProcessInspection =
  | { state: "current"; record: SupervisedProcessRecord }
  | { state: "missing" | "dead" | "replaced" | "unverifiable" | "invalid" };

interface TerminationRequestCommon {
  signal: "SIGTERM" | "SIGKILL";
  graceMs: number;
}

export type TerminationRequest =
  | (TerminationRequestCommon & {
      record: GroupOwnedProcessRecord;
      terminateGroup: true;
    })
  | (TerminationRequestCommon & {
      record: SupervisedProcessRecord;
      terminateGroup: false;
    });

export interface ProcessSupervisor {
  spawn<Role extends ProcessRole>(request: SpawnRequest<Role>): SupervisedProcess<Role>;
  inspect(record: SupervisedProcessRecord): ProcessInspection;
  terminate(request: TerminationRequest): void;
  waitForExit(
    record: SupervisedProcessRecord,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<"exited" | "timeout" | "replaced" | "unverifiable">;
}

export interface AtomicWriteOptions {
  mode: number;
  createParentMode: number;
  replace: boolean;
  syncDirectory: boolean;
}

export interface AtomicFileStore {
  readText(path: string): Promise<string>;
  readTextSync(path: string): string;
  readJSON(path: string): Promise<unknown>;
  readJSONSync(path: string): unknown;
  writeText(path: string, value: string, options: AtomicWriteOptions): Promise<void>;
  writeTextSync(path: string, value: string, options: AtomicWriteOptions): void;
  writeJSON(path: string, value: unknown, options: AtomicWriteOptions): Promise<void>;
  writeJSONSync(path: string, value: unknown, options: AtomicWriteOptions): void;
  remove(path: string): Promise<void>;
  removeSync(path: string): void;
}

export interface LockRequest {
  path: string;
  waitMs: number;
  staleAfterMs: number;
  ownerMode: number;
}

export interface LockLease {
  path: string;
  ownerPath: string;
  ownerNonce: string;
  release(): Promise<void>;
  releaseSync(): void;
}

export interface LockManager {
  acquire(request: LockRequest): Promise<LockLease>;
  acquireSync(request: LockRequest): LockLease;
  withLock<T>(request: LockRequest, operation: (lease: LockLease) => Promise<T>): Promise<T>;
  withLockSync<T>(request: LockRequest, operation: (lease: LockLease) => T): T;
}

export type RuntimeJournalRecord = GroupOwnedProcessRecord | RuntimeJournal;

export interface RuntimeJournalStore {
  publish(path: string, record: RuntimeJournalRecord): Promise<void>;
  publishSync(path: string, record: RuntimeJournalRecord): void;
  read(path: string): Promise<unknown>;
  readSync(path: string): unknown;
  remove(path: string): Promise<void>;
  removeSync(path: string): void;
}

export interface ArtifactWriteOptions {
  mode: number;
  replace: boolean;
}

export interface ArtifactStore {
  resolveContained(root: string, candidate: string): string;
  createDirectory(path: string, mode: number): Promise<void>;
  createDirectorySync(path: string, mode: number): void;
  write(path: string, value: string | Uint8Array, options: ArtifactWriteOptions): Promise<void>;
  writeSync(path: string, value: string | Uint8Array, options: ArtifactWriteOptions): void;
  read(path: string): Promise<Uint8Array>;
  readSync(path: string): Uint8Array;
  removeTree(path: string): Promise<void>;
  removeTreeSync(path: string): void;
}

export interface RequestOriginInput {
  socketRemoteAddress: string;
  requestProtocol: "http:" | "https:";
  hostHeader: string;
  forwardedHostHeader?: string;
  forwardedProtoHeader?: string;
  requestedExternalBaseURL?: string;
}

export type RequestOriginDecision =
  | {
      accepted: true;
      requestIsLoopback: true;
      forwardedHeadersTrusted: boolean;
      externalBaseURL: string;
      source: "requested" | "direct" | "trusted-proxy";
    }
  | {
      accepted: false;
      requestIsLoopback: false;
      forwardedHeadersTrusted: false;
      reason: "non-loopback";
    }
  | {
      accepted: false;
      requestIsLoopback: true;
      forwardedHeadersTrusted: boolean;
      reason: "invalid-host" | "invalid-requested-origin";
    };

export interface RequestOriginPolicy {
  evaluate(input: RequestOriginInput): RequestOriginDecision;
}

export interface Clock {
  now(): Date;
  monotonicMilliseconds(): number;
  sleep(milliseconds: number, signal?: AbortSignal): Promise<void>;
}

export interface IdGenerator {
  randomUUID(): string;
  randomToken(bytes: number): string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  log(level: LogLevel, event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

/**
 * Composition-root aggregate only. Application services receive the narrow
 * ports they use rather than this complete object.
 */
export interface InfrastructurePorts {
  commandRunner: CommandRunner;
  processSupervisor: ProcessSupervisor;
  atomicFileStore: AtomicFileStore;
  lockManager: LockManager;
  runtimeJournalStore: RuntimeJournalStore;
  artifactStore: ArtifactStore;
  requestOriginPolicy: RequestOriginPolicy;
  clock: Clock;
  idGenerator: IdGenerator;
  logger: Logger;
}
