import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import { extname } from "node:path";
import { resolve, relative, isAbsolute } from "node:path";
import { execFileSync } from "node:child_process";
import { classifyEditSet, sourceSnapshot } from "./liveReload.js";
import { DELIVERY_OUTCOMES, deliveryEnvelope, validateDeliveryEnvelope } from "./changeDeliveryContract.js";
import { liveDeliveryService } from "./liveDeliveryService.js";
import { buildFailureNotice } from "./buildFailure.js";
import { createLiveDeliveryAdapter } from "./liveDeliveryAdapter.js";
import { createLiveDeliveryQueue } from "./liveDeliveryQueue.js";
import { sameBinaryScope } from "./liveDeliverySnapshots.js";

const activeDeliveries = new Map();

export async function deliverChange({ files = [], project = "", workspace = "", host = "", scheme = "", build = {}, liveOnly = false, queueLive = (input) => liveDeliveryService().enqueue(input), buildDevice, installBuild, runtimeCheck, verbose = false, now = () => Date.now(), sourceContext } = {}) {
  if (!Array.isArray(files) || files.length === 0) return failedEnvelope("INVALID_EDIT_SET", "Pass at least one before/after file pair.");
  try { files = materializeDeliveryFiles(files); } catch (error) { return failedEnvelope("INVALID_EDIT_SET", safeError(error)); }
  if (files.some(file => file.beforeSource === undefined && !file.beforePath)) {
    try {
      const context = sourceContext || { ...createLiveDeliveryAdapter().sourceBinding({ project: project || workspace, scheme }), queue: createLiveDeliveryQueue() };
      files = resolveBeforeSources(files, context, now());
      files = materializeDeliveryFiles(files);
    } catch (error) {
      const code = error?.code === "LIVE_PROJECT_MISMATCH" ? error.code : "BEFORE_SNAPSHOT_UNAVAILABLE";
      const message = code === "LIVE_PROJECT_MISMATCH" ? error.message : "The previous Swift source could not be verified for this build. Pass --before explicitly and retry.";
      return deliveryEnvelope({ outcome: "needs-user-action", reasonCode: code, message, error: { code, message } });
    }
  }
  const key = createHash("sha256").update(JSON.stringify({ files, project, workspace, host, scheme, build, liveOnly, automaticInstall: typeof installBuild === "function" })).digest("hex");
  if (activeDeliveries.has(key)) return activeDeliveries.get(key);
  const promise = deliverOnce({ files, project, workspace, host, scheme, build, liveOnly, queueLive, buildDevice, installBuild, runtimeCheck, verbose, now }).catch((error) => failedEnvelope("DELIVERY_FAILED", safeError(error)));
  activeDeliveries.set(key, promise);
  try { return await promise; } finally { activeDeliveries.delete(key); }
}

function resolveBeforeSources(files, { manifest, scope, queue }, now) {
  const desired = queue.desiredStates({ scope }).at(-1);
  const history = queue.list().filter(record => sameBinaryScope(record.scope, scope) && record.sequence > (desired?.confirmedThroughSequence || 0)
    && record.expiresAt > now && !["expired", "superseded", "failed"].includes(record.state));
  return files.map(file => {
    if (file.beforeSource !== undefined || file.beforePath) return file;
    const path = resolve(file.path || file.afterPath);
    const pending = history.flatMap(record => record.files).findLast(item => item.path === path);
    const latest = pending || desired?.files.find(item => item.path === path);
    if (latest) return { ...file, beforeSource: latest.afterSource };
    const hash = manifest.sourceBaselines?.[path];
    if (hash === undefined && Array.isArray(manifest.compilations) && !manifest.compilations.some(context => context.sources?.includes(path))) {
      const name = relative(realpathSync(manifest.binding.projectRoot), realpathSync(path));
      if (!name || name.startsWith("../") || isAbsolute(name)) throw new Error("Outside project");
      return { ...file, beforeSource: "", status: file.afterSource === "" ? "modified" : "added" };
    }
    if (!/^[a-f0-9]{64}$/.test(hash || "")) throw new Error("Baseline unavailable");
    const matches = source => typeof source === "string" && createHash("sha256").update(source).digest("hex") === hash;
    let source = queue.binaryBaseline(scope, path)?.beforeSource;
    if (!matches(source)) source = sourceSnapshot(hash);
    if (!matches(source)) {
      const root = manifest.binding.projectRoot;
      try {
        const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: root, encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
        const name = relative(realpathSync(gitRoot), realpathSync(path));
        if (!name || name.startsWith("../") || isAbsolute(name)) throw new Error("outside repository");
        for (const revision of [`HEAD:${name}`, `:${name}`]) {
          try { source = execFileSync("git", ["show", revision], { cwd: gitRoot, encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024 + 1, stdio: ["ignore", "pipe", "ignore"] }); } catch { source = undefined; }
          if (matches(source)) break;
        }
      } catch { source = undefined; }
    }
    if (!matches(source)) throw new Error("Baseline unavailable");
    return { ...file, beforeSource: source };
  });
}

async function deliverOnce({ files, project, workspace, host, scheme, build, liveOnly, queueLive, buildDevice, installBuild, runtimeCheck, verbose, now }) {
  const startedAt = now();
  let change;
  try { change = classifyEditSet({ files, allowAdditive: true }); }
  catch (error) {
    if (!/^(?:FULL_CALLABLE_|LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED$)/.test(error?.code || "")) throw error;
    return deliveryEnvelope({ outcome: "needs-user-action", reasonCode: error.code,
      message: "The hot reload compiler could not be verified. Restore its tooling before retrying; no build was started.",
      error: { code: error.code, message: "The hot reload compiler could not be verified. No patch or signed build was started." } });
  }
  const classifyMs = elapsed(now, startedAt);
  if (change.route === "no-change") return finish(deliveryEnvelope({ outcome: "no-change", message: "No Swift source changes need delivery.", timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, { route: "none" }) }), !verbose);
  const health = await checkRuntime(runtimeCheck);
  if (!health.ok) return finish(deliveryEnvelope({ outcome: health.userAction ? "needs-user-action" : "failed", message: health.message, reasonCode: health.code, error: { code: health.code, message: health.message }, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, { runtime: health.diagnostic || { code: health.code } }) }), !verbose);
  if (change.route === "rebuild-required") {
    const explanation = rebuildExplanation(change);
    if (liveOnly) return finish(deliveryEnvelope({ outcome: "needs-user-action", message: "This edit needs a signed build. No build was started because live-only delivery was requested.", reasonCode: change.reasonCode, error: { code: "REBUILD_REQUIRED", message: explanation.message }, ...diagnostics(verbose, { action: "requires-build", reasonCode: change.reasonCode, changes: explanation.changes }) }), !verbose);
    if (typeof buildDevice !== "function") return failedEnvelope("BUILD_ADAPTER_MISSING", "Swift Sim could not start the signed build workflow.");
    return finish(await fallback({ buildDevice, installBuild, build, project, workspace, scheme, change, reasonCode: change.reasonCode, rebuildReason: explanation.message, startedAt, now, verbose, diagnostic: { action: "build-device", reasonCode: change.reasonCode, changes: explanation.changes } }), !verbose);
  }
  if (health.queueReady === false) return finish(deliveryEnvelope({ outcome: "needs-user-action", message: "The running helper needs the durable-delivery update. Restart it with the matching Swift Sim installation; no build was started.", reasonCode: "HELPER_UPDATE_REQUIRED", error: { code: "HELPER_UPDATE_REQUIRED", message: "The helper does not advertise durable live delivery." } }), !verbose);
  try {
    // Compatible intent is durable before compilation/application. Device
    // absence, refresh uncertainty and compile failure never invoke a builder.
    const enqueueStartedAt = now();
    const result = await queueLive({ files: files.filter((_, index) => change.changes[index]?.route === "hot-reload"), project, host, scheme,
      ...(change.requiresCompleteCoverage ? { requiresCompleteCoverage: true } : {}),
      ...(change.requiresAddedState ? { requiresAddedState: true } : {}) });
    return finish({ ...result, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, { action: "queue-live", reasonCode: result.reasonCode || "IMPLEMENTATION_ONLY", timings: { classifyMs, enqueueMs: elapsed(now, enqueueStartedAt) } }) }, !verbose);
  } catch (error) {
    const code = /^[A-Z][A-Z0-9_]{1,79}$/.test(error?.code || "") ? error.code : "LIVE_QUEUE_FAILED";
    const message = safeError(error);
    return finish(deliveryEnvelope({ outcome: "needs-user-action", message, reasonCode: code, error: { code, message }, timing: { totalMs: elapsed(now, startedAt) } }), !verbose);
  }
}

async function fallback({ buildDevice, installBuild, build, project, workspace, scheme, change, reasonCode, rebuildReason, startedAt, now, verbose = false, diagnostic = undefined }) {
  let built;
  try { built = await buildDevice({ ...build, project, workspace, scheme, change }); } catch (error) {
    if (error?.code === "BUILD_INPUTS_CHANGED") return deliveryEnvelope({ outcome: "needs-user-action",
      message: error.message, reasonCode: error.code, error: { code: error.code, message: error.message } });
    const { message, code } = buildFailureNotice(error);
    return deliveryEnvelope({ outcome: code === "PROTOCOL_MISMATCH" || code === "HELPER_UNAVAILABLE" ? "needs-user-action" : "failed", message, reasonCode: code, fallbackReasonCode: reasonCode, error: { code, message }, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, diagnostic) });
  }
  if (typeof installBuild === "function" && built?.id && built?.state === "ready") {
    let installed;
    try { installed = await installBuild({ buildID: built.id, project, workspace, scheme }); }
    catch { installed = { state: "unconfirmed", buildID: built.id }; }
    const state = installed?.state;
    if (["different-version", "not-installed"].includes(state)) return deliveryEnvelope({
      outcome: "needs-user-action", reasonCode: "INSTALL_RECEIPT_SUPERSEDED",
      message: "A newer device check superseded this install receipt. No installation was repeated.",
      error: { code: "INSTALL_RECEIPT_SUPERSEDED", message: "Check the currently installed build before requesting another update." },
    });
    if (["installed", "installed-version-observed", "already-matching-version", "waiting", "opening", "prompt-requested", "unconfirmed"].includes(state)) {
      const complete = ["installed", "installed-version-observed", "already-matching-version"].includes(state);
      const outcome = complete ? "installed" : state === "waiting" ? "install-queued" : state === "prompt-requested" ? "install-prompt-requested" : "install-unconfirmed";
      return deliveryEnvelope({ outcome, message: complete ? "The requested app version is installed on your iPhone."
        : state === "waiting" ? "Update queued. Unlock your iPhone and return to the app to install."
        : state === "prompt-requested" ? "Confirm installation on your iPhone, then reopen the app."
        : "Installation may have started. Check delivery status before trying again.",
        reasonCode, rebuildReason, delivery: { kind: "device-install", requestId: built.id, state,
          requiresIOSConfirmation: installed.requiresIOSConfirmation === true,
          ...(installed.expiresAt ? { expiresAt: installed.expiresAt } : {}) }, timing: { totalMs: elapsed(now, startedAt) } });
    }
  }
  const link = installDelivery(built);
  if (!link) return deliveryEnvelope({ outcome: "failed", message: "The signed build finished without a usable Swift Sim install link.", reasonCode: "INSTALL_LINK_MISSING", error: { code: "INSTALL_LINK_MISSING", message: "The signed build did not return a universal install link." }, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, diagnostic) });
  const warnings = Array.isArray(built?.signing?.warnings) ? built.signing.warnings.filter(Boolean).slice(0, 3) : [];
  return deliveryEnvelope({ outcome: "install-link-ready", message: "This change needs a new signed build.", reasonCode, rebuildReason, delivery: link, warning: warnings.length ? { code: "SIGNING_WARNING", message: warnings.join(" ").slice(0, 600) } : undefined, timing: { totalMs: elapsed(now, startedAt) }, ...diagnostics(verbose, diagnostic) });
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

function rebuildExplanation(change) {
  const changes = (change.changes || []).filter((item) => item.route === "rebuild-required").slice(0, 32).map((item) => {
    const reasonCode = /^[A-Z][A-Z0-9_]{1,79}$/.test(item.reasonCode || "") ? item.reasonCode : "UNSUPPORTED_CHANGE";
    const category = ["installed-structure", "unsupported-live-edit"].includes(item.diagnostic?.category)
      ? item.diagnostic.category
      : ["STORED_PROPERTY_CHANGED", "SIGNATURE_CHANGED"].includes(reasonCode) ? "installed-structure" : "unsupported-live-edit";
    const rawFile = String(item.path || item.after || item.before || "").replaceAll("\\", "/").split("/").at(-1);
    const file = /^[A-Za-z0-9][A-Za-z0-9_. -]{0,63}$/.test(rawFile || "") && !/\b(?:bearer|authorization|credential|password|secret)\b/i.test(rawFile) ? rawFile : "Swift source";
    const candidateMember = item.diagnostic?.member;
    const member = typeof candidateMember === "string" && candidateMember.length <= 80 && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*(?:\([A-Za-z0-9_:, ]*\))?$/.test(candidateMember) ? candidateMember : "";
    const line = item.diagnostic?.line;
    return { file, reasonCode, category, ...(member ? { member } : {}), ...(Number.isSafeInteger(line) && line > 0 && line <= 10_000_000 ? { line } : {}) };
  });
  const first = changes[0] || { file: "Swift source", reasonCode: change.reasonCode };
  const location = `${first.file}${first.line ? `:${first.line}` : ""}${first.member ? ` (${first.member})` : ""}`;
  const reasons = {
    STORED_PROPERTY_CHANGED: "Stored state or its initializer changed; live replacement preserves existing object storage.",
    SIGNATURE_CHANGED: first.category === "unsupported-live-edit"
      ? "Adding or removing helper declarations is not supported by the current live compiler."
      : "The installed type or callable signature changed; a signed build is required.",
    IMPORT_CHANGED: "Import changes are not supported by the current live compiler.",
    DECLARATION_CHANGED: "This declaration or syntax change is outside the classifier's supported live edits.",
    MACRO_OR_EXPLICIT_REPLACEMENT: "This syntax is not supported by the current live compiler.",
    FILE_ADDED_OR_REMOVED: "Adding, removing or renaming a Swift file is not supported by the current live compiler.",
    NON_SWIFT_FILE: "Resources, configuration and other non-Swift files require a signed build.",
  };
  const reason = reasons[first.reasonCode] || "Compatibility with the installed app is not proven for this edit; a signed build is required.";
  const remaining = changes.length > 1 ? ` ${changes.length - 1} additional ${changes.length === 2 ? "file also requires" : "files also require"} a build.` : "";
  return { message: `${location}: ${reason}${remaining}`, changes };
}

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
    if (extname(path).toLowerCase() !== ".swift" || (snapshot.status && !["modified", "added", "removed"].includes(snapshot.status))) return snapshot;
    if (snapshot.status === "added" && snapshot.beforeSource === undefined && !snapshot.beforePath) snapshot.beforeSource = "";
    if (snapshot.status === "removed" && snapshot.afterSource === undefined && !snapshot.afterPath) snapshot.afterSource = "";
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
