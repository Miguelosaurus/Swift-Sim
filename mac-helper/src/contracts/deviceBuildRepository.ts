import type { DeviceBuildRecord } from "./build.js";

export interface DeviceBuildAppStateRecord {
  id: string;
  archivedAt: string;
  [key: string]: unknown;
}

export interface ArtifactCleanupJobRecord {
  id: string;
  root: string;
  buildId?: string;
  createdAt: string;
  notBefore?: string;
  nextAttemptAt?: string;
  attempts: number;
  lastError: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface DeliveryReferenceCleanupJobRecord {
  id: string;
  generation: string;
  referenceID: string;
  buildId?: string;
  createdAt: string;
  nextAttemptAt?: string;
  attempts: number;
  lastError: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/**
 * Normalized projection of the transactional portion of device-build state.
 * Runtime cancellation markers, lock ownership records, artifacts, and worker
 * identity files remain filesystem records and are intentionally absent.
 */
export interface DeviceBuildStateSnapshot {
  builds: readonly DeviceBuildRecord[];
  apps: readonly DeviceBuildAppStateRecord[];
  artifactCleanupJobs: readonly ArtifactCleanupJobRecord[];
  deliveryReferenceCleanupJobs: readonly DeliveryReferenceCleanupJobRecord[];
}

export interface DeviceBuildStateReader {
  read(): DeviceBuildStateSnapshot;
  getBuild(id: string): DeviceBuildRecord | null;
}

/**
 * Shadow/migration repository for the device-build domain. Snapshot replacement
 * is atomic so a migration attempt cannot publish builds without matching app
 * archive and cleanup-job state.
 */
export interface DeviceBuildStateRepository extends DeviceBuildStateReader {
  replace(snapshot: DeviceBuildStateSnapshot): void;
}

export interface DeviceBuildShadowMismatchObservation {
  mismatchID: string;
  keyHash: string;
  legacyProjectionHash: string;
  sqliteProjectionHash: string;
  observedAt: string;
}

export interface DeviceBuildShadowMismatchEvidence {
  mismatchID: string;
  keyHash: string;
  legacyProjectionHash: string;
  sqliteProjectionHash: string;
  firstObservedAt: string;
  lastObservedAt: string;
  observationCount: number;
}

export interface DeviceBuildShadowMismatchRepository {
  get(mismatchID: string): DeviceBuildShadowMismatchEvidence | null;
  list(): DeviceBuildShadowMismatchEvidence[];
  observe(observation: DeviceBuildShadowMismatchObservation): DeviceBuildShadowMismatchEvidence;
}

export interface DeviceBuildShadowComparisonResult {
  matched: boolean;
  keyHash: string;
  legacyProjectionHash: string;
  sqliteProjectionHash: string;
  evidence: DeviceBuildShadowMismatchEvidence | null;
}
