import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { canonicalProjectPath } from "./liveSessionDescriptor.js";
import { normalizedLiveBinaryIdentity, liveBinaryMatches } from "./liveBinaryIdentity.js";
import { prepareQueuedLivePatchAsync, cleanupQueuedLiveArtifacts, queuedLiveEngineControl, validateQueuedLivePatchCoverage, CLASSIFIER_VERSION } from "./liveReload.js";
import { withLiveEngineLifecycleLock } from "./liveEngineLifecycleLock.js";

const LIVE_ROOT = join(homedir(), ".swift-sim", "live");
const REQUIRED_CAPABILITIES = ["prepared-delivery-v1", "receipt-v1", "replacement-proof-v2"];

export function createLiveDeliveryAdapter({ manifestPath = join(LIVE_ROOT, "compilations.json"), control = queuedLiveEngineControl, compile = prepareQueuedLivePatchAsync, lock = withLiveEngineLifecycleLock, now = () => Date.now(), wait = (ms) => new Promise((done) => setTimeout(done, ms)) } = {}) {
  function capture() {
    let value;
    try {
      const stats = lstatSync(manifestPath);
      if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o077) !== 0 || stats.size > 8 * 1024 * 1024 || (process.getuid && stats.uid !== process.getuid())) throw new Error();
      value = JSON.parse(readFileSync(manifestPath, "utf8"));
      normalizedLiveBinaryIdentity(value.binaryIdentity);
      if (!value.binding?.projectPath || !value.binding.scheme || !value.binding.projectRoot || !value.sourceBaselines) throw new Error();
    } catch { throw deliveryError("LIVE_BINARY_PROVENANCE_REQUIRED", "This Debug installation needs the updated live SDK and exact build provenance before edits can be queued. Complete its one-time Debug bootstrap; no rebuild was started."); }
    return value;
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
    const manifest = capture();
    const expectedScope = scopeFor(manifest);
    if (!["project", "scheme", "appIdentity", "binaryIdentity"].every((key) => record.scope[key] === expectedScope[key])) return { engineAvailable: false, matchesBinary: false };
    const response = await control({ action: "status" });
    const data = response?.success ? response.data : null;
    const capabilities = Array.isArray(data?.client_capabilities) ? data.client_capabilities : [];
    const engineSupports = data?.prepared_delivery_protocol === 1;
    const client = data?.client_identity;
    const matchesBinary = liveBinaryMatches(manifest.binaryIdentity, client) && typeof client?.process_nonce === "string" && client.process_nonce.length >= 8;
    const revisionValid = Number.isSafeInteger(client?.root_revision) && client.root_revision >= 0;
    return {
      engineAvailable: Boolean(data && engineSupports),
      engineReachable: Boolean(data),
      clientPresent: Boolean(data?.has_connected_client),
      supportsReceipts: REQUIRED_CAPABILITIES.every((value) => capabilities.includes(value)),
      matchesBinary,
      connected: Boolean(data?.has_connected_client && matchesBinary && revisionValid && REQUIRED_CAPABILITIES.every((value) => capabilities.includes(value))),
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
    };
  }
  function proofFrom(response, record, observed) {
    const wrapper = response?.success ? response.data : null;
    const report = wrapper?.report;
    const attemptId = record.claim?.token || record.applyClaimToken;
    if (wrapper?.state === "rejected-no-effect" && report?.admission === "rejected-no-effect"
      && report.attempt_id === attemptId && String(report.request_id) === record.requestId
      && report.patch_digest === record.preparedPatch.patchDigest && report.applied === false
      && report.refresh_acknowledged === false && report.refreshed !== true && (report.dynamic_replacements === undefined || report.dynamic_replacements === 0)
      && report.client_identity?.process_nonce === record.scope.sessionIdentity
      && liveBinaryMatches(observed.identity, report.client_identity)
      && ["PREPARED_WAITING_FOR_FOREGROUND", "PREPARED_ROOT_NOT_READY"].includes(report.error_code)) {
      return { noEffect: { requestId: record.requestId, patchDigest: record.preparedPatch.patchDigest, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity, attemptId, admitted: false, applied: false, reasonCode: report.error_code } };
    }
    if (!report || String(report.request_id) !== record.requestId || report.patch_digest !== record.preparedPatch.patchDigest
      || !liveBinaryMatches(observed.identity, report.client_identity)
      || report.client_identity?.process_nonce !== record.scope.sessionIdentity
      || report.applied !== true || !(Number(report.dynamic_replacements) > 0) || !Number.isSafeInteger(report.root_revision)
      || report.root_revision <= record.baselineRevision) return null;
    return {
      requestId: record.requestId, sessionIdentity: record.scope.sessionIdentity, binaryIdentity: record.scope.binaryIdentity,
      patchDigest: record.preparedPatch.patchDigest, applied: true,
      refreshed: report.refreshed === true && report.refresh_acknowledged === true,
      revision: report.root_revision,
    };
  }
  return Object.freeze({
    withLock: lock,
    cleanup: cleanupQueuedLiveArtifacts,
    validatePrepared(record) {
      if (!/^[a-f0-9]{64}$/.test(record.snapshotDigest || "") || record.preparedPatch?.coverageVersion !== CLASSIFIER_VERSION || record.preparedPatch?.sourceSnapshotDigest !== record.snapshotDigest) validateQueuedLivePatchCoverage(record);
    },
    async binding({ project, scheme }) {
      const manifest = capture(); const scope = scopeFor(manifest);
      if ((project && canonicalProjectPath(project) !== scope.project) || (scheme && scheme !== scope.scheme)) throw deliveryError("LIVE_PROJECT_MISMATCH", "The live build belongs to a different project or scheme. Select the intended Debug integration; no rebuild was started.");
      const observed = await inspect({ scope });
      if (observed.engineReachable && !observed.engineAvailable) throw deliveryError("LIVE_ENGINE_UPDATE_REQUIRED", "The installed engine cannot process durable live edits. Activate the matching engine and SDK before using the queued workflow; no build was started.");
      if (observed.clientPresent && !observed.supportsReceipts) throw deliveryError("LIVE_CLIENT_UPDATE_REQUIRED", "The connected Debug app needs the matching reconnect and receipt SDK. Complete its one-time Debug update; no automatic rebuild was started.");
      return { scope: observed.matchesBinary ? observed.scope : scope, revision: observed.revision || 0, verifiedProcess: observed.matchesBinary && observed.connected, sourceBaselines: manifest.sourceBaselines };
    },
    inspect,
    async prepare(record, options) {
      const raw = await compile(record, options);
      const response = await control({ action: "prepare_dylib", path: raw.path }, { timeoutMs: 30_000 });
      const digest = response?.success ? response.data?.patch_digest : "";
      if (!/^[0-9a-f]{64}$/.test(digest) || hash(readFileSync(raw.path)) !== digest) throw deliveryError("PATCH_SIGNING_FAILED", "The queued patch could not be signed and verified. No app build or install was started.");
      return { path: raw.path, patchDigest: digest, mode: raw.mode, coverageVersion: CLASSIFIER_VERSION, sourceSnapshotDigest: record.snapshotDigest };
    },
    async apply(record, observed, { cancellationSignal } = {}) {
      let result = await control(request(record, observed), { timeoutMs: 2_000 });
      let proof = proofFrom(result, record, observed);
      if (proof?.refreshed || proof?.noEffect) return proof;
      const deadline = now() + 5_000;
      while (now() < deadline && !cancellationSignal?.aborted) {
        await wait(100);
        result = await control({ action: "prepared_receipt", request_id: record.requestId, patch_digest: record.preparedPatch.patchDigest });
        proof = proofFrom(result, record, observed);
        if (proof?.refreshed || proof?.noEffect) return proof;
      }
      return proof;
    },
    async receipt(record, observed) {
      let response = await control({ action: "prepared_receipt", request_id: record.requestId, patch_digest: record.preparedPatch.patchDigest });
      // An engine restart may lose its cache while the app still owns the
      // process-lifetime receipt. The negotiated native ledger can resolve the
      // SAME operation identity; no new request or patch is manufactured.
      if (response?.success && response.data?.state === "unknown" && observed.supportsReceipts
        && observed.connected && observed.foreground && observed.rootReady && record.expiresAt > now()) {
        response = await control(request(record, observed), { timeoutMs: 2_000 });
      }
      return proofFrom(response, record, observed);
    },
  });
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function deliveryError(code, message) { return Object.assign(new Error(message), { code }); }
