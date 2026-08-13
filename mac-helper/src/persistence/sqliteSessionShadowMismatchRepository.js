// @ts-check
import { createHash } from "node:crypto";

export class SqliteSessionShadowMismatchRepository {
  #get;
  #observe;
  constructor(database) {
    this.#get = database.prepare("SELECT * FROM session_shadow_mismatches WHERE mismatch_id = ?");
    this.#observe = database.prepare(`INSERT INTO session_shadow_mismatches(mismatch_id, legacy_projection_hash, sqlite_projection_hash, first_observed_at, last_observed_at, observation_count) VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(mismatch_id) DO UPDATE SET last_observed_at = excluded.last_observed_at, observation_count = session_shadow_mismatches.observation_count + 1`);
  }
  get(id) {
    const row = this.#get.get(id);
    return row ? { mismatchID: row.mismatch_id, legacyProjectionHash: row.legacy_projection_hash, sqliteProjectionHash: row.sqlite_projection_hash, firstObservedAt: row.first_observed_at, lastObservedAt: row.last_observed_at, observationCount: row.observation_count } : null;
  }
  observe(input) {
    const expected = createHash("sha256").update(JSON.stringify({ legacyProjectionHash: input.legacyProjectionHash, sqliteProjectionHash: input.sqliteProjectionHash })).digest("hex");
    if (input.mismatchID !== expected || input.legacyProjectionHash === input.sqliteProjectionHash) throw new Error("Invalid session shadow mismatch observation.");
    this.#observe.run(input.mismatchID, input.legacyProjectionHash, input.sqliteProjectionHash, input.observedAt, input.observedAt);
    const result = this.get(input.mismatchID);
    if (!result) throw new Error("Session shadow mismatch evidence did not persist.");
    return result;
  }
}
