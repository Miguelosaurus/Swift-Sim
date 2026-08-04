import type { CommandResult } from "../contracts/command.js";
import type {
  DeliveryProcessIdentity,
  LiveEngineProcessRecord,
  OwnedWorkerProcessRecord,
} from "../contracts/process.js";
import type { RuntimeJournal } from "../contracts/runtime.js";

export type CommandEnvironment = Readonly<Record<string, string | undefined>>;

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
  environment?: CommandEnvironment;
  input?: string | Uint8Array;
  cancellationSignal?: AbortSignal;
  policy: CommandPolicy;
}

export interface CommandRunner {
  run(request: CommandRequest): Promise<CommandResult>;
  runSync(request: CommandRequest): CommandResult;
}

export type SupervisedProcessRecord =
  | DeliveryProcessIdentity
  | OwnedWorkerProcessRecord
  | LiveEngineProcessRecord;

export interface SpawnRequest {
  executable: string;
  args: readonly string[];
  cwd?: string;
  environment?: CommandEnvironment;
  processGroup: "inherit" | "new";
  journalPath: string;
  role: "worker" | "live-engine" | "gateway" | "manager" | "tunnel";
}

export interface SupervisedProcess {
  pid: number;
  record: SupervisedProcessRecord;
}

export type ProcessInspection =
  | { state: "current"; record: SupervisedProcessRecord }
  | { state: "missing" | "dead" | "replaced" | "unverifiable" | "invalid" };

export interface TerminationRequest {
  record: SupervisedProcessRecord;
  signal: "SIGTERM" | "SIGKILL";
  graceMs: number;
  terminateGroup: boolean;
}

export interface ProcessSupervisor {
  spawn(request: SpawnRequest): SupervisedProcess;
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

export type RuntimeJournalRecord = SupervisedProcessRecord | RuntimeJournal;

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
  hostHeader?: string;
  forwardedHostHeader?: string;
  forwardedProtoHeader?: string;
  configuredExternalBaseURL?: string;
  trustProxy: boolean;
}

export type RequestOriginDecision =
  | { allowed: true; externalBaseURL: string; source: "configured" | "direct" | "trusted-proxy" }
  | { allowed: false; reason: "non-loopback" | "invalid-host" | "untrusted-forwarding" };

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
