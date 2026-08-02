import { createHash } from "node:crypto";
import { classifyEditSet, routeLiveEditSet } from "./liveReload.js";
import { DELIVERY_OUTCOMES, deliveryEnvelope, validateDeliveryEnvelope } from "./changeDeliveryContract.js";

const activeDeliveries = new Map();

export async function deliverChange({ files = [], project = "", workspace = "", host = "", scheme = "", build = {}, runtime = {}, route = routeLiveEditSet, buildDevice, runtimeCheck, verbose = false, now = () => Date.now() } = {}) {
  if (!Array.isArray(files) || files.length === 0) return failedEnvelope("INVALID_EDIT_SET", "Pass at least one before/after file pair.");
  const key = createHash("sha256").update(JSON.stringify({ files, project, workspace, scheme, build })).digest("hex");
  if (activeDeliveries.has(key)) return activeDeliveries.get(key);
  const promise = deliverOnce({ files, project, workspace, host, scheme, build, runtime, route, buildDevice, runtimeCheck, verbose, now }).catch((error) => failedEnvelope("DELIVERY_FAILED", safeError(error)));
  activeDeliveries.set(key, promise);
  try { return await promise; } finally { activeDeliveries.delete(key); }
}

async function deliverOnce({ files, project, workspace, host, scheme, build, runtime, route, buildDevice, runtimeCheck, verbose, now }) {
  const startedAt = now();
  const change = classifyEditSet({ files });
  if (change.route === "no-change") return finish(deliveryEnvelope({ outcome: "no-change", message: "No Swift source changes need delivery.", timing: { totalMs: elapsed(now, startedAt) } }), !verbose);
  if (typeof buildDevice !== "function") return failedEnvelope("BUILD_ADAPTER_MISSING", "Swift Sim could not start the signed build workflow.");
  const health = await checkRuntime(runtimeCheck);
  if (!health.ok) return finish(deliveryEnvelope({ outcome: health.userAction ? "needs-user-action" : "failed", message: health.message, reasonCode: health.code, error: { code: health.code, message: health.message }, timing: { totalMs: elapsed(now, startedAt) } }), !verbose);
  if (change.route === "rebuild-required") return finish(await fallback({ buildDevice, build, project, workspace, scheme, change, reasonCode: change.reasonCode, startedAt, now }), !verbose);
  const routed = await route({ files, project, host, scheme, runtime: { ...runtime, classify: () => change } });
  if (routed?.action === "hot-reload") {
    const proof = liveProof(routed);
    if (proof.valid) return finish(deliveryEnvelope({ outcome: "hot-reloaded", message: "Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.", delivery: { kind: "live", revision: proof.revision }, timing: { totalMs: elapsed(now, startedAt) } }), !verbose);
  }
  if (routed?.action === "none") return finish(deliveryEnvelope({ outcome: "no-change", message: "No Swift source changes need delivery.", timing: { totalMs: elapsed(now, startedAt) } }), !verbose);
  return finish(await fallback({ buildDevice, build, project, workspace, scheme, change, reasonCode: routed?.reasonCode || "LIVE_NOT_READY", startedAt, now }), !verbose);
}

async function fallback({ buildDevice, build, project, workspace, scheme, change, reasonCode, startedAt, now }) {
  let built;
  try { built = await buildDevice({ ...build, project, workspace, scheme, change }); } catch (error) {
    const message = safeError(error); const code = error?.code || buildErrorCode(message);
    return deliveryEnvelope({ outcome: code === "PROTOCOL_MISMATCH" || code === "HELPER_UNAVAILABLE" ? "needs-user-action" : "failed", message, reasonCode: code, error: { code, message }, timing: { totalMs: elapsed(now, startedAt) } });
  }
  const link = installDelivery(built);
  if (!link) return deliveryEnvelope({ outcome: "failed", message: "The signed build finished without a usable Swift Sim install link.", reasonCode: "INSTALL_LINK_MISSING", error: { code: "INSTALL_LINK_MISSING", message: "The signed build did not return a universal install link." }, timing: { totalMs: elapsed(now, startedAt) } });
  const warnings = Array.isArray(built?.signing?.warnings) ? built.signing.warnings.filter(Boolean).slice(0, 3) : [];
  return deliveryEnvelope({ outcome: "install-link-ready", message: "This change needs a new signed build.", reasonCode, delivery: link, warning: warnings.length ? { code: "SIGNING_WARNING", message: warnings.join(" ").slice(0, 600) } : undefined, timing: { totalMs: elapsed(now, startedAt) } });
}

function installDelivery(build) {
  const universalLink = String(build?.links?.universalLink || "");
  if (!/^https:\/\//.test(universalLink)) return null;
  const customScheme = String(build?.links?.customScheme || "");
  return { kind: "install", universalLink, ...(customScheme.startsWith("swift-sim://") ? { customScheme } : {}), state: String(build?.installation?.state || build?.state || "unknown"), ...(build?.expiresAt ? { expiresAt: String(build.expiresAt) } : {}), preserveData: build?.preserveData !== false };
}

function liveProof(result) {
  const patch = result?.patch || result?.patches?.at?.(-1) || {};
  const report = patch.report && typeof patch.report === "object" ? patch.report : {};
  const revision = [report.revision, report.root_revision, report.rootRevision, report.current_revision, report.currentRevision, patch.revision, result?.live?.revision].map(Number).find((value) => Number.isInteger(value) && value > 0) || 0;
  const applied = report.applied ?? report.appliedSuccessfully ?? patch.applied;
  const refreshed = report.refresh_acknowledged ?? report.refreshAcknowledged;
  const replacements = Number(report.dynamic_replacements ?? report.dynamicReplacements);
  return { valid: patch.succeeded === true && (applied === true || applied === 1) && (refreshed === true || refreshed === 1) && revision > 0 && (patch.mode === "interposition" || replacements > 0), revision };
}
async function checkRuntime(check) {
  if (typeof check !== "function") return { ok: true };
  try { const result = await check(); return result?.ok ? result : { ok: false, userAction: result?.userAction !== false, code: result?.code || "HELPER_UNAVAILABLE", message: result?.message || "Swift Sim is not ready. Run swift-sim setup, then start a new agent session." }; } catch (error) { return { ok: false, userAction: true, code: error?.code || "HELPER_UNAVAILABLE", message: safeError(error) }; }
}
function finish(value, compact) {
  const check = validateDeliveryEnvelope(value);
  if (!check.valid) return failedEnvelope("INVALID_DELIVERY_ENVELOPE", check.errors.join(" "));
  if (!compact) return value;
  const max = value.outcome === "install-link-ready" ? 2048 : 1024;
  return Buffer.byteLength(JSON.stringify(value)) <= max ? value : failedEnvelope("DELIVERY_ENVELOPE_TOO_LARGE", "Swift Sim returned an oversized delivery result.");
}
function failedEnvelope(code, message) { return deliveryEnvelope({ outcome: "failed", message: String(message), reasonCode: String(code), error: { code: String(code), message: String(message) } }); }
function elapsed(now, start) { return Math.max(0, Number(now()) - Number(start)); }
function buildErrorCode(message) { if (/outdated|different|protocol|version mismatch/i.test(message)) return "PROTOCOL_MISMATCH"; if (/sign|provision|certificate|identity|entitlement/i.test(message)) return "SIGNING_FAILED"; if (/missing|required|project|workspace|scheme/i.test(message)) return "BUILD_INPUT_INVALID"; return "BUILD_FAILED"; }
function safeError(error) { return (error instanceof Error ? error.message : String(error || "Swift Sim could not deliver this change.")).replace(/(?:\/Users\/|\/private\/var\/|\/tmp\/)[^\s,)]+/g, "<private-path>").replace(/(?:token|bearer|authorization)[=:][^\s&]+/gi, "credential=<redacted>").slice(0, 900); }
export const DELIVERY_RESULT_OUTCOMES = DELIVERY_OUTCOMES;
