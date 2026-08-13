// @ts-check
import { createHash } from "node:crypto";
import { join } from "node:path";
import { parseSessionLegacyJSON, sessionProjectionHash } from "./sessionLegacyProjection.js";

const BACKUP_OPTIONS = Object.freeze({ mode: 0o600, createParentMode: 0o700, replace: false, syncDirectory: true });

export class SessionLockedLegacySnapshotReader {
  #files;
  #locks;
  #source;
  #backupDirectory;
  constructor({ fileStore, lockManager, source, backupDirectory }) {
    this.#files = fileStore;
    this.#locks = lockManager;
    this.#source = source;
    this.#backupDirectory = backupDirectory;
  }
  withLockedSnapshot(operation) {
    if (typeof operation !== "function" || operation.constructor?.name === "AsyncFunction") throw new Error("Session locked snapshot operation must be synchronous.");
    return this.#locks.withLockSync(this.#source.lockRequest, () => {
      const snapshot = this.#read();
      const result = operation(snapshot);
      if (result && typeof result.then === "function") throw new Error("Session locked snapshot operation must be synchronous.");
      return result;
    });
  }
  #read() {
    let raw = null;
    try { raw = this.#files.readTextSync(this.#source.path); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
    const digest = raw === null ? null : sha256(raw);
    let backupPath = null;
    if (raw !== null && digest !== null) {
      backupPath = join(this.#backupDirectory, `sessions-${safeName(this.#source.name)}.${digest}.bak`);
      try { this.#files.writeTextSync(backupPath, raw, BACKUP_OPTIONS); } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
      if (this.#files.readTextSync(backupPath) !== raw) throw new Error(`Session legacy backup content mismatch: ${backupPath}.`);
    }
    const snapshot = raw === null ? [] : parseSessionLegacyJSON(raw, this.#source.path);
    return Object.freeze({
      snapshot: Object.freeze(snapshot),
      sourceRevision: sha256(JSON.stringify({ version: 1, name: this.#source.name, present: raw !== null, digest })),
      projectionHash: sessionProjectionHash(snapshot),
      recordCount: snapshot.length,
      backups: Object.freeze(backupPath ? [backupPath] : []),
    });
  }
}
function safeName(value) { const result = String(value).replace(/[^A-Za-z0-9._-]+/g, "-"); if (!result) throw new Error("Session source name is unsafe."); return result; }
function hasCode(error, code) { return error !== null && typeof error === "object" && "code" in error && error.code === code; }
function sha256(value) { return createHash("sha256").update(value).digest("hex"); }
