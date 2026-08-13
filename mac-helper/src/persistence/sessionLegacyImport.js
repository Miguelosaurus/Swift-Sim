// @ts-check
import { sessionProjectionHash } from "./sessionLegacyProjection.js";

/**
 * Import semantics independent of global SQLite composition. `atomicApply` must
 * commit the optional snapshot replacement and checkpoint as one transaction.
 */
export class SessionLegacyImportApplier {
  #readSnapshot;
  #readCheckpoint;
  #atomicApply;
  #source;
  #now;
  constructor({ readSnapshot, readCheckpoint, atomicApply, checkpointSource = "sessions-state-v1", now = () => new Date().toISOString() }) {
    this.#readSnapshot = readSnapshot;
    this.#readCheckpoint = readCheckpoint;
    this.#atomicApply = atomicApply;
    this.#source = checkpointSource;
    this.#now = now;
  }
  apply(locked) {
    const checkpoint = { source: this.#source, sourceRevision: locked.sourceRevision, projectionHash: locked.projectionHash, importedAt: this.#now(), recordCount: locked.recordCount };
    const currentHash = sessionProjectionHash(this.#readSnapshot());
    if (currentHash === locked.projectionHash && sameCheckpoint(this.#readCheckpoint(this.#source), checkpoint)) return { ...locked, status: "already-current" };
    const status = currentHash === locked.projectionHash ? "checkpointed" : "applied";
    this.#atomicApply({ snapshot: status === "applied" ? locked.snapshot : null, checkpoint });
    if (sessionProjectionHash(this.#readSnapshot()) !== locked.projectionHash) throw new Error("Session projection did not persist after legacy import.");
    if (!sameCheckpoint(this.#readCheckpoint(this.#source), checkpoint)) throw new Error("Session import checkpoint did not persist.");
    return { ...locked, status };
  }
}
function sameCheckpoint(actual, expected) {
  return actual !== null && actual.source === expected.source && actual.sourceRevision === expected.sourceRevision && actual.projectionHash === expected.projectionHash && actual.recordCount === expected.recordCount;
}
