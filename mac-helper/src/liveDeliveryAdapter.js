import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalProjectPath } from "./liveSessionDescriptor.js";
import { normalizedLiveBinaryIdentity, liveBinaryMatches } from "./liveBinaryIdentity.js";
import { prepareQueuedLivePatchAsync, cleanupQueuedLiveArtifacts, queuedLiveEngineControl, validateQueuedLivePatchCoverage, validateCompleteQueuedLivePatchCoverage, sealCompleteQueuedLivePatch, CLASSIFIER_VERSION } from "./liveReload.js";
import { normalizeReplacementProof, replacementCoverageDigest, verifyReplacementProofReceipt, REPLACEMENT_PROOF_CAPABILITY } from "./replacementProof.js";
import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";

const LIVE_ROOT = join(homedir(), ".swift-sim", "live");
const REQUIRED_CAPABILITIES = ["prepared-delivery-v1", "receipt-v1", "replacement-proof-v2"];

export function createLiveDeliveryAdapter({ manifestPath = join(LIVE_ROOT, "compilations.json"), control = queuedLiveEngineControl, compile = prepareQueuedLivePatchAsync, lock = withLiveEngineLifecycleLock, now = () => Date.now(), wait = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  let inspectionCache;
  function captureVersion() {
    const stats = lstatSync(manifestPath);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || (stats.mode & 0o077) !== 0 || stats.size > 8 * 1024 * 1024 || (process.getuid && stats.uid !== process.getuid())) throw new Error();
    return [stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs, stats.mode, stats.uid].join(":");
  }
  function capture(inspection = false) {
    try {
      const version = captureVersion();
      if (inspection && inspectionCache?.version === version) return inspectionCache.value;
      const value = JSON.parse(readFileSync(manifestPath, "utf8"));
      normalizedLiveBinaryIdentity(value.binaryIdentity);
      if (!value.binding?.projectPath || !value.binding.scheme || !value.binding.projectRoot || !value.sourceBaselines) throw new Error();
      if (captureVersion() !== version) throw new Error();
      // Observation only; explicit delivery binding always reads full authority.
      if (inspection) {
        const projected = { binaryIdentity: value.binaryIdentity, binding: value.binding, requiresStateful: Boolean(value.stateful) };
        inspectionCache = { version, value: projected };
        return projected;
      }
      return value;
    } catch { throw deliveryError("LIVE_BINARY_PROVENANCE_REQUIRED", "This Debug installation needs the updated live SDK and exact build provenance before edits can be queued. Complete its one-time Debug bootstrap; no rebuild was started."); }
  }
  function scopeFor(manifest, sessionIdentity = "pending-client") {
    const identity = normalizedLiveBinaryIdentity(manifest.binaryIdentity);
    return {
      project: canonicalProjectPath(manifest.binding.projectPath), scheme: manifest.binding.scheme,
      appIdentity: hash(JSON.stringify([identity.bundle_id, identity.bundle_version, identity.build_number])),
      binaryIdentity: `${identity.executable_uuid}:${identity.debug_dylib_uuid}`,
      sessionIdentity,
    };
  }
  async function inspect(record) {
    const manifest = capture(true);
    const expectedScope = scopeFor(manifest);
    if (!["project", "scheme", "appIdentity", "binaryIdentity"].every((key) => record.scope[key] === expectedScope[key])) return { engineAvailable: false, matchesBinary: false, captureMatches: false };
    const response = await control({ action: "status" });
    const data = response?.success ? response.data : null;
    const capabilities = Array.isArray(data?.client_capabilities) ? data.client_capabilities : [];
    const engineSupports = data?.prepared_delivery_protocol === 1;
    const completeEngine = data?.prepared_replacement_proof_protocol === 3;
    const completeClient = capabilities.includes(REPLACEMENT_PROOF_CAPABILITY);
    const requiresComplete = Boolean(record.preparedPatch?.replacementProof);
    const preserveState = record.preparedPatch?.refreshStrategy === "preserve-state-v1";
    const statefulEngine = data?.state_preserving_refresh_protocol === 1;
    const statefulClient = capabilities.includes("state-preserving-refresh-v1");
    const statefulComponentClient = capabilities.includes("stateful-components-v1");
    const addedStateClient = capabilities.includes("added-state-slots-v1");
    const client = data?.client_identity;
    const matchesBinary = liveBinaryMatches(manifest.binaryIdentity, client) && typeof client?.process_nonce === "string" && client.process_nonce.length >= 8;
    const revisionValid = Number.isSafeInteger(client?.root_revision) && client.root_revision >= 0;
    return {
      captureMatches: true,
      signingReady: data ? data.codesigning_identity_configured === true : undefined,
      compilerReady: data ? Number(data.captured_compilations || 0) > 0 : undefined,
      engineAvailable: Boolean(data && engineSupports && (!manifest.requiresStateful || (completeEngine && statefulEngine))),
      engineReachable: Boolean(data),
      completeEngine,
      receiptRecovery: data?.prepared_receipt_recovery_protocol === 1 && capabilities.includes("prepared-receipt-query-v1"),
      receiptFence: data?.prepared_receipt_fence_protocol === 1 && data?.prepared_receipt_recovery_protocol === 1
        && capabilities.includes("prepared-receipt-query-v1") && capabilities.includes("prepared-receipt-fence-v1"),
      completeClient,
      statefulEngine, statefulClient, statefulComponentClient, addedStateClient,
      clientPresent: Boolean(data?.has_connected_client),
      supportsReceipts: REQUIRED_CAPABILITIES.every((value) => capabilities.includes(value)),
      matchesBinary,
      connected: Boolean(data?.has_connected_client && matchesBinary && revisionValid && REQUIRED_CAPABILITIES.every((value) => capabilities.includes(value))
        && (!requiresComplete || (completeEngine && completeClient)) && (!preserveState || (statefulEngine && statefulClient))
        && (record.preparedPatch?.statefulComponentProtocol !== 1 || statefulComponentClient)
        && (record.preparedPatch?.addedStateProtocol !== 1 || addedStateClient)),
      foreground: client?.is_active === true,
      rootReady: client?.root_ready === true,
      revision: revisionValid ? client.root_revision : null,
      scope: scopeFor(manifest, matchesBinary ? client.process_nonce : record.scope.sessionIdentity),
      identity: client,
    };
  }
  function request(record, observed) {
    return {
      action: "inject_prepared", request_id: record.requestId, patch_digest: record.preparedPatch.patchDigest,
      attempt_id: record.claim?.token || record.applyClaimToken,
      path: record.preparedPatch.path, expires_at_ms: record.expiresAt, baseline_revision: record.baselineRevision,
      expected_identity: { ...normalizedLiveBinaryIdentity(observed.identity), process_nonce: record.scope.sessionIdentity },
      ...(record.preparedPatch.refreshStrategy ? { refresh_strategy: record.preparedPatch.refreshStrategy } : {}),
      ...(record.preparedPatch.replacementProof ? { replacement_proof: normalizeReplacementProof(record.preparedPatch.replacementProof) } : {}),
    };
  }
  function proofFrom(response, record, observed) {
    const wrapper = response?.success ? response.data : null;
    const report = wrapper?.report;
    const attemptId = record.claim?.token || record.applyClaimToken;
    const expectedCoverage = record.preparedPatch.replacementProof;
    const coverageIdentityMatches = !expectedCoverage || (report?.coverage_digest === replacementCoverageDigest(expectedCoverage)
      && report?.replacement_proof_version === 3);
    if (wrapper?.state === "rejected-no-effect" && report?.admission === "rejected-no-effect"
      && report.attempt_id === attemptId && String(report.request_id) === record.requestId
      && report.patch_digest === record.preparedPatch.patchDigest && report.applied === false
      && report.refresh_acknowledged === false && report.refreshed !== true && (report.dynamic_replacements === undefined || report.dynamic_replacements === 0)
      && report.client_identity?.process_nonce === record.scope.sessionIdentity
      && liveBinaryMatches(observed.identity, report.client_identity)
      && coverageIdentityMatches && report.state_uncertain !== true && (report.objc_replacements === undefined || report.objc_replacements === 0)
      && (["PREPARED_WAITING_FOR_FOREGROUND", "PREPARED_ROOT_NOT_READY"].includes(report.error_code)
        || (observed.receiptFence && report.error_code === "PREPARED_ATTEMPT_FENCED" && report.attempt_fenced === true))) {
      return { noEffect: { requestId: record.requestId, patchDigest: record.preparedPatch.patchDigest, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity, attemptId, admitted: false, applied: false, reasonCode: report.error_code,
        ...(report.error_code === "PREPARED_ATTEMPT_FENCED" ? { attemptFenced: true } : {}) } };
    }
    if (!report || String(report.request_id) !== record.requestId || report.patch_digest !== record.preparedPatch.patchDigest
      || !liveBinaryMatches(observed.identity, report.client_identity)
      || report.client_identity?.process_nonce !== record.scope.sessionIdentity
      || report.applied !== true || (expectedCoverage ? !verifyReplacementProofReceipt({ expected: expectedCoverage, report, attemptId }) : !(Number(report.dynamic_replacements) > 0))
      || !Number.isSafeInteger(report.root_revision)
      || report.root_revision <= record.baselineRevision
      || (record.preparedPatch.refreshStrategy === "preserve-state-v1" && report.refresh_strategy !== "preserve-state-v1")) return null;
    if (expectedCoverage && (report.succeeded !== true || report.admission !== "applied" || report.state_uncertain === true)) return null;
    return {
      requestId: record.requestId, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity,
      patchDigest: record.preparedPatch.patchDigest, applied: true,
      refreshed: report.refreshed === true && report.refresh_acknowledged === true,
      revision: report.root_revision,
      ...(record.preparedPatch.refreshStrategy ? { refreshStrategy: report.refresh_strategy } : {}),
      ...(expectedCoverage ? { replacementCoverage: privateCoverageReceipt(report) } : {}),
    };
  }
  return Object.freeze({
    withLock: lock,
    cleanup: cleanupQueuedLiveArtifacts,
    validatePrepared(record) {
      if (record.preparedPatch?.replacementProof) { validateCompleteQueuedLivePatchCoverage(record); return; }
      if (!/^[a-f0-9]{64}$/.test(record.snapshotDigest || "") || record.preparedPatch?.coverageVersion !== CLASSIFIER_VERSION || record.preparedPatch?.sourceSnapshotDigest !== record.snapshotDigest) validateQueuedLivePatchCoverage(record);
    },
    async binding({ project, scheme }) {
      const manifest = capture(); const scope = scopeFor(manifest);
      if ((project && canonicalProjectPath(project) !== scope.project) || (scheme && scheme !== scope.scheme)) throw deliveryError("LIVE_PROJECT_MISMATCH", "The live build belongs to a different project or scheme. Select the intended Debug integration; no rebuild was started.");
      const observed = await inspect({ scope });
      if (manifest.stateful && (!observed.completeEngine || !observed.statefulEngine)) throw deliveryError("LIVE_ENGINE_UPDATE_REQUIRED", "This Debug build needs its matching state-preserving live engine. No patch was compiled or sent.");
      if (observed.engineReachable && !observed.engineAvailable) throw deliveryError("LIVE_ENGINE_UPDATE_REQUIRED", "The installed engine cannot process durable live edits. Activate the matching engine and SDK before using the queued workflow; no build was started.");
      if (observed.clientPresent && !observed.supportsReceipts) throw deliveryError("LIVE_CLIENT_UPDATE_REQUIRED", "The connected Debug app needs the matching reconnect and receipt SDK. Complete its one-time Debug update; no automatic rebuild was started.");
      if (observed.completeEngine && observed.clientPresent && !observed.completeClient) throw deliveryError("LIVE_CLIENT_UPDATE_REQUIRED", "This Debug app needs the complete replacement receipt SDK. Install its one-time Debug update before using broader hot reload; no automatic rebuild was started.");
      return { scope: observed.matchesBinary ? observed.scope : scope, revision: observed.revision || 0, verifiedProcess: observed.matchesBinary && observed.connected,
        sourceBaselines: manifest.sourceBaselines, completeCoverage: observed.completeEngine,
        addedStateSupported: observed.clientPresent && observed.matchesBinary ? observed.addedStateClient : undefined };
    },
    inspect,
    async prepare(record, options) {
      const observed = await inspect(record);
      if (!observed.engineAvailable) throw deliveryError("LIVE_ENGINE_UPDATE_REQUIRED", "The matching live engine is unavailable. No patch was compiled or sent.");
      const raw = await compile(record, { ...options, completeCoverage: observed.completeEngine });
      if (raw.addedStateProtocol === 1 && observed.clientPresent && observed.matchesBinary && !observed.addedStateClient)
        throw deliveryError("LIVE_CLIENT_UPDATE_REQUIRED", "Adding State needs the matching Debug state-slot SDK. Install its one-time Debug update; no patch was sent or automatic build started.");
      const response = await control({ action: "prepare_dylib", path: raw.path }, { timeoutMs: 30_000 });
      const digest = response?.success ? response.data?.patch_digest : "";
      if (!/^[0-9a-f]{64}$/.test(digest) || hash(readFileSync(raw.path)) !== digest) throw deliveryError("PATCH_SIGNING_FAILED", "The queued patch could not be signed and verified. No app build or install was started.");
      const sealed = raw.replacementProof ? sealCompleteQueuedLivePatch(record, raw, digest) : {};
      return { ...sealed, path: raw.path, patchDigest: digest, mode: raw.mode, coverageVersion: CLASSIFIER_VERSION, sourceSnapshotDigest: record.snapshotDigest,
        ...(raw.additiveProtocol === 1 ? { additiveProtocol: 1 } : {}),
        ...(raw.sharedAdditive === true ? { sharedAdditive: true } : {}),
        ...(raw.addedStateProtocol === 1 ? { addedStateProtocol: 1, addedStateGeneration: raw.addedStateGeneration } : {}),
        ...(raw.compilerContextDigest ? { compilerContextDigest: raw.compilerContextDigest } : {}),
        ...(raw.refreshStrategy ? { refreshStrategy: raw.refreshStrategy } : {}),
        ...(raw.replacementProof ? { replacementProof: normalizeReplacementProof(raw.replacementProof), coverageDigest: raw.coverageDigest, compilerResourceDigest: raw.compilerResourceDigest } : {}) };
    },
    async apply(record, observed, { cancellationSignal } = {}) {
      let result = await control(request(record, observed), { timeoutMs: 2_000 });
      let proof = proofFrom(result, record, observed);
      if (proof?.refreshed || proof?.noEffect) return proof;
      const startedAt = now();
      const deadline = startedAt + 5_000;
      while (now() < deadline && !cancellationSignal?.aborted) {
        await wait(now() - startedAt < 300 ? 25 : 100);
        result = await control({ action: "prepared_receipt", request_id: record.requestId, patch_digest: record.preparedPatch.patchDigest });
        proof = proofFrom(result, record, observed);
        if (proof?.refreshed || proof?.noEffect) return proof;
      }
      return proof;
    },
    async receipt(record, observed) {
      const operation = observed.receiptRecovery && observed.matchesBinary && observed.supportsReceipts
        ? request(record, observed) : {};
      const { path: _path, expires_at_ms: _expiry, action: _action, ...identity } = operation;
      const response = await control({ ...identity, action: "prepared_receipt",
        ...(operation.attempt_id && observed.receiptFence ? { fence_unadmitted: true } : {}),
        request_id: record.requestId, patch_digest: record.preparedPatch.patchDigest });
      // Recovery never retransmits an image. A negotiated native tombstone may
      // prove non-admission and permanently refuse that exact old attempt.
      return proofFrom(response, record, observed);
    },
  });
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function deliveryError(code, message) { return Object.assign(new Error(message), { code }); }
function privateCoverageReceipt(report) {
  const fields = ["replacement_proof_version", "coverage_digest", "attempt_id", "expected_swift_replacements", "dynamic_replacements",
    "objc_replacements", "represented_replacements", "complete_replacement_coverage"];
  const callbackFields = ["class_name", "selector", "replacement_selector", "type_encoding", "verified", "owns_selector",
    "implementation_matches", "encoding_matches", "implementation_in_patch", "previous_implementation_changed"];
  return { ...Object.fromEntries(fields.map(key => [key, report[key]])),
    objc_callback_proofs: report.objc_callback_proofs.map(callback => Object.fromEntries(callbackFields.map(key => [key, callback[key]]))) };
}
