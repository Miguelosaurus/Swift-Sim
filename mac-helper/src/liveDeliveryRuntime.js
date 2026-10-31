import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { deliveryEnvelope } from "./changeDeliveryContract.js";

const INCOMPLETE = new Set(["queued", "compiling", "waiting-for-device", "waiting-for-foreground", "applying", "applied"]);

// The helper owns polling; one-shot callers only publish immutable intent and
// optionally take one turn. There is no signed-build adapter in this service.
export function createLiveDeliveryRuntime({ queue = createLiveDeliveryQueue(), adapter, workerId = randomUUID(), now = () => Date.now() } = {}) {
  if (!adapter) throw new TypeError("A live delivery adapter is required.");
  let running;
  let stopping = false;
  const cancellation = new AbortController();
  let lastCleanup = -Infinity;

  async function enqueue({ files, project = "", scheme = "", host = "", requestId } = {}) {
    const binding = await adapter.binding({ project, scheme, host });
    let history = queue.list().filter((record) => sameBinary(record.scope, binding.scope));
    const desires = queue.desiredStates().filter((item) => sameBinary(item.scope, binding.scope));
    if (binding.verifiedProcess && binding.revision === 0 && (history.length || desires.length) && !history.some((record) => record.scope.sessionIdentity === binding.scope.sessionIdentity)
      && !desires.some((item) => item.scope.sessionIdentity === binding.scope.sessionIdentity)) {
      await queue.rebaseForProcess({ scope: binding.scope, currentRevision: 0, verified: true });
      history = queue.list().filter((record) => sameBinary(record.scope, binding.scope));
    }
    const previous = history.findLast((record) => record.expiresAt > now() && (!binding.verifiedProcess || sameScope(record.scope, binding.scope)) && !["expired", "superseded", "failed"].includes(record.state));
    const scope = { ...binding.scope, sessionIdentity: binding.verifiedProcess ? binding.scope.sessionIdentity : previous?.scope.sessionIdentity || binding.scope.sessionIdentity };
    const snapshots = files.map((file) => ({
      path: resolve(file.path || file.afterPath),
      beforeSource: String(file.beforeSource ?? readFileSync(file.beforePath, "utf8")),
      afterSource: String(file.afterSource ?? readFileSync(file.afterPath, "utf8")),
    }));
    for (const snapshot of snapshots) {
      const prior = history.flatMap((record) => record.files).findLast((file) => file.path === snapshot.path);
      const desired = queue.desiredStates().find((item) => sameBinary(item.scope, scope))?.files.find((file) => file.path === snapshot.path);
      const expected = prior?.afterHash || desired?.afterHash || binding.sourceBaselines?.[snapshot.path];
      if (!expected || createHash("sha256").update(snapshot.beforeSource).digest("hex") !== expected) throw Object.assign(new Error("The edit's source baseline differs from the qualified Debug build or queued predecessor. No rebuild was started."), { code: "LIVE_SOURCE_BASELINE_MISMATCH" });
      if (binding.verifiedProcess && binding.revision === 0 && !previous) {
        const original = queue.binaryBaseline(scope, snapshot.path);
        if (original) snapshot.beforeSource = original.beforeSource;
        if (createHash("sha256").update(snapshot.beforeSource).digest("hex") !== binding.sourceBaselines?.[snapshot.path]) throw Object.assign(new Error("The qualified original source baseline is unavailable for this fresh process."), { code: "LIVE_SOURCE_BASELINE_MISMATCH" });
      }
    }
    const record = await queue.enqueue({ ...(requestId ? { requestId } : {}), scope, files: snapshots, baselineRevision: previous?.proof?.revision || binding.revision || 0 });
    return projectLiveDelivery(record);
  }

  function status(requestId) {
    let record = queue.get(requestId);
    if (!record) throw Object.assign(new Error("The live delivery request was not found."), { code: "QUEUE_REQUEST_NOT_FOUND" });
    const visited = new Set();
    while ((record.state === "superseded" && record.replacementRequestId) || record.restorationRequestId) {
      if (visited.has(record.requestId) || visited.size >= 256) throw new Error("Invalid live delivery replacement chain.");
      visited.add(record.requestId); record = queue.get(record.restorationRequestId || record.replacementRequestId);
      if (!record) throw new Error("The live delivery replacement is missing.");
    }
    if ((record.state === "superseded" && record.reasonCode === "QUEUE_NET_NO_CHANGE") || record.restorationNoChange) return deliveryEnvelope({ outcome: "no-change", message: "The queued edits cancel each other; the fresh Debug process already contains that baseline." });
    const result = projectLiveDelivery(record);
    if (visited.size && result.delivery) result.delivery.supersededRequestId = requestId;
    return result;
  }

  function runOnce() {
    if (stopping) return Promise.resolve({ processed: false });
    if (running) return running;
    running = tick().finally(() => { running = null; });
    return running;
  }

  async function tick() {
    let snapshot = queue.pollingSnapshot();
    if (!snapshot.records.length && !snapshot.desires.length) return { processed: false };
    if (snapshot.nextSweepAt <= now()) {
      await queue.sweepExpired();
      snapshot = queue.pollingSnapshot();
    }
    if (adapter.cleanup && now() - lastCleanup >= 60_000) {
      await adapter.cleanup(snapshot.records, { now: now() }); lastCleanup = now();
    }
    const records = snapshot.records.filter((record) => ["applying", "applied", "uncertain"].includes(record.state)
      || (record.expiresAt > now() && (INCOMPLETE.has(record.state) || record.state === "refreshed")));
    const desires = snapshot.desires;
    if (!records.length && !desires.length) return { processed: false };
    const operation = async () => {
      if (stopping) return { processed: false };
      // The engine watches one project. Inspect each distinct lane at most once
      // per bounded helper turn, without Xcode/network/signing preflights.
      const lanes = new Map();
      for (const record of [...desires, ...records]) {
        const { sessionIdentity: _session, ...binary } = record.scope;
        const key = JSON.stringify(binary);
        lanes.set(key, record);
      }
      for (const first of lanes.values()) {
        if (stopping) break;
        let observed;
        try { observed = await adapter.inspect(first); } catch { continue; }
        if (!observed?.engineAvailable) continue;
        const matched = observed.matchesBinary === true;
        let scope = first.scope;
        if (matched && observed.scope?.sessionIdentity !== first.scope.sessionIdentity) {
          const hasCurrentProcess = records.some((record) => sameScope(record.scope, observed.scope));
          if (!hasCurrentProcess && observed.connected === true && observed.revision === 0) {
            try {
              await queue.rebaseForProcess({ scope: observed.scope, currentRevision: 0, verified: true });
              return { processed: true, rebound: true };
            } catch { continue; }
          }
          // Reconnection to a different nonzero process does not establish its
          // source baseline. Never carry a prior process's pending patch into it.
          if (!hasCurrentProcess) continue;
          scope = observed.scope;
        }
        // Lost acknowledgements are reconciled by receipt, never by issuing the
        // mutation again. The native ledger is scoped to the same app process.
        for (const record of records.filter((item) => ["applying", "applied", "uncertain"].includes(item.state) && sameScope(item.scope, scope))) {
          if (!matched || !record.preparedPatch?.patchDigest) continue;
          const proof = await adapter.receipt(record, observed);
          if (proof?.noEffect) {
            await queue.releaseNoEffect(record.requestId, { claimToken: record.applyClaimToken, scope, receipt: proof.noEffect, verified: true });
            return { processed: true, requestId: record.requestId };
          }
          if (proof) {
            await queue.reconcileReceipt(record.requestId, { scope, proof, verified: true });
            return { processed: true, requestId: record.requestId };
          }
        }
        const canApply = matched && observed.connected === true && observed.foreground === true && observed.rootReady === true;
        const waitingState = matched && observed.connected ? "waiting-for-foreground" : "waiting-for-device";
        if (!records.some((record) => sameScope(record.scope, scope) && INCOMPLETE.has(record.state)
          && !["applying", "applied"].includes(record.state) && !record.claim
          && (!record.preparedPatch || canApply || record.state !== waitingState))) continue;
        const record = await queue.claimNext({ scope, currentRevision: observed.revision || 0, deviceConnected: matched && observed.connected === true, foreground: matched && observed.foreground === true && observed.rootReady === true, workerId });
        if (!record) continue;
        const claimToken = record.claim.token;
        if (!record.preparedPatch) {
          try {
            const preparedPatch = await adapter.prepare(record, { cancellationSignal: cancellation.signal });
            await queue.transition(record.requestId, { claimToken, state: matched && observed.connected && (!observed.foreground || !observed.rootReady) ? "waiting-for-foreground" : "waiting-for-device", preparedPatch });
          } catch (error) {
            if (stopping) {
              await queue.transition(record.requestId, { claimToken, state: "waiting-for-device", reasonCode: "QUEUE_WORKER_STOPPED" });
              return { processed: false };
            }
            const code = safeCode(error?.code, "PATCH_COMPILE_FAILED");
            await queue.transition(record.requestId, { claimToken, state: "failed", reasonCode: code });
          }
          return { processed: true, requestId: record.requestId };
        }
        try { await adapter.validatePrepared?.(record); }
        catch (error) {
          await queue.transition(record.requestId, { claimToken, state: "failed", reasonCode: safeCode(error?.code, "PATCH_ARTIFACT_INVALID") });
          return { processed: true, requestId: record.requestId };
        }
        // Recheck immediately before persisting the applying barrier. A client
        // reconnect or new executable cannot inherit a predecessor's mutation.
        const current = await adapter.inspect(record);
        if (stopping || !current.matchesBinary || !current.connected || !current.foreground || !current.rootReady || !sameScope(current.scope, record.scope) || current.revision !== record.baselineRevision) {
          await queue.transition(record.requestId, { claimToken, state: "waiting-for-device", reasonCode: "LIVE_CONNECTION_CHANGED" });
          continue;
        }
        try {
          await queue.transition(record.requestId, { claimToken, state: "applying", scope: current.scope, currentRevision: current.revision });
        } catch (error) {
          if (error?.code !== "QUEUE_LIMIT_REACHED") throw error;
          await queue.transition(record.requestId, { claimToken, state: "failed", reasonCode: "QUEUE_LIMIT_REACHED" });
          return { processed: true, requestId: record.requestId };
        }
        try {
          const proof = await adapter.apply(record, current, { cancellationSignal: cancellation.signal });
          if (proof?.noEffect) {
            await queue.releaseNoEffect(record.requestId, { claimToken, scope: current.scope, receipt: proof.noEffect, verified: true });
          } else if (!proof) {
            await queue.transition(record.requestId, { claimToken, state: "uncertain", reasonCode: "QUEUE_APPLY_UNCONFIRMED" });
          } else {
            await queue.transition(record.requestId, { claimToken, state: proof.refreshed ? "refreshed" : "applied", proof });
          }
        } catch {
          await queue.transition(record.requestId, { claimToken, state: "uncertain", reasonCode: "QUEUE_APPLY_UNCONFIRMED" });
        }
        return { processed: true, requestId: record.requestId };
      }
      return { processed: false };
    };
    return adapter.withLock ? adapter.withLock(operation) : operation();
  }

  async function stop() {
    stopping = true; cancellation.abort();
    if (running) await running.catch(() => {});
  }
  async function revokeDesired({ project = "", scheme = "" } = {}) {
    const binding = await adapter.binding({ project, scheme });
    await queue.revokeDesired({ scope: binding.scope });
    return { revoked: true, message: "Automatic restoration and unclaimed queued edits for this Debug binary are revoked. An already running patch remains until the app restarts." };
  }
  return Object.freeze({ enqueue, status, runOnce, stop, revokeDesired, queue });
}

export function projectLiveDelivery(record) {
  const state = record.state;
  if (state === "refreshed") return deliveryEnvelope({ outcome: "hot-reloaded", message: "Hot reloaded successfully. The running Debug app acknowledged this edit and refreshed.", delivery: { kind: "live", requestId: record.requestId, revision: record.proof.revision }, timing: { totalMs: Math.max(0, record.updatedAt - record.createdAt) } });
  if (INCOMPLETE.has(state)) {
    const prepared = Boolean(record.preparedPatch);
    const normalWaiting = ["queued", "compiling", "waiting-for-device", "waiting-for-foreground"].includes(state);
    const guidanceCode = state === "applied" ? "WAIT_FOR_REFRESH" : state === "applying" ? "WAIT_FOR_APPLICATION" : prepared ? "OPEN_TARGET_APP" : "PREPARING_UPDATE";
    const message = state === "applied" ? "The edit was applied; its matching refresh acknowledgement is still pending."
      : state === "applying" ? "Swift Sim is applying this request and waiting for its matching native acknowledgement."
      : prepared ? "The update is ready and waiting for the target Debug app. Open it when ready and allow a few seconds for foreground reconnection and application. Waiting while you use another app or are offline is normal."
      : "The edit is queued and can be prepared while you use other apps. Return to the target Debug app when ready; application requires it to reconnect in the foreground.";
    return deliveryEnvelope({ outcome: "queued", message, reasonCode: record.reasonCode || "LIVE_DELIVERY_PENDING", delivery: { kind: "pending", requestId: record.requestId, state, prepared, normalWaiting, guidanceCode, requiredAppState: "foreground-ready", expiresAt: new Date(record.expiresAt).toISOString() }, timing: { totalMs: Math.max(0, record.updatedAt - record.createdAt) } });
  }
  const code = safeCode(record.reasonCode, state === "uncertain" ? "QUEUE_APPLY_UNCONFIRMED" : `QUEUE_${String(state).toUpperCase()}`);
  const message = state === "uncertain" ? "The edit's application could not be confirmed. Swift Sim will reconcile a matching receipt without applying it again."
    : code === "QUEUED_MECHANISM_UNSUPPORTED" ? "The current live compiler cannot represent every changed implementation in one complete replacement. No patch was applied; this edit needs a signed build."
    : code === "QUEUED_EDIT_NOT_COMPATIBLE" ? "The background compiler rejected this edit's compatibility. No patch was applied or app rebuild started."
    : "The queued edit did not complete. No successful hot reload is claimed.";
  return deliveryEnvelope({ outcome: "failed", message, reasonCode: code, error: { code, message }, timing: { totalMs: Math.max(0, record.updatedAt - record.createdAt) } });
}

function sameBinary(a, b) { return ["project", "scheme", "appIdentity", "binaryIdentity"].every((key) => a?.[key] === b?.[key]); }
function sameScope(a, b) { return sameBinary(a, b) && a?.sessionIdentity === b?.sessionIdentity; }
function safeCode(value, fallback) { return /^[A-Z][A-Z0-9_]{1,79}$/.test(value || "") ? value : fallback; }
