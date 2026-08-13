// @ts-check
import { createHash } from "node:crypto";
import { sessionProjectionHash } from "./sessionLegacyProjection.js";

export class SessionShadowComparator {
  #mismatches;
  #now;
  constructor({ mismatchRepository, now = () => new Date().toISOString() }) {
    this.#mismatches = mismatchRepository;
    this.#now = now;
  }
  compare({ legacy, sqlite }) {
    const legacyProjectionHash = sessionProjectionHash(legacy);
    const sqliteProjectionHash = sessionProjectionHash(sqlite);
    if (legacyProjectionHash === sqliteProjectionHash) {
      return { matched: true, legacyProjectionHash, sqliteProjectionHash, evidence: null };
    }
    const mismatchID = createHash("sha256")
      .update(JSON.stringify({ legacyProjectionHash, sqliteProjectionHash }))
      .digest("hex");
    const evidence = this.#mismatches.observe({
      mismatchID,
      legacyProjectionHash,
      sqliteProjectionHash,
      observedAt: this.#now(),
    });
    return { matched: false, legacyProjectionHash, sqliteProjectionHash, evidence };
  }
}
