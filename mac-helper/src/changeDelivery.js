import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { extname } from "node:path";
import { classifyEditSet } from "./liveReload.js";
import { DELIVERY_OUTCOMES, deliveryEnvelope, validateDeliveryEnvelope } from "./changeDeliveryContract.js";
import { liveDeliveryService } from "./liveDeliveryService.js";
import { buildFailureNotice } from "./buildFailure.js";

const activeDeliveries = new Map();

export async function deliverChange({ files = [], project = "", workspace = "", host = "", scheme = "", build = {}, liveOnly = false, queueLive = (input) => liveDeliveryService().enqueue(input), buildDevice, runtimeCheck, verbose = false, now = () => Date.now() } = {}) {
  if (!Array.isArray(files) || files.length === 0) return failedEnvelope("INVALID_EDIT_SET", "Pass at least one before/after file pair.");
  try { files = materializeDeliveryFiles(files); } catch (error) { return failedEnvelope("INVALID_EDIT_SET", safeError(error)); }
  const key = createHash("sha256").update(JSON.stringify({ files, project, workspace, host, scheme, build, liveOnly })).digest("hex");
  if (activeDeliveries.has(key)) return activeDeliveries.get(key);
  const promise = deliverOnce({ files, project, workspace, host, scheme, build, liveOnly, queueLive, buildDevice, runtimeCheck, verbose, now }).catch((error) => failedEnvelope("DELIVERY_FAILED", safeError(error)));
  activeDeliveries.set(key, promise);
  try { return await promise; } finally { activeDeliveries.delete(key); }
}

async function deliverOnce({ files, project, workspace, host, scheme, build, liveOnly, queueLive, buildDevice, runtimeCheck, verbose, now }) {
  const startedAt = now();
  const change = classifyEditSet({ files });
  if (change.route === "no-change") return finish(deliveryEnvelope({ outcome: "no-change", message: "No Swift source changes need delivery.", timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, { route: "none" }) }), !verbose);
  const health = await checkRuntime(runtimeCheck);
  if (!health.ok) return finish(deliveryEnvelope({ outcome: health.userAction ? "needs-user-action" : "failed", message: health.message, reasonCode: health.code, error: { code: health.code, message: health.message }, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, { runtime: health.diagnostic || { code: health.code } }) }), !verbose);
  if (change.route === "rebuild-required") {
    if (liveOnly) return finish(deliveryEnvelope({ outcome: "needs-user-action", message: "This edit needs a signed build. No build was started because live-only delivery was requested.", reasonCode: change.reasonCode, error: { code: "REBUILD_REQUIRED", message: "This edit changes compiled structure." } }), !verbose);
    if (typeof buildDevice !== "function") return failedEnvelope("BUILD_ADAPTER_MISSING", "Swift Sim could not start the signed build workflow.");
    return finish(await fallback({ buildDevice, build, project, workspace, scheme, change, reasonCode: change.reasonCode, startedAt, now, verbose, diagnostic: { action: "build-device", reasonCode: change.reasonCode } }), !verbose);
  }
  if (health.queueReady === false) return finish(deliveryEnvelope({ outcome: "needs-user-action", message: "The running helper needs the durable-delivery update. Restart it with the matching Swift Sim installation; no build was started.", reasonCode: "HELPER_UPDATE_REQUIRED", error: { code: "HELPER_UPDATE_REQUIRED", message: "The helper does not advertise durable live delivery." } }), !verbose);
  try {
    // Compatible intent is durable before compilation/application. Device
    // absence, refresh uncertainty and compile failure never invoke a builder.
    const result = await queueLive({ files: files.filter((_, index) => change.changes[index]?.route === "hot-reload"), project, host, scheme });
    return finish({ ...result, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, { action: "queue-live", reasonCode: result.reasonCode || "IMPLEMENTATION_ONLY" }) }, !verbose);
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code || "") ? error.code : "LIVE_QUEUE_FAILED";
    const message = safeError(error);
    return finish(deliveryEnvelope({ outcome: "needs-user-action", message, reasonCode: code, error: { code, message }, timing: { totalMs: elapsed(now, startedAt) } }), !verbose);
  }
}

async function fallback({ buildDevice, build, project, workspace, scheme, change, reasonCode, startedAt, now, verbose = false, diagnostic = undefined }) {
  let built;
  try { built = await buildDevice({ ...build, project, workspace, scheme, change }); } catch (error) {
    const { message, code } = buildFailureNotice(error);
    return deliveryEnvelope({ outcome: code === "PROTOCOL_MISMATCH" || code === "HELPER_UNAVAILABLE" ? "needs-user-action" : "failed", message, reasonCode: code, fallbackReasonCode: reasonCode, error: { code, message }, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, diagnostic) });
  }
  const link = installDelivery(built);
  if (!link) return deliveryEnvelope({ outcome: "failed", message: "The signed build finished without a usable Swift Sim install link.", reasonCode: "INSTALL_LINK_MISSING", error: { code: "INSTALL_LINK_MISSING", message: "The signed build did not return a universal install link." }, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, diagnostic) });
  const warnings = Array.isArray(built?.signing?.warnings) ? built.signing.warnings.filter(Boolean).slice(0, 3) : [];
  return deliveryEnvelope({ outcome: "install-link-ready", message: "This change needs a new signed build.", reasonCode, delivery: link, warning: warnings.length ? { code: "SIGNING_WARNING", message: warnings.join(" ").slice(0, 600) } : undefined, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, diagnostic) });
}

function installDelivery(build) {
  const universalLink = String(build?.links?.universalLink || "");
  if (!/^https:\/\//.test(universalLink)) return null;
  const customScheme = String(build?.links?.customScheme || "");
  return { kind: "install", universalLink, ...(customScheme.startsWith("swift-sim://") ? { customScheme } : {}), state: String(build?.installation?.state || build?.state || "unknown"), ...(build?.expiresAt ? { expiresAt: String(build.expiresAt) } : {}), preserveData: build?.preserveData !== false };
}

async function checkRuntime(check) {
  if (typeof check !== "function") return { ok: true };
  try { const result = await check(); return result?.ok ? result : { ok: false, userAction: result?.userAction !== false, code: result?.code || "HELPER_UNAVAILABLE", message: result?.message || "The Mac helper is not ready. Run swift-sim doctor --json and resolve the reported item before retrying.", ...(result?.diagnostic ? { diagnostic: result.diagnostic } : {}) }; } catch (error) { return { ok: false, userAction: true, code: error?.code || "HELPER_UNAVAILABLE", message: safeError(error) }; }
}
function finish(value, compact) {
  const check = validateDeliveryEnvelope(value);
  if (!check.valid) return failedEnvelope("INVALID_DELIVERY_ENVELOPE", check.errors.join(" "));
  if (!compact) return value;
  const max = value.outcome === "install-link-ready" ? 2048 : 1024;
  return Buffer.byteLength(JSON.stringify(value)) <= max ? value : failedEnvelope("DELIVERY_ENVELOPE_TOO_LARGE", "Swift Sim returned an oversized delivery result.");
}
function diagnostics(verbose, value) { return verbose && value ? { diagnostics: value } : {}; }
function failedEnvelope(code, message) { return deliveryEnvelope({ outcome: "failed", message: String(message), reasonCode: String(code), error: { code: String(code), message: String(message) } }); }
function elapsed(now, start) { return Math.max(0, Number(now()) - Number(start)); }
function safeError(error) { return (error instanceof Error ? error.message : String(error || "Swift Sim could not deliver this change.")).replace(/(?:\/Users\/|\/private\/var\/|\/tmp\/)[^\s,)]+/g, "<private-path>").replace(/(?:token|bearer|authorization)[=:][^\s&]+/gi, "credential=<redacted>").slice(0, 900); }
export const DELIVERY_RESULT_OUTCOMES = DELIVERY_OUTCOMES;

function materializeDeliveryFiles(files) {
  if (files.length > 32) throw new Error("Pass at most 32 files per edit.");
  let bytes = 0;
  return files.map((file) => {
    const snapshot = { ...file };
    const path = snapshot.path || snapshot.afterPath || snapshot.beforePath || "";
    if (extname(path).toLowerCase() !== ".swift" || (snapshot.status && snapshot.status !== "modified")) return snapshot;
    for (const [key, pathKey] of [["beforeSource", "beforePath"], ["afterSource", "afterPath"]]) {
      if (snapshot[key] === undefined && snapshot[pathKey]) {
        if (statSync(snapshot[pathKey]).size > 1024 * 1024) throw new Error("The edit exceeds its source size limit.");
        snapshot[key] = readFileSync(snapshot[pathKey], "utf8");
      }
      if (snapshot[key] !== undefined) {
        if (typeof snapshot[key] !== "string") throw new Error("Swift source snapshots must be text.");
        const size = Buffer.byteLength(snapshot[key]); bytes += size;
        if (size > 1024 * 1024 || bytes > 8 * 1024 * 1024) throw new Error("The edit exceeds its source size limit.");
      }
    }
    return snapshot;
  });
}
