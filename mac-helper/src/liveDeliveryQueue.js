import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { NodeAtomicFileStore, ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeLockManager } from "./infrastructure/nodeLockManager.js";
import { verifyReplacementProofReceipt } from "./replacementProof.js";

export const LIVE_DELIVERY_QUEUE_SCHEMA = 1;
export const LIVE_DELIVERY_STATES = Object.freeze([
  "queued", "waiting-for-device", "waiting-for-foreground", "compiling",
  "applying", "applied", "refreshed", "failed", "expired", "superseded", "uncertain",
]);
const TERMINAL = new Set(["refreshed", "failed", "expired", "superseded", "uncertain"]);
const PRE_APPLY = new Set(["queued", "waiting-for-device", "waiting-for-foreground", "compiling"]);
const LIMITS = Object.freeze({ records: 256, files: 32, fileBytes: 1024 * 1024, requestBytes: 8 * 1024 * 1024, journalBytes: 32 * 1024 * 1024 });
const WRITE_OPTIONS = Object.freeze({ mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
const SCOPE_FIELDS = ["project", "scheme", "appIdentity", "binaryIdentity", "sessionIdentity"];
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// This is a private runtime delivery journal, not app/build library authority.
// No constructor or read operation creates directories or mutates the journal.
export function createLiveDeliveryQueue({
  rootPath = join(homedir(), ".swift-sim", "live", "deliveries"),
  fileStore = new NodeAtomicFileStore(), lockManager, identity,
  now = () => Date.now(), newId = randomUUID,
} = {}) {
  if (typeof rootPath !== "string" || !isAbsolute(rootPath)) throw queueError("QUEUE_ROOT_INVALID");
  const root = resolve(rootPath);
  const journalPath = join(root, "queue.json");
  let locks = lockManager;

  function timestamp() {
    const value = Number(now());
    if (!Number.isSafeInteger(value) || value < 0) throw queueError("QUEUE_CLOCK_INVALID");
    return value;
  }
  function read() {
    assertPrivatePath(root, "directory");
    const observation = assertPrivatePath(journalPath, "file");
    if (!observation) return { schemaVersion: 1, nextSequence: 1, records: [], processRebases: [], binaryBaselines: [], desiredStates: [] };
    if (observation.size > LIMITS.journalBytes) throw queueError("QUEUE_JOURNAL_INVALID");
    let value;
    try { value = fileStore.readJSONSync(journalPath); } catch { throw queueError("QUEUE_JOURNAL_INVALID"); }
    validateJournal(value);
    value.desiredStates ||= [];
    // Upgrade old journals in memory only. Their authenticated refresh proofs
    // establish desired state before any later expiry/GC mutation can remove it.
    for (const record of value.records) if (record.state === "refreshed") retainDesiredState(value, record, record.updatedAt);
    return value;
  }
  async function mutate(operation) {
    if (!locks && typeof identity !== "function") throw queueError("QUEUE_LOCK_AUTHORITY_REQUIRED");
    assertPrivatePath(root, "directory");
    ensureDirectoryModeSync(root, 0o700);
    locks ||= new NodeLockManager({ identity, fileStore });
    return locks.withLock({ path: join(root, "queue.lock"), waitMs: 5_000, staleAfterMs: 1_000, ownerMode: 0o600 }, async () => {
      const journal = read();
      const previous = JSON.stringify(journal);
      const result = operation(journal, timestamp());
      const encoded = JSON.stringify(journal);
      if (Buffer.byteLength(encoded) > LIMITS.journalBytes) throw queueError("QUEUE_LIMIT_REACHED");
      if (encoded !== previous) await fileStore.writeJSON(journalPath, journal, WRITE_OPTIONS);
      return clone(result);
    });
  }
  function find(journal, requestId) {
    const record = journal.records.find((item) => item.requestId === requestId);
    if (!record) throw queueError("QUEUE_REQUEST_NOT_FOUND");
    return record;
  }

  return Object.freeze({
    rootPath: root,
    limits: LIMITS,
    list({ scope } = {}) {
      const records = read().records;
      return clone(scope ? records.filter((record) => scopeMatches(record.scope, normalizeScope(scope))) : records);
    },
    get(requestId) { return clone(read().records.find((record) => record.requestId === requestId) || null); },
    desiredStates({ scope, includeRevoked = false } = {}) {
      const binding = scope ? normalizeScope(scope) : null;
      return clone(read().desiredStates.filter((item) => (includeRevoked || !item.revoked) && (!binding || sameBinaryScope(item.scope, binding))));
    },
    binaryBaseline(scope, path) {
      const binding = normalizeScope(scope);
      return clone(read().binaryBaselines.find((item) => sameBinaryScope(item.scope, binding))?.files.find((file) => file.path === path) || null);
    },
    async enqueue({ requestId = newId(), scope, files, baselineRevision = 0, expiresAt } = {}) {
      validateId(requestId);
      const binding = normalizeScope(scope);
      const snapshots = normalizeFiles(files);
      validateRevision(baselineRevision);
      const snapshotDigest = digest(snapshots);
      return mutate((journal, time) => {
        sweepJournal(journal, time);
        const existing = journal.records.find((record) => record.requestId === requestId);
        if (existing) {
          if (!scopeMatches(existing.scope, binding) || existing.snapshotDigest !== snapshotDigest) throw queueError("QUEUE_REQUEST_CONFLICT");
          return existing;
        }
        // Only expired terminal history without a pending dependent may leave
        // the journal. No live receipt or queued source baseline is discarded.
        pruneExpiredHistory(journal, time);
        if (journal.records.length >= LIMITS.records) throw queueError("QUEUE_LIMIT_REACHED");
        pruneOriginalBaselines(journal, time, binding);
        retainOriginalBaselines(journal, binding, snapshots, time);
        const lane = journal.records.filter((record) => scopeMatches(record.scope, binding) && record.expiresAt > time && !["expired", "superseded", "failed"].includes(record.state));
        const predecessor = lane.at(-1);
        assertDesiredCapacity(journal, binding, snapshots, time);
        for (const snapshot of snapshots) {
          const prior = lane.flatMap((item) => item.files).findLast((file) => file.path === snapshot.path);
          if (prior && prior.afterHash !== snapshot.beforeHash) throw queueError("QUEUE_SOURCE_BASELINE_CONFLICT");
        }
        const expiry = expiresAt === undefined ? time + DEFAULT_TTL_MS : parseExpiry(expiresAt);
        if (expiry <= time || expiry > time + DEFAULT_TTL_MS) throw queueError("QUEUE_EXPIRY_INVALID");
        const record = {
          schemaVersion: 1, requestId, sequence: journal.nextSequence++, scope: binding,
          files: snapshots, snapshotDigest, baselineRevision,
          createdAt: time, updatedAt: time, expiresAt: expiry, state: "queued",
          predecessorRequestId: predecessor?.requestId || "", preparedPatch: null,
          claim: null, proof: null, reasonCode: "", bindingHistory: [],
        };
        journal.records.push(record);
        assertJournalPublicationCapacity(journal, time);
        pruneOriginalBaselines(journal, time);
        return record;
      });
    },
    async claimNext({ scope, currentRevision, deviceConnected = false, foreground = false, workerId, leaseMs = 120_000 } = {}) {
      const binding = normalizeScope(scope);
      validateRevision(currentRevision);
      validateId(workerId);
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 10 * 60_000) throw queueError("QUEUE_LEASE_INVALID");
      return mutate((journal, time) => {
        sweepJournal(journal, time, binding);
        const lane = journal.records.filter((record) => scopeMatches(record.scope, binding));
        let record = lane.find((item) => !TERMINAL.has(item.state));
        if (!record || record.claim || record.state === "applying" || record.state === "applied") return null;
        if (record.preparedPatch && (!deviceConnected || !foreground)) {
          const waitingState = deviceConnected ? "waiting-for-foreground" : "waiting-for-device";
          if (record.state !== waitingState) { record.state = waitingState; record.updatedAt = time; }
          record = lane.find((item) => !TERMINAL.has(item.state) && !item.preparedPatch && !item.claim);
          if (!record) return null;
        }
        if (record.preparedPatch && record.predecessorRequestId) {
          const predecessor = find(journal, record.predecessorRequestId);
          if (predecessor.state !== "refreshed") {
            const terminalFailure = ["failed", "expired", "superseded"].includes(predecessor.state);
            if (terminalFailure) record.state = "failed";
            record.reasonCode = terminalFailure ? "QUEUE_PREDECESSOR_NOT_APPLIED" : "QUEUE_PREDECESSOR_PENDING";
            record.updatedAt = time;
            return null;
          }
          if (!scopeMatches(predecessor.scope, record.scope)) {
            record.reasonCode = "QUEUE_PREDECESSOR_SESSION_CHANGED"; record.updatedAt = time;
            return null;
          }
          record.baselineRevision = predecessor.proof.revision;
        }
        if (record.preparedPatch) {
          if (lane.some((item) => item.sequence < record.sequence && unresolvedEffect(item))) {
            record.reasonCode = "QUEUE_AMBIGUOUS_PREDECESSOR";
            if (record.state !== "waiting-for-device") { record.state = "waiting-for-device"; record.updatedAt = time; }
            return null;
          }
          if (!deviceConnected || !foreground) {
            record.state = deviceConnected ? "waiting-for-foreground" : "waiting-for-device";
            record.updatedAt = time;
            return null;
          }
          if (record.baselineRevision !== currentRevision) {
            record.state = "failed"; record.reasonCode = "QUEUE_REVISION_CONFLICT"; record.updatedAt = time;
            return null;
          }
        }
        const claimToken = newId(); validateId(claimToken);
        record.claim = { token: claimToken, workerId, expiresAt: time + leaseMs };
        record.state = record.preparedPatch ? "waiting-for-device" : "compiling";
        record.reasonCode = "";
        record.updatedAt = time;
        return record;
      });
    },
    async transition(requestId, { claimToken, state, preparedPatch, proof, reasonCode = "", scope, currentRevision } = {}) {
      return mutate((journal, time) => {
        const record = find(journal, requestId);
        if (TERMINAL.has(record.state)) throw queueError("QUEUE_TERMINAL_STATE");
        if (!record.claim || record.claim.token !== claimToken || record.claim.expiresAt <= time) throw queueError("QUEUE_STALE_CLAIM");
        if (!LIVE_DELIVERY_STATES.includes(state)) throw queueError("QUEUE_STATE_INVALID");
        if (state === "superseded" || state === "expired" || state === "compiling") throw queueError("QUEUE_STATE_INVALID");
        if (record.expiresAt <= time && PRE_APPLY.has(record.state)) throw queueError("QUEUE_REQUEST_EXPIRED");
        if (preparedPatch !== undefined) {
          if (!PRE_APPLY.has(record.state)) throw queueError("QUEUE_STATE_INVALID");
          if (!preparedPatch || typeof preparedPatch !== "object" || Array.isArray(preparedPatch)
            || Buffer.byteLength(JSON.stringify(preparedPatch)) > 512 * 1024) throw queueError("QUEUE_PATCH_INVALID");
          record.preparedPatch = clone(preparedPatch);
        }
        if (state === "applying") {
          if (!PRE_APPLY.has(record.state) || !record.preparedPatch || !scopeMatches(record.scope, normalizeScope(scope))
            || currentRevision !== record.baselineRevision
            || journal.records.some((item) => scopeMatches(item.scope, record.scope) && item.sequence < record.sequence && unresolvedEffect(item))) throw queueError("QUEUE_APPLICATION_FENCE_FAILED");
          assertJournalPublicationCapacity(journal, time);
          record.applyClaimToken = record.claim.token;
          record.lastNoEffectReceipt = null;
        } else if (state === "applied" || state === "refreshed") {
          if (record.state !== "applying" && record.state !== "applied") throw queueError("QUEUE_STATE_INVALID");
          validateProof(record, proof, state === "refreshed");
          if (record.proof && record.proof.revision !== proof.revision) throw queueError("QUEUE_PROOF_INVALID");
          record.proof = clone(proof);
        } else if (PRE_APPLY.has(state)) {
          if (!PRE_APPLY.has(record.state)) throw queueError("QUEUE_STATE_INVALID");
        } else if (state !== "failed" && state !== "uncertain") throw queueError("QUEUE_STATE_INVALID");
        // A load whose result was lost/partial is never relabeled retryable.
        if (state === "failed" && (record.state === "applying" || record.state === "applied")) state = "uncertain";
        record.state = state; record.reasonCode = safeReason(reasonCode); record.updatedAt = time;
        if (state !== "applying" && state !== "applied") record.claim = null;
        if (state === "refreshed") retainDesiredState(journal, record, time);
        return record;
      });
    },
    async sweepExpired() {
      return mutate((journal, time) => sweepJournal(journal, time));
    },
    async rebaseForProcess({ scope, verified = false, currentRevision, newRequestId = newId(), expiresAt } = {}) {
      const binding = normalizeScope(scope);
      validateId(newRequestId);
      if (!verified || currentRevision !== 0) throw queueError("QUEUE_REBASE_REJECTED");
      return mutate((journal, time) => {
        sweepJournal(journal, time);
        pruneExpiredHistory(journal, time);
        const existing = journal.processRebases.find((item) => scopeMatches(item.scope, binding));
        if (existing) return { record: existing.requestId ? find(journal, existing.requestId) : null, supersededRequestIds: existing.supersededRequestIds, netNoChange: existing.netNoChange };
        if (journal.processRebases.length >= LIMITS.records) throw queueError("QUEUE_LIMIT_REACHED");
        const lane = journal.records.filter((record) => sameBinaryScope(record.scope, binding));
        const desired = journal.desiredStates.find((item) => sameBinaryScope(item.scope, binding));
        if (!lane.some((record) => record.scope.sessionIdentity !== binding.sessionIdentity) && (!desired || desired.scope.sessionIdentity === binding.sessionIdentity)) throw queueError("QUEUE_REBASE_REJECTED");
        // The caller has authenticated a different process of this exact
        // binary at revision zero. Ambiguous effects in its dead predecessor
        // cannot exist in this new address space. Live workers and any effect
        // in the CURRENT process still prohibit a replacement operation.
        if (lane.some((record) => (record.claim && record.claim.expiresAt > time)
          || (record.scope.sessionIdentity === binding.sessionIdentity && ["uncertain", "applying", "applied", "refreshed"].includes(record.state)))) throw queueError("QUEUE_REBASE_BLOCKED");
        const watermark = desired?.confirmedThroughSequence || 0;
        const history = lane.filter((record) => record.sequence > watermark && record.expiresAt > time && (PRE_APPLY.has(record.state) || ["uncertain", "applying", "applied"].includes(record.state)));
        const original = journal.binaryBaselines.find((item) => sameBinaryScope(item.scope, binding));
        const merged = new Map((desired && !desired.revoked ? desired.files : []).map((file) => [file.path, clone(file)]));
        for (const record of history) {
          for (const file of record.desiredSnapshots || record.files) {
            const baseline = original?.files.find((item) => item.path === file.path);
            if (!baseline || baseline.beforeHash !== sha(baseline.beforeSource)) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
            merged.set(file.path, { path: file.path, beforeSource: baseline.beforeSource, afterSource: file.afterSource });
          }
        }
        const files = [...merged.values()].filter((file) => file.beforeSource !== file.afterSource);
        const superseded = history;
        if (journal.records.some((record) => record.requestId === newRequestId)) throw queueError("QUEUE_REQUEST_CONFLICT");
        if (history.length === 0 && (!desired || desired.revoked)) return { record: null, supersededRequestIds: [], netNoChange: true };
        // A cumulative cohort inherits its earliest accepted expiry. This may
        // shorten a later intent, but never extends or silently reschedules it.
        const expiryBound = Math.min(time + DEFAULT_TTL_MS, ...history.map((item) => item.expiresAt));
        const expiry = expiresAt === undefined ? expiryBound : parseExpiry(expiresAt);
        if (expiry <= time || expiry > expiryBound) throw queueError("QUEUE_EXPIRY_INVALID");
        let record = null;
        if (files.length) {
          if (journal.records.length >= LIMITS.records) throw queueError("QUEUE_LIMIT_REACHED");
          const snapshots = normalizeFiles(files);
          const desiredSnapshots = normalizeFiles([...merged.values()]);
          record = {
            schemaVersion: 1, requestId: newRequestId, sequence: journal.nextSequence++, scope: binding,
            files: snapshots, snapshotDigest: digest(snapshots), baselineRevision: 0,
            createdAt: time, updatedAt: time, expiresAt: expiry, state: "queued",
            predecessorRequestId: "", preparedPatch: null, claim: null, proof: null,
            reasonCode: "QUEUE_PROCESS_REBASED", bindingHistory: [],
            rebaseSessionIdentity: binding.sessionIdentity,
            ...(digest(desiredSnapshots) !== digest(snapshots) ? { desiredSnapshots, desiredSnapshotDigest: digest(desiredSnapshots) } : {}),
            rebaseSourceRequestIds: history.map((item) => item.requestId),
            rebaseSupersededRequestIds: superseded.map((item) => item.requestId),
          };
          journal.records.push(record);
        }
        // The replacement and all supersession pointers are one atomic journal
        // publication. A failed write leaves the original requests intact.
        for (const item of superseded) {
          item.supersededState = item.state;
          item.state = "superseded"; item.claim = null;
          item.replacementRequestId = record?.requestId || "";
          item.reasonCode = record ? "QUEUE_PROCESS_REBASED" : "QUEUE_NET_NO_CHANGE";
          item.updatedAt = time;
        }
        // Preserve historical proof while allowing status to describe the
        // restoration currently required by a different app process.
        for (const item of lane.filter((candidate) => candidate.state === "refreshed")) {
          item.restorationRequestId = record?.requestId || "";
          item.restorationNoChange = record ? null : { scope: binding, observedAt: time };
        }
        const supersededRequestIds = superseded.map((item) => item.requestId);
        if (!record && merged.size) retainBaselineDesire(journal, { scope: binding, files: [...merged.values()], sequence: Math.max(watermark, ...history.map((item) => item.sequence)), sourceRequestId: history.at(-1)?.requestId || desired.sourceRequestId }, time);
        journal.processRebases.push({ scope: binding, requestId: record?.requestId || null, supersededRequestIds, netNoChange: !record, createdAt: time, expiresAt: expiry });
        return { record, supersededRequestIds, netNoChange: !record };
      });
    },
    async revokeDesired({ scope } = {}) {
      const binding = normalizeScope(scope);
      return mutate((journal, time) => {
        const lane = journal.records.filter((record) => sameBinaryScope(record.scope, binding));
        if (lane.some((record) => record.claim && record.claim.expiresAt > time)) throw queueError("QUEUE_REVOKE_BLOCKED");
        const previous = journal.desiredStates.find((item) => sameBinaryScope(item.scope, binding));
        const watermark = Math.max(previous?.confirmedThroughSequence || 0, ...lane.map((record) => record.sequence));
        if (previous?.revoked && previous.confirmedThroughSequence === watermark) return previous;
        for (const record of lane) {
          // Revocation disables future restoration; it cannot establish that
          // an ambiguous mutation had no effect in this same app process.
          if (!PRE_APPLY.has(record.state)) continue;
          record.supersededState = record.state; record.state = "superseded";
          record.claim = null; record.replacementRequestId = "";
          record.reasonCode = "QUEUE_DESIRED_REVOKED"; record.updatedAt = time;
        }
        const value = { scope: binding, files: [], confirmedThroughSequence: watermark, sourceRequestId: "", proof: null, confirmation: "revoked", revoked: true, createdAt: previous?.createdAt ?? time, updatedAt: time };
        replaceDesired(journal, value);
        journal.processRebases = journal.processRebases.filter((item) => !sameBinaryScope(item.scope, binding));
        return value;
      });
    },
    async releaseNoEffect(requestId, { claimToken, scope, receipt, verified = false } = {}) {
      const binding = normalizeScope(scope);
      return mutate((journal, time) => {
        const record = find(journal, requestId);
        if (!verified || !scopeMatches(record.scope, binding)
          || !["applying", "uncertain"].includes(record.state)
          || !claimToken || record.applyClaimToken !== claimToken
          || (record.claim && record.claim.token !== claimToken)
          || record.proof?.applied === true) throw queueError("QUEUE_NO_EFFECT_REJECTED");
        validateNoEffectReceipt(record, receipt);
        // This exceptional release requires an authenticated rejection BEFORE
        // native admission/ledger ownership. Generic failures or missing proof
        // never establish that no effect happened. The claim token fences a
        // stale rejection from an earlier send of the same request/digest.
        record.state = record.expiresAt <= time ? "expired" : "waiting-for-foreground";
        record.reasonCode = record.state === "expired" ? "QUEUE_EXPIRED" : receipt.reasonCode;
        record.claim = null; record.applyClaimToken = "";
        record.lastNoEffectReceipt = clone(receipt); record.updatedAt = time;
        return record;
      });
    },
    async reconcileReceipt(requestId, { scope, proof, verified = false } = {}) {
      const binding = normalizeScope(scope);
      return mutate((journal, time) => {
        const record = find(journal, requestId);
        if (!verified || !scopeMatches(record.scope, binding)
          || !["applying", "applied", "uncertain", "refreshed"].includes(record.state)) throw queueError("QUEUE_RECEIPT_REJECTED");
        const refreshed = proof?.refreshed === true;
        validateProof(record, proof, refreshed);
        if (record.proof && record.proof.revision !== proof.revision) throw queueError("QUEUE_PROOF_INVALID");
        if (record.state === "refreshed") {
          if (!refreshed) throw queueError("QUEUE_RECEIPT_REJECTED");
          return record;
        }
        // Receipt reconciliation is proof-only: no external effect is issued,
        // no claim is re-created, and the request can never become retryable.
        record.proof = clone(proof); record.state = refreshed ? "refreshed" : "applied";
        record.claim = null; record.reasonCode = refreshed ? "" : "QUEUE_REFRESH_PENDING";
        record.updatedAt = time;
        if (refreshed) retainDesiredState(journal, record, time);
        return record;
      });
    },
    async renewClaim(requestId, { claimToken, leaseMs = 120_000 } = {}) {
      if (!Number.isSafeInteger(leaseMs) || leaseMs < 1 || leaseMs > 10 * 60_000) throw queueError("QUEUE_LEASE_INVALID");
      return mutate((journal, time) => {
        const record = find(journal, requestId);
        if (TERMINAL.has(record.state) || !record.claim || record.claim.token !== claimToken || record.claim.expiresAt <= time) throw queueError("QUEUE_STALE_CLAIM");
        record.claim.expiresAt = time + leaseMs; record.updatedAt = time;
        return record;
      });
    },
    async rebindSession(requestId, { previousSessionIdentity, scope, currentRevision, verified = false } = {}) {
      const binding = normalizeScope(scope);
      validateRevision(currentRevision);
      return mutate((journal, time) => {
        const record = find(journal, requestId);
        if (PRE_APPLY.has(record.state) && record.claim?.expiresAt <= time) record.claim = null;
        if (!verified || !PRE_APPLY.has(record.state) || record.claim
          || record.scope.sessionIdentity !== previousSessionIdentity
          || binding.sessionIdentity === previousSessionIdentity
          || !sameBinaryScope(record.scope, binding)) throw queueError("QUEUE_REBIND_REJECTED");
        if (record.bindingHistory.length >= 8) throw queueError("QUEUE_REBIND_LIMIT");
        record.bindingHistory.push({ sessionIdentity: record.scope.sessionIdentity, baselineRevision: record.baselineRevision, reboundAt: time });
        record.scope = binding; record.baselineRevision = currentRevision;
        record.preparedPatch = null; record.proof = null; record.state = "queued";
        record.reasonCode = ""; record.updatedAt = time;
        return record;
      });
    },
  });
}

function sweepJournal(journal, time, scope = null) {
  const result = { expired: 0, uncertain: 0, reclaimed: 0 };
  for (const record of journal.records) {
    if ((scope && !scopeMatches(record.scope, scope)) || TERMINAL.has(record.state)) continue;
    if (record.claim && record.claim.expiresAt <= time) {
      if (record.state === "applying" || record.state === "applied") {
        record.state = "uncertain"; record.reasonCode = "QUEUE_APPLY_INTERRUPTED"; result.uncertain += 1;
      } else { record.state = record.preparedPatch ? "waiting-for-device" : "queued"; result.reclaimed += 1; }
      record.claim = null; record.updatedAt = time;
    }
    if (record.expiresAt <= time && !TERMINAL.has(record.state)) {
      const uncertain = record.state === "applying" || record.state === "applied";
      record.state = uncertain ? "uncertain" : "expired";
      record.reasonCode = uncertain ? "QUEUE_APPLY_INTERRUPTED" : "QUEUE_EXPIRED";
      record.claim = null; record.updatedAt = time;
      result[uncertain ? "uncertain" : "expired"] += 1;
    }
  }
  return result;
}

function pruneExpiredHistory(journal, time) {
  journal.processRebases = journal.processRebases.filter((item) => item.expiresAt > time);
  const referenced = new Set(journal.records.filter((item) => !TERMINAL.has(item.state)).map((item) => item.predecessorRequestId));
  const retained = new Set(journal.records.filter((item) => item.expiresAt > time || !TERMINAL.has(item.state) || unresolvedEffect(item)).map((item) => item.requestId));
  for (const marker of journal.processRebases) if (marker.requestId) retained.add(marker.requestId);
  // A later accepted request can outlive the cumulative request it points to.
  // Keep each reachable target so status remains defined through its own
  // accepted lifetime, even when the replacement has already expired.
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of journal.records) {
      if (!retained.has(item.requestId)) continue;
      for (const id of [item.replacementRequestId, item.restorationRequestId]) {
        if (!id || retained.has(id)) continue;
        retained.add(id); changed = true;
      }
    }
  }
  // Expiry revokes permission to apply; it cannot erase uncertainty about an
  // effect in a still-running process. Keep that fence until receipt or a
  // verified fresh-process recovery explicitly resolves/supersedes it.
  journal.records = journal.records.filter((item) => retained.has(item.requestId) || referenced.has(item.requestId));
  const present = new Set(journal.records.map((item) => item.requestId));
  for (const item of journal.records) if (TERMINAL.has(item.state) && !present.has(item.predecessorRequestId)) item.predecessorRequestId = "";
}

function unresolvedEffect(record) {
  return ["uncertain", "applying", "applied"].includes(record.state)
    || (record.state === "superseded" && ["uncertain", "applying", "applied"].includes(record.supersededState) && record.proof?.refreshed !== true);
}

function normalizeBinaryScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw queueError("QUEUE_SCOPE_INVALID");
  const binding = {};
  for (const field of SCOPE_FIELDS.filter((item) => item !== "sessionIdentity")) {
    if (typeof scope[field] !== "string" || !scope[field] || scope[field].length > 4096) throw queueError("QUEUE_SCOPE_INVALID");
    binding[field] = scope[field];
  }
  return binding;
}
function retainOriginalBaselines(journal, scope, files, time) {
  let baseline = journal.binaryBaselines.find((item) => sameBinaryScope(item.scope, scope));
  if (!baseline) {
    if (journal.binaryBaselines.length >= LIMITS.records) throw queueError("QUEUE_LIMIT_REACHED");
    baseline = { scope: normalizeBinaryScope(scope), files: [], createdAt: time, updatedAt: time };
    journal.binaryBaselines.push(baseline);
  }
  for (const file of files) {
    if (baseline.files.some((item) => item.path === file.path)) continue;
    // The composition root verifies the first source against the captured
    // Debug binary before enqueue. Existing intent cannot be used to guess a
    // missing original baseline from an intermediate implementation snapshot.
    if (journal.records.some((record) => sameBinaryScope(record.scope, scope) && record.files.some((item) => item.path === file.path))) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
    baseline.files.push({ path: file.path, beforeSource: file.beforeSource, beforeHash: file.beforeHash });
    baseline.updatedAt = time;
  }
  baseline.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function pruneOriginalBaselines(journal, time, preserveScope = null) {
  journal.binaryBaselines = journal.binaryBaselines.filter((baseline) =>
    (preserveScope && sameBinaryScope(preserveScope, baseline.scope))
    || journal.records.some((record) => sameBinaryScope(record.scope, baseline.scope))
    || journal.desiredStates.some((desired) => !desired.revoked && sameBinaryScope(desired.scope, baseline.scope))
    || journal.processRebases.some((marker) => marker.expiresAt > time && sameBinaryScope(marker.scope, baseline.scope)));
}

function replaceDesired(journal, value) {
  const index = journal.desiredStates.findIndex((item) => sameBinaryScope(item.scope, value.scope));
  if (index < 0) {
    if (journal.desiredStates.length >= LIMITS.records) throw queueError("QUEUE_LIMIT_REACHED");
    journal.desiredStates.push(value);
  } else journal.desiredStates[index] = value;
}
function assertDesiredCapacity(journal, scope, incoming, time) {
  const desired = journal.desiredStates.find((item) => sameBinaryScope(item.scope, scope));
  const original = journal.binaryBaselines.find((item) => sameBinaryScope(item.scope, scope));
  const files = new Map((desired && !desired.revoked ? desired.files : []).map((file) => [file.path, clone(file)]));
  const history = journal.records.filter((record) => sameBinaryScope(record.scope, scope)
    && record.sequence > (desired?.confirmedThroughSequence || 0) && record.expiresAt > time
    && !["expired", "failed", "superseded"].includes(record.state));
  for (const file of [...history.flatMap((record) => record.desiredSnapshots || record.files), ...incoming]) {
    const baseline = original?.files.find((item) => item.path === file.path);
    if (!baseline || baseline.beforeHash !== sha(baseline.beforeSource)) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
    files.set(file.path, { path: file.path, beforeSource: baseline.beforeSource, afterSource: file.afterSource });
  }
  // Bound the eventual cumulative recovery BEFORE admitting another request.
  // Splitting a large desired state into small offline deltas cannot defer a
  // size failure until after a native patch has already changed the process.
  return normalizeFiles([...files.values()]);
}
function assertJournalPublicationCapacity(journal, time) {
  const projected = clone(journal);
  const candidates = journal.records.filter((record) => record.expiresAt > time && (PRE_APPLY.has(record.state) || ["applying", "applied", "uncertain"].includes(record.state)));
  const lanes = new Map(candidates.map((record) => [digest(normalizeBinaryScope(record.scope)), record]));
  let receiptReserve = 0;
  for (const record of candidates) {
    receiptReserve += 1024 + 2 * Buffer.byteLength(JSON.stringify({ requestId: record.requestId, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity, patchDigest: record.preparedPatch?.patchDigest || "0".repeat(64) }));
    if (record.preparedPatch?.replacementProof) receiptReserve += 2 * 65_536;
  }
  for (const record of lanes.values()) {
    const previous = projected.desiredStates.find((item) => sameBinaryScope(item.scope, record.scope));
    if (previous && record.sequence <= previous.confirmedThroughSequence) continue;
    const files = assertDesiredCapacity(journal, record.scope, [], time);
    // This is a byte-capacity projection, never persisted or treated as proof.
    // Reserve cumulative desired sources for ALL pending binary lanes, not
    // merely the delta that happens to fit in the journal at enqueue time.
    replaceDesired(projected, { scope: record.scope, files, confirmedThroughSequence: record.sequence, sourceRequestId: record.requestId, proof: null, confirmation: "refreshed", revoked: false, createdAt: previous?.createdAt ?? time, updatedAt: time });
  }
  if (Buffer.byteLength(JSON.stringify(projected)) + receiptReserve > LIMITS.journalBytes) throw queueError("QUEUE_LIMIT_REACHED");
}
function retainDesiredState(journal, record, time) {
  const previous = journal.desiredStates.find((item) => sameBinaryScope(item.scope, record.scope));
  if (previous && previous.confirmedThroughSequence >= record.sequence) return;
  const original = journal.binaryBaselines.find((item) => sameBinaryScope(item.scope, record.scope));
  const files = new Map((previous && !previous.revoked ? previous.files : []).map((file) => [file.path, clone(file)]));
  for (const file of record.desiredSnapshots || record.files) {
    const baseline = original?.files.find((item) => item.path === file.path);
    if (!baseline || baseline.beforeHash !== sha(baseline.beforeSource)) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
    files.set(file.path, { path: file.path, beforeSource: baseline.beforeSource, afterSource: file.afterSource });
  }
  const snapshots = normalizeFiles([...files.values()]);
  replaceDesired(journal, {
    scope: clone(record.scope), files: snapshots, confirmedThroughSequence: record.sequence,
    sourceRequestId: record.requestId, proof: clone(record.proof), confirmation: "refreshed", revoked: false,
    createdAt: previous?.createdAt ?? time, updatedAt: time,
  });
}
function retainBaselineDesire(journal, record, time) {
  const previous = journal.desiredStates.find((item) => sameBinaryScope(item.scope, record.scope));
  replaceDesired(journal, {
    scope: clone(record.scope), files: normalizeFiles(record.files), confirmedThroughSequence: record.sequence,
    sourceRequestId: record.sourceRequestId, proof: null, confirmation: "verified-binary-baseline", revoked: false,
    createdAt: previous?.createdAt ?? time, updatedAt: time,
  });
}

function normalizeScope(scope) {
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw queueError("QUEUE_SCOPE_INVALID");
  const binding = {};
  for (const field of SCOPE_FIELDS) {
    if (typeof scope[field] !== "string" || !scope[field] || scope[field].length > 4096) throw queueError("QUEUE_SCOPE_INVALID");
    binding[field] = scope[field];
  }
  return binding;
}
function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > LIMITS.files) throw queueError("QUEUE_SNAPSHOT_INVALID");
  const seen = new Set(); let bytes = 0;
  const snapshots = files.map((file) => {
    if (!file || typeof file.path !== "string" || !file.path || file.path.length > 4096
      || typeof file.beforeSource !== "string" || typeof file.afterSource !== "string" || seen.has(file.path)) throw queueError("QUEUE_SNAPSHOT_INVALID");
    seen.add(file.path);
    const beforeBytes = Buffer.byteLength(file.beforeSource); const afterBytes = Buffer.byteLength(file.afterSource);
    bytes += beforeBytes + afterBytes;
    if (beforeBytes > LIMITS.fileBytes || afterBytes > LIMITS.fileBytes || bytes > LIMITS.requestBytes) throw queueError("QUEUE_LIMIT_REACHED");
    return { path: file.path, beforeSource: file.beforeSource, afterSource: file.afterSource, beforeHash: sha(file.beforeSource), afterHash: sha(file.afterSource) };
  });
  return snapshots.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
function validateNoEffectReceipt(record, receipt) {
  const allowedKeys = new Set(["requestId", "patchDigest", "sessionIdentity", "binaryIdentity", "admitted", "applied", "reasonCode", "attemptId"]);
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)
    || Object.keys(receipt).some((key) => !allowedKeys.has(key))
    || receipt.requestId !== record.requestId || receipt.sessionIdentity !== record.scope.sessionIdentity
    || receipt.binaryIdentity !== record.scope.binaryIdentity
    || typeof record.preparedPatch?.patchDigest !== "string" || !record.preparedPatch.patchDigest
    || receipt.patchDigest !== record.preparedPatch.patchDigest
    || receipt.attemptId !== record.applyClaimToken
    || receipt.admitted !== false || receipt.applied !== false
    || !["PREPARED_WAITING_FOR_FOREGROUND", "PREPARED_ROOT_NOT_READY"].includes(receipt.reasonCode)) throw queueError("QUEUE_NO_EFFECT_REJECTED");
}
function validateProof(record, proof, refreshed) {
  if (!record.preparedPatch || !proof || proof.requestId !== record.requestId || proof.sessionIdentity !== record.scope.sessionIdentity
    || proof.binaryIdentity !== record.scope.binaryIdentity || proof.applied !== true
    || !Number.isSafeInteger(proof.revision) || proof.revision <= record.baselineRevision
    || (refreshed && proof.refreshed !== true)
    || (record.preparedPatch.patchDigest && proof.patchDigest !== record.preparedPatch.patchDigest)) throw queueError("QUEUE_PROOF_INVALID");
  if (record.preparedPatch.replacementProof && (Buffer.byteLength(JSON.stringify(proof.replacementCoverage || {})) > 65_536
    || !verifyReplacementProofReceipt({ expected: record.preparedPatch.replacementProof, report: proof.replacementCoverage,
      attemptId: record.applyClaimToken || record.claim?.token }))) throw queueError("QUEUE_PROOF_INVALID");
}
function validateJournal(journal) {
  if (!journal || journal.schemaVersion !== 1 || !Number.isSafeInteger(journal.nextSequence)
    || !Array.isArray(journal.records) || journal.records.length > LIMITS.records
    || !Array.isArray(journal.processRebases) || journal.processRebases.length > LIMITS.records
    || !Array.isArray(journal.binaryBaselines) || journal.binaryBaselines.length > LIMITS.records
    || (journal.desiredStates !== undefined && (!Array.isArray(journal.desiredStates) || journal.desiredStates.length > LIMITS.records))) throw queueError("QUEUE_JOURNAL_INVALID");
  const ids = new Set(); let sequence = 0;
  try {
    for (const record of journal.records) {
      validateId(record.requestId);
      if (ids.has(record.requestId) || !Number.isSafeInteger(record.sequence) || record.sequence <= sequence) throw queueError("QUEUE_JOURNAL_INVALID");
      ids.add(record.requestId); sequence = record.sequence;
      normalizeScope(record.scope); validateRevision(record.baselineRevision);
      const snapshots = normalizeFiles(record.files);
      if (record.schemaVersion !== 1 || record.snapshotDigest !== digest(snapshots)
        || !LIVE_DELIVERY_STATES.includes(record.state) || !Array.isArray(record.bindingHistory)
        || !Number.isSafeInteger(record.createdAt) || record.createdAt < 0 || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < record.createdAt || !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= record.createdAt
        || typeof record.predecessorRequestId !== "string"
        || (record.preparedPatch !== null && (typeof record.preparedPatch !== "object" || Array.isArray(record.preparedPatch)))) throw queueError("QUEUE_JOURNAL_INVALID");
      for (let index = 0; index < snapshots.length; index += 1) {
        if (snapshots[index].beforeHash !== record.files[index].beforeHash || snapshots[index].afterHash !== record.files[index].afterHash) throw queueError("QUEUE_JOURNAL_INVALID");
      }
      if (record.desiredSnapshots !== undefined) {
        const desired = normalizeFiles(record.desiredSnapshots);
        if (record.desiredSnapshotDigest !== digest(desired)) throw queueError("QUEUE_JOURNAL_INVALID");
        for (const file of desired) {
          const compiled = snapshots.find((item) => item.path === file.path);
          if (compiled ? compiled.beforeHash !== file.beforeHash || compiled.afterHash !== file.afterHash : file.beforeHash !== file.afterHash) throw queueError("QUEUE_JOURNAL_INVALID");
        }
        if (snapshots.some((file) => !desired.some((item) => item.path === file.path))) throw queueError("QUEUE_JOURNAL_INVALID");
      }
      if (record.supersededState !== undefined && (!LIVE_DELIVERY_STATES.includes(record.supersededState) || record.state !== "superseded")) throw queueError("QUEUE_JOURNAL_INVALID");
      if (record.restorationRequestId !== undefined && typeof record.restorationRequestId !== "string") throw queueError("QUEUE_JOURNAL_INVALID");
      if (record.restorationNoChange) {
        normalizeScope(record.restorationNoChange.scope);
        if (!Number.isSafeInteger(record.restorationNoChange.observedAt)) throw queueError("QUEUE_JOURNAL_INVALID");
      }
      if (record.claim !== null) {
        validateId(record.claim.token); validateId(record.claim.workerId);
        if (!Number.isSafeInteger(record.claim.expiresAt) || TERMINAL.has(record.state)) throw queueError("QUEUE_JOURNAL_INVALID");
      }
      if ((record.state === "compiling" || record.state === "applying") && !record.claim) throw queueError("QUEUE_JOURNAL_INVALID");
      if (record.state === "applied" || record.state === "refreshed") validateProof(record, record.proof, record.state === "refreshed");
    }
    const desiredScopes = new Set();
    for (const desired of journal.desiredStates || []) {
      normalizeScope(desired.scope);
      const key = digest(normalizeBinaryScope(desired.scope));
      if (desiredScopes.has(key) || !Number.isSafeInteger(desired.confirmedThroughSequence) || desired.confirmedThroughSequence < 0 || desired.confirmedThroughSequence >= journal.nextSequence
        || !Number.isSafeInteger(desired.createdAt) || desired.createdAt < 0 || !Number.isSafeInteger(desired.updatedAt) || desired.updatedAt < desired.createdAt
        || typeof desired.revoked !== "boolean" || !Array.isArray(desired.files)) throw queueError("QUEUE_JOURNAL_INVALID");
      desiredScopes.add(key);
      if (desired.revoked) {
        if (desired.files.length || desired.proof !== null || desired.confirmation !== "revoked" || desired.sourceRequestId !== "") throw queueError("QUEUE_JOURNAL_INVALID");
        continue;
      }
      validateId(desired.sourceRequestId);
      const snapshots = normalizeFiles(desired.files);
      const baseline = journal.binaryBaselines.find((item) => sameBinaryScope(item.scope, desired.scope));
      for (let index = 0; index < snapshots.length; index += 1) {
        const file = desired.files[index];
        if (file.beforeHash !== snapshots[index].beforeHash || file.afterHash !== snapshots[index].afterHash
          || baseline?.files.find((item) => item.path === file.path)?.beforeHash !== file.beforeHash) throw queueError("QUEUE_JOURNAL_INVALID");
      }
      if (desired.confirmation === "verified-binary-baseline") {
        if (desired.proof !== null || snapshots.some((file) => file.beforeHash !== file.afterHash)) throw queueError("QUEUE_JOURNAL_INVALID");
      } else if (desired.confirmation === "refreshed") {
        const proof = desired.proof;
        if (!proof || proof.requestId !== desired.sourceRequestId || proof.sessionIdentity !== desired.scope.sessionIdentity || proof.binaryIdentity !== desired.scope.binaryIdentity
          || proof.applied !== true || proof.refreshed !== true || !Number.isSafeInteger(proof.revision) || proof.revision <= 0 || typeof proof.patchDigest !== "string" || !proof.patchDigest) throw queueError("QUEUE_JOURNAL_INVALID");
      } else throw queueError("QUEUE_JOURNAL_INVALID");
    }
    const binaryScopes = new Set();
    for (const baseline of journal.binaryBaselines) {
      const key = digest(normalizeBinaryScope(baseline.scope));
      if (binaryScopes.has(key) || !Array.isArray(baseline.files) || !baseline.files.length || baseline.files.length > LIMITS.records * LIMITS.files) throw queueError("QUEUE_JOURNAL_INVALID");
      binaryScopes.add(key);
      const paths = new Set();
      for (const file of baseline.files) {
        if (typeof file.path !== "string" || !file.path || file.path.length > 4096 || paths.has(file.path)
          || typeof file.beforeSource !== "string" || Buffer.byteLength(file.beforeSource) > LIMITS.fileBytes
          || file.beforeHash !== sha(file.beforeSource)) throw queueError("QUEUE_JOURNAL_INVALID");
        paths.add(file.path);
      }
    }
    const reboundScopes = new Set();
    for (const marker of journal.processRebases) {
      const scope = normalizeScope(marker.scope); const key = digest(scope);
      if (reboundScopes.has(key) || typeof marker.netNoChange !== "boolean" || !Array.isArray(marker.supersededRequestIds)
        || !Number.isSafeInteger(marker.createdAt) || !Number.isSafeInteger(marker.expiresAt) || marker.expiresAt <= marker.createdAt
        || (marker.requestId !== null && (!ids.has(marker.requestId) || marker.netNoChange))
        || (marker.requestId === null && !marker.netNoChange)) throw queueError("QUEUE_JOURNAL_INVALID");
      if (marker.requestId && !scopeMatches(journal.records.find((record) => record.requestId === marker.requestId).scope, scope)) throw queueError("QUEUE_JOURNAL_INVALID");
      reboundScopes.add(key);
      for (const id of marker.supersededRequestIds) validateId(id);
    }
    if (journal.nextSequence <= sequence) throw queueError("QUEUE_JOURNAL_INVALID");
    for (const record of journal.records) if (record.predecessorRequestId && !ids.has(record.predecessorRequestId)) throw queueError("QUEUE_JOURNAL_INVALID");
  } catch { throw queueError("QUEUE_JOURNAL_INVALID"); }
}
function assertPrivatePath(path, kind) {
  let stats;
  try { stats = lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw queueError("QUEUE_JOURNAL_UNREADABLE"); }
  if (stats.isSymbolicLink() || (kind === "directory" ? !stats.isDirectory() : !stats.isFile())
    || (stats.mode & 0o077) !== 0 || (typeof process.getuid === "function" && stats.uid !== process.getuid())) throw queueError("QUEUE_JOURNAL_UNSAFE");
  return stats;
}
function validateId(value) { if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value)) throw queueError("QUEUE_REQUEST_INVALID"); }
function validateRevision(value) { if (!Number.isSafeInteger(value) || value < 0) throw queueError("QUEUE_REVISION_INVALID"); }
function parseExpiry(value) { const time = typeof value === "number" ? value : Date.parse(value); if (!Number.isSafeInteger(time)) throw queueError("QUEUE_EXPIRY_INVALID"); return time; }
function scopeMatches(a, b) { return SCOPE_FIELDS.every((field) => a[field] === b[field]); }
function sameBinaryScope(a, b) { return SCOPE_FIELDS.filter((field) => field !== "sessionIdentity").every((field) => a[field] === b[field]); }
function safeReason(value) { return /^[A-Z0-9_]{0,80}$/.test(String(value)) ? String(value) : "QUEUE_OPERATION_FAILED"; }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function digest(value) { return sha(JSON.stringify(value)); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function queueError(code) { return Object.assign(new Error(`Swift Sim live delivery journal: ${code}.`), { code }); }
