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
  let work = { phase: "idle" };

  async function enqueue({ files, project = "", scheme = "", host = "", requestId, requiresCompleteCoverage = false } = {}) {
    const binding = await adapter.binding({ project, scheme, host });
    if (requiresCompleteCoverage && binding.completeCoverage !== true) throw Object.assign(
      new Error("Private additions require the matching complete-replacement live engine. Update that component; no patch or app build was started."),
      { code: "LIVE_ENGINE_UPDATE_REQUIRED" });
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
      const prior = history.filter(record => record.expiresAt > now() && !["expired", "superseded", "failed"].includes(record.state))
        .flatMap((record) => record.files).findLast((file) => file.path === snapshot.path);
      const desired = queue.desiredStates().find((item) => sameBinary(item.scope, scope))?.files.find((file) => file.path === snapshot.path);
      const captured = binding.sourceBaselines?.[snapshot.path];
      const original = captured === undefined || (binding.verifiedProcess && binding.revision === 0 && !previous)
        ? queue.binaryBaseline(scope, snapshot.path) : null;
      // Only complete-coverage admission can introduce a file absent from the
      // installed binary, and its first snapshot must establish an empty origin.
      const emptyOrigin = requiresCompleteCoverage && captured === undefined
        && (original?.beforeSource === "" || (!original && snapshot.beforeSource === ""))
        ? createHash("sha256").update("").digest("hex") : undefined;
      const expected = prior?.afterHash || desired?.afterHash || captured || emptyOrigin;
      const beforeHash = createHash("sha256").update(snapshot.beforeSource).digest("hex");
      // Keep the latest rejected editor draft usable for an explicit correction,
      // while also accepting the unchanged installed/confirmed source. A failure
      // before admission does not prove that draft was installed on the phone.
      const latest = history.findLast(record => record.expiresAt > now() && !["expired", "superseded"].includes(record.state)
        && record.files.some(file => file.path === snapshot.path));
      const rejectedDraft = latest?.state === "failed" && latest.files.find(file => file.path === snapshot.path)?.afterHash === beforeHash;
      if (!expected || (beforeHash !== expected && !rejectedDraft)) throw Object.assign(new Error("The edit's source baseline differs from the qualified Debug build or queued predecessor. No rebuild was started."), { code: "LIVE_SOURCE_BASELINE_MISMATCH" });
      if (beforeHash !== expected && rejectedDraft) {
        // Normalize before admission, not after snapshot publication. Compile
        // all of the corrected desired source against the actual effective
        // predecessor, including draft changes never applied by the failed job.
        const effective = prior?.afterSource ?? desired?.afterSource ?? queue.binaryBaseline(scope, snapshot.path)?.beforeSource;
        if (typeof effective !== "string" || createHash("sha256").update(effective).digest("hex") !== expected)
          throw Object.assign(new Error("The effective source for the rejected draft is unavailable."), { code: "LIVE_SOURCE_BASELINE_MISMATCH" });
        snapshot.beforeSource = effective;
      }
      if (binding.verifiedProcess && binding.revision === 0 && !previous) {
        if (original) snapshot.beforeSource = original.beforeSource;
        if (createHash("sha256").update(snapshot.beforeSource).digest("hex") !== (captured || emptyOrigin)) throw Object.assign(new Error("The qualified original source baseline is unavailable for this fresh process."), { code: "LIVE_SOURCE_BASELINE_MISMATCH" });
      }
    }
    const record = await queue.enqueue({ ...(requestId ? { requestId } : {}), scope, files: snapshots, baselineRevision: previous?.proof?.revision || binding.revision || 0 });
    return projectLiveDelivery(record, queue.readiness?.(record));
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
    const result = projectLiveDelivery(record, queue.readiness?.(record));
    if (visited.size && result.delivery) result.delivery.supersededRequestId = requestId;
    return result;
  }

  function runOnce() {
    if (stopping) return Promise.resolve({ processed: false });
    const heartbeat = queue.observeWorker?.({ workerId, ...work }).catch(() => {});
    if (running) { const active = running; return heartbeat ? heartbeat.then(() => active) : active; }
    running = Promise.resolve(heartbeat).then(tick).finally(() => { running = null; });
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
        try { observed = await adapter.inspect(first); }
        catch (error) {
          const code = error?.code === "LIVE_BINARY_PROVENANCE_REQUIRED" ? "LIVE_CAPTURE_UNAVAILABLE" : "LIVE_ENGINE_UNAVAILABLE";
          await queue.observeWorker?.({ workerId, scope: first.scope, code }).catch(() => {});
          continue;
        }
        const code = observed.captureMatches === false ? "LIVE_CAPTURE_MISMATCH"
          : !observed.engineAvailable ? (observed.engineReachable ? "LIVE_ENGINE_UPDATE_REQUIRED" : "LIVE_ENGINE_UNAVAILABLE")
          : !first.preparedPatch && observed.compilerReady === false ? "LIVE_COMPILER_CONTEXT_UNAVAILABLE"
          : !first.preparedPatch && observed.signingReady === false ? "LIVE_SIGNING_UNAVAILABLE"
          : first.preparedPatch?.replacementProof && !observed.completeEngine ? "LIVE_ENGINE_UPDATE_REQUIRED"
          : observed.completeEngine && observed.clientPresent && observed.completeClient === false ? "LIVE_CLIENT_UPDATE_REQUIRED"
          : observed.clientPresent && observed.supportsReceipts === false ? "LIVE_CLIENT_UPDATE_REQUIRED"
          : observed.clientPresent && !observed.matchesBinary ? "LIVE_TARGET_APP_MISMATCH"
          : "LIVE_READY";
        await queue.observeWorker?.({ workerId, scope: first.scope, code, engineReachable: observed.engineReachable === true || observed.engineAvailable === true }).catch(() => {});
        if (code !== "LIVE_READY" && !["LIVE_COMPILER_CONTEXT_UNAVAILABLE", "LIVE_SIGNING_UNAVAILABLE"].includes(code)) continue;
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
        // A compiler/signing fault cannot prevent reconciliation or application
        // of bytes already prepared and verified for this exact request.
        if (code !== "LIVE_READY") {
          const next = records.find((record) => sameScope(record.scope, scope) && INCOMPLETE.has(record.state)
            && !["applying", "applied"].includes(record.state) && !record.claim && (!record.preparedPatch || canApply));
          if (!next?.preparedPatch) continue;
        }
        if (!records.some((record) => sameScope(record.scope, scope) && INCOMPLETE.has(record.state)
          && !["applying", "applied"].includes(record.state) && !record.claim
          && (!record.preparedPatch || canApply || record.state !== waitingState))) continue;
        const record = await queue.claimNext({ scope, currentRevision: observed.revision || 0, deviceConnected: matched && observed.connected === true, foreground: matched && observed.foreground === true && observed.rootReady === true, workerId });
        if (!record) continue;
        const claimToken = record.claim.token;
        if (!record.preparedPatch) {
          // This phase is bounded diagnostic metadata, never a lease extension.
          work = { phase: "compiling", activeRequestId: record.requestId, phaseDeadlineAt: now() + 180_000 };
          await queue.observeWorker?.({ workerId, ...work }).catch(() => {});
          try {
            const preparedPatch = await adapter.prepare(queue.compilationRecord?.(record.requestId) || record, { cancellationSignal: cancellation.signal });
            await queue.transition(record.requestId, { claimToken, state: matched && observed.connected && (!observed.foreground || !observed.rootReady) ? "waiting-for-foreground" : "waiting-for-device", preparedPatch });
          } catch (error) {
            if (stopping) {
              await queue.transition(record.requestId, { claimToken, state: "waiting-for-device", reasonCode: "QUEUE_WORKER_STOPPED" });
              return { processed: false };
            }
            const code = safeCode(error?.code, "PATCH_COMPILE_FAILED");
            await queue.transition(record.requestId, { claimToken, state: "failed", reasonCode: code });
          } finally {
            work = { phase: "idle" };
            await queue.observeWorker?.({ workerId, ...work }).catch(() => {});
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
    await queue.observeWorker?.({ workerId, active: false }).catch(() => {});
  }
  async function revokeDesired({ project = "", scheme = "" } = {}) {
    const binding = await adapter.binding({ project, scheme });
    await queue.revokeDesired({ scope: binding.scope });
    return { revoked: true, message: "Automatic restoration and unclaimed queued edits for this Debug binary are revoked. An already running patch remains until the app restarts." };
  }
  return Object.freeze({ enqueue, status, runOnce, stop, revokeDesired, queue });
}

export function projectLiveDelivery(record, readiness) {
  const state = record.state;
  if (state === "refreshed") return deliveryEnvelope({ outcome: "hot-reloaded", message: "Hot reloaded successfully. The running Debug app acknowledged this edit and refreshed.", delivery: { kind: "live", requestId: record.requestId, revision: record.proof.revision }, timing: { totalMs: Math.max(0, record.updatedAt - record.createdAt) } });
  if (INCOMPLETE.has(state)) {
    const prepared = Boolean(record.preparedPatch);
    const readinessFault = readiness && !["LIVE_READY", "LIVE_PREPARING", "LIVE_READINESS_CHECKING"].includes(readiness.code);
    const normalWaiting = !readinessFault && ["queued", "compiling", "waiting-for-device", "waiting-for-foreground"].includes(state);
    const guidanceCode = readinessFault ? (["LIVE_CAPTURE_MISMATCH", "LIVE_TARGET_APP_MISMATCH"].includes(readiness.code) ? "CHECK_MATCHING_BUILD" : "CHECK_MAC") : state === "applied" ? "WAIT_FOR_REFRESH" : state === "applying" ? "WAIT_FOR_APPLICATION" : prepared ? "OPEN_TARGET_APP" : "PREPARING_UPDATE";
    const message = readinessFault ? readinessMessage(readiness.code)
      : state === "applied" ? "The edit was applied; its matching refresh acknowledgement is still pending."
      : state === "applying" ? "Swift Sim is applying this request and waiting for its matching native acknowledgement."
      : prepared ? "The update is ready and waiting for the target Debug app. Open it when ready and allow a few seconds for foreground reconnection and application. Waiting while you use another app or are offline is normal."
      : "The edit is queued and can be prepared while you use other apps. Return to the target Debug app when ready; application requires it to reconnect in the foreground.";
    return deliveryEnvelope({ outcome: "queued", message, reasonCode: readinessFault ? readiness.code : record.reasonCode || "LIVE_DELIVERY_PENDING", delivery: { kind: "pending", requestId: record.requestId, state, prepared, normalWaiting, guidanceCode, ...(readiness ? { readiness } : {}), requiredAppState: "foreground-ready", expiresAt: new Date(record.expiresAt).toISOString() }, timing: { totalMs: Math.max(0, record.updatedAt - record.createdAt) } });
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

function readinessMessage(code) {
  if (code === "LIVE_CAPTURE_UNAVAILABLE") return "The Mac cannot read the qualified build capture for this request. Check Swift Sim live status and restore the matching build capture on the Mac. Prepared bytes alone cannot authorize delivery; the request is preserved. Do not submit it again.";
  if (code === "LIVE_CAPTURE_MISMATCH") return "This request belongs to a different Debug build than the Mac's current compiler capture. Check the matching build on the Mac; opening the phone app alone cannot resolve this. The request is preserved; do not submit it again.";
  if (code === "LIVE_TARGET_APP_MISMATCH") return "A different Debug app or version is connected. Open the exact Debug build for this request. No patch was applied to the other app; do not submit the request again.";
  if (code === "LIVE_COMPILER_CONTEXT_UNAVAILABLE") return "The Mac is missing the qualified compiler context for this Debug build. Check Swift Sim live status and restore its existing build context on the Mac. The request is preserved; do not rebuild or submit again automatically.";
  if (code === "LIVE_SIGNING_UNAVAILABLE") return "The Mac's hot reload signing is not ready. Check Swift Sim live status and signing on the Mac. The request is preserved; opening the phone app will not fix signing. Do not submit it again.";
  if (code === "LIVE_ENGINE_UPDATE_REQUIRED" || code === "LIVE_CLIENT_UPDATE_REQUIRED") return "The live engine and Debug app need matching hot reload support. Check Swift Sim live status on the Mac before updating the required component. The request is preserved; do not submit it again.";
  if (code === "LIVE_WORKER_UNAVAILABLE") return "The delivery worker's heartbeat is absent or stale. Check that the Swift Sim helper is running on the Mac. The request is preserved; waiting for the phone alone will not resolve this. Do not submit it again.";
  if (code === "LIVE_ENGINE_OBSERVATION_STALE") return "The delivery worker has not checked the live engine recently. Check Swift Sim live status on the Mac; engine readiness is currently unconfirmed. The request is preserved; do not submit it again.";
  if (code === "LIVE_READINESS_UNAVAILABLE") return "Swift Sim could not read its delivery readiness diagnostics. Check the helper and live status on the Mac. Delivery is unconfirmed; do not submit this request again.";
  return "The Mac's live engine is unavailable or unreachable. Check Swift Sim live status and restore the engine on the Mac. The request is preserved; opening the phone app alone will not resolve this. Do not submit it again.";
}
