import type { CommandResult } from "../contracts/command.js";
import type {
  LiveEngineProcessRecord,
  OwnedWorkerProcessRecord,
} from "../contracts/process.js";

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

export type SupervisedProcessRecord = OwnedWorkerProcessRecord | LiveEngineProcessRecord;

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
  spawn(request: SpawnRequest): Promise<SupervisedProcess>;
  inspect(record: SupervisedProcessRecord): Promise<ProcessInspection>;
  terminate(request: TerminationRequest): Promise<void>;
}

export interface AtomicWriteOptions {
  mode: number;
  createParentMode: number;
  replace: boolean;
  syncDirectory: boolean;
}

export interface AtomicFileStore {
  readText(path: string): Promise<string>;
  readJSON(path: string): Promise<unknown>;
  writeText(path: string, value: string, options: AtomicWriteOptions): Promise<void>;
  writeJSON(path: string, value: unknown, options: AtomicWriteOptions): Promise<void>;
  remove(path: string): Promise<void>;
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
}

export interface LockManager {
  acquire(request: LockRequest): Promise<LockLease>;
  withLock<T>(request: LockRequest, operation: (lease: LockLease) => Promise<T>): Promise<T>;
}

export interface RuntimeJournalStore {
  publish(path: string, record: SupervisedProcessRecord): Promise<void>;
  read(path: string): Promise<unknown>;
  remove(path: string): Promise<void>;
}

export interface ArtifactWriteOptions {
  mode: number;
  replace: boolean;
}

export interface ArtifactStore {
  resolveContained(root: string, candidate: string): string;
  createDirectory(path: string, mode: number): Promise<void>;
  write(path: string, value: string | Uint8Array, options: ArtifactWriteOptions): Promise<void>;
  read(path: string): Promise<Uint8Array>;
  removeTree(path: string): Promise<void>;
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
