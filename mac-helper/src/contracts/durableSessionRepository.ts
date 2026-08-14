import type { DurableSessionRecord } from "./durableSession.js";

export interface DurableSessionReader {
  list(): DurableSessionRecord[];
  get(id: string): DurableSessionRecord | null;
}

export interface DurableSessionRepository extends DurableSessionReader {
  replace(records: readonly DurableSessionRecord[]): void;
}

export interface DurableSessionShadowMismatch {
  mismatchID: string;
  keyHash: string;
  legacyProjectionHash: string | null;
  sqliteProjectionHash: string | null;
}

export interface DurableSessionShadowComparisonResult {
  matched: boolean;
  mismatch: DurableSessionShadowMismatch | null;
}
