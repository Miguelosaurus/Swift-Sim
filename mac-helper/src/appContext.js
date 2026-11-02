import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";
import { liveBinaryMatches, normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";
import { canonicalProjectPath } from "./liveSessionDescriptor.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_IMAGE = 1024 * 1024;
const MAX_AGE = 24 * 60 * 60 * 1000;

export async function performAppTool({ appearance, refresh = false, project, workspace, scheme,
  cwd = process.cwd(), capturePath = join(homedir(), ".swift-sim/live/compilations.json"), control,
} = {}) {
  try {
    if ((appearance !== undefined) === refresh || (appearance !== undefined && !["app-default", "light", "dark"].includes(appearance))) throw failure("APP_CONTEXT_TOOL_INVALID");
    if (project && workspace) throw failure("APP_CONTEXT_SCOPE_REQUIRED");
    const capture = readCapture(capturePath), binding = capture.binding;
    const selected = workspace || project;
    if (selected ? canonicalProjectPath(selected) !== canonicalProjectPath(binding.projectPath)
      : !cwdMatchesProject(binding, cwd)) throw failure("APP_CONTEXT_SCOPE_REQUIRED");
    if (scheme && scheme !== binding.scheme) throw failure("APP_CONTEXT_SCOPE_REQUIRED");
    const expected = normalizedLiveBinaryIdentity(capture.binaryIdentity);
    const { queuedLiveEngineControl } = control ? {} : await import("./liveReload.js");
    const request = control || queuedLiveEngineControl;
    const selector = { bundle_id: expected.bundle_id, executable_uuid: expected.executable_uuid, debug_dylib_uuid: expected.debug_dylib_uuid };
    const current = validateResponse(await request({ action: "developer_context", ...selector, screenshot: false }, { timeoutMs: 10_000 }), expected);
    if (!current.capabilities?.includes("developer-context-v1")) throw failure("APP_CONTEXT_UPDATE_REQUIRED");
    if (!current.identity.is_active || !current.identity.root_ready) throw failure("APP_CONTEXT_FOREGROUND_REQUIRED");
    if (!UUID.test(current.identity.process_nonce) || !UUID.test(current.identity.connection_nonce)) throw failure("APP_CONTEXT_INVALID");
    const operation = randomUUID();
    let actionResponse;
    try {
      actionResponse = await request({ action: "developer_tool", ...selector,
        process_nonce: current.identity.process_nonce, connection_nonce: current.identity.connection_nonce,
        operation_id: operation, tool: refresh ? "refresh" : "appearance", ...(refresh ? {} : { value: appearance }),
      }, { timeoutMs: 10_000 });
    } catch { throw failure("APP_CONTEXT_TOOL_UNCONFIRMED"); }
    if (!actionResponse || String(actionResponse.error || "").includes("UNCONFIRMED")) throw failure("APP_CONTEXT_TOOL_UNCONFIRMED");
    const data = validateResponse(actionResponse, expected);
    if (data.operation_id !== operation || data.identity.process_nonce !== current.identity.process_nonce
      || data.identity.connection_nonce !== current.identity.connection_nonce) throw failure("APP_CONTEXT_TOOL_UNCONFIRMED");
    if (data.result?.success === false && String(data.result.error || "").includes("BUSY")) throw failure("APP_CONTEXT_BUSY");
    if (data.result?.success === false && String(data.result.error || "").includes("FOREGROUND")) throw failure("APP_CONTEXT_FOREGROUND_REQUIRED");
    if (data.result?.success !== true) throw failure("APP_CONTEXT_TOOL_UNCONFIRMED");
    return { schemaVersion: 1, outcome: "tool-completed", app: { bundleId: expected.bundle_id, build: expected.build_number },
      tool: refresh ? "refresh" : "appearance", ...(refresh ? { state: "refresh-requested" } : { appearance }),
      nativeCodeUpdate: false };
  } catch (error) {
    const code = error?.code && Object.hasOwn(GUIDANCE, error.code) ? error.code : "APP_CONTEXT_UNAVAILABLE";
    return { schemaVersion: 1, outcome: "needs-user-action", code, guidance: GUIDANCE[code] };
  }
}

// One-shot only. No helper runtime registration, subscriptions, or setup probes.
export async function readAppContext({ project, workspace, scheme, screenshot = false, elements = false, report,
  cwd = process.cwd(), capturePath = join(homedir(), ".swift-sim/live/compilations.json"),
  artifactRoot = join(homedir(), ".swift-sim"), control, now = () => Date.now(),
  saveImage = (value) => saveContextImage(value, { rootPath: artifactRoot, now }),
} = {}) {
  try {
    if (project && workspace) throw failure("APP_CONTEXT_SCOPE_REQUIRED");
    if (report !== undefined && report !== "latest" && !UUID.test(report)) throw failure("APP_CONTEXT_REPORT_INVALID");
    if ((screenshot || elements) && report) throw failure("APP_CONTEXT_OPTIONS_INVALID");
    const capture = readCapture(capturePath);
    const selected = workspace || project;
    const binding = capture.binding;
    const expected = normalizedLiveBinaryIdentity(capture.binaryIdentity);
    if (selected ? canonicalProjectPath(selected) !== canonicalProjectPath(binding.projectPath)
      : !cwdMatchesProject(binding, cwd)) throw failure("APP_CONTEXT_SCOPE_REQUIRED");
    if (scheme && scheme !== binding.scheme) throw failure("APP_CONTEXT_SCOPE_REQUIRED");
    const { queuedLiveEngineControl } = control ? {} : await import("./liveReload.js");
    const request = control || queuedLiveEngineControl;
    const selector = { bundle_id: expected.bundle_id, executable_uuid: expected.executable_uuid, debug_dylib_uuid: expected.debug_dylib_uuid };
    if (report) {
      // Reports live on the Mac. Reading one must not require the user to leave
      // this chat and foreground the phone app again.
      const saved = validateResponse(await request({ action: "developer_report", ...selector,
        ...(report === "latest" ? {} : { report_id: report }) }, { timeoutMs: 10_000 }), expected);
      if (!UUID.test(saved.report_id) || (report !== "latest" && saved.report_id !== report)) throw failure("APP_CONTEXT_INVALID");
      const created = Date.parse(saved.created_at);
      if (!Number.isFinite(created) || created > now() + 60_000 || now() - created > MAX_AGE) throw failure("APP_CONTEXT_REPORT_EXPIRED");
      const entry = { id: saved.report_id, createdAt: saved.created_at, fromCurrentProcess: null, ...projectMetadata(saved.metadata) };
      if (saved.screenshot) entry.screenshot = await saveImage(saved.screenshot);
      return { schemaVersion: 1, outcome: "context-ready", observedAt: new Date(now()).toISOString(),
        app: { bundleId: expected.bundle_id, version: expected.bundle_version, build: expected.build_number, configuration: "Debug" },
        runtime: { state: "not-observed" }, report: entry };
    }
    const response = await request({ action: "developer_context", ...selector, screenshot }, { timeoutMs: 10_000 });
    const data = validateResponse(response, expected);
    if (!Array.isArray(data.capabilities) || !data.capabilities.includes("developer-context-v1")) throw failure("APP_CONTEXT_UPDATE_REQUIRED");
    const identity = data.identity;
    if (typeof identity.is_active !== "boolean" || typeof identity.root_ready !== "boolean"
      || !Number.isSafeInteger(identity.root_revision) || identity.root_revision < 0
      || !UUID.test(identity.process_nonce) || !UUID.test(identity.connection_nonce)) throw failure("APP_CONTEXT_INVALID");
    const result = {
      schemaVersion: 1, outcome: "context-ready", observedAt: new Date(now()).toISOString(),
      app: { bundleId: expected.bundle_id, version: expected.bundle_version, build: expected.build_number, configuration: "Debug" },
      runtime: { connected: true, foreground: identity.is_active, rootReady: identity.root_ready, revision: identity.root_revision },
    };
    if (data.last_delivery !== undefined) {
      const last = data.last_delivery;
      if (UUID.test(last?.request_id) && last.phase === "refreshed" && last.applied === true
        && last.refresh_acknowledged === true && last.complete_replacement_coverage === true
        && Number.isSafeInteger(last.revision) && last.revision > 0 && last.revision <= identity.root_revision
        && Number.isSafeInteger(last.dynamic_replacements) && last.dynamic_replacements > 0) {
        result.lastUpdate = { requestId: last.request_id, phase: "refreshed", revision: last.revision,
          applied: true, refreshAcknowledged: true, dynamicReplacements: last.dynamic_replacements };
      }
    }
    if (screenshot) {
      if (!identity.is_active || !identity.root_ready || !data.screenshot) throw failure("APP_CONTEXT_CAPTURE_UNAVAILABLE");
      result.screenshot = await saveImage(data.screenshot);
    }
    if (elements) {
      if (!data.capabilities.includes("developer-inspection-v1")) throw failure("APP_CONTEXT_UPDATE_REQUIRED");
      if (!identity.is_active || !identity.root_ready) throw failure("APP_CONTEXT_FOREGROUND_REQUIRED");
      const operation = randomUUID();
      const inspected = validateResponse(await request({ action: "developer_tool", ...selector,
        process_nonce: identity.process_nonce, connection_nonce: identity.connection_nonce,
        operation_id: operation, tool: "inspect",
      }, { timeoutMs: 10_000 }), expected);
      if (inspected.operation_id !== operation || inspected.identity.process_nonce !== identity.process_nonce
        || inspected.identity.connection_nonce !== identity.connection_nonce
        || inspected.identity.root_revision !== identity.root_revision
        || inspected.result?.success !== true) throw failure("APP_CONTEXT_INSPECTION_UNAVAILABLE");
      result.screen = validateInspection(inspected.result.inspection, identity.root_revision, now());
      // A screenshot and element list are separate timestamped observations,
      // not an atomic capture of business/UI state.
    }
    return result;
  } catch (error) {
    const code = error?.code && Object.hasOwn(GUIDANCE, error.code) ? error.code : "APP_CONTEXT_UNAVAILABLE";
    return { schemaVersion: 1, outcome: "needs-user-action", code, guidance: GUIDANCE[code] };
  }
}

function validateInspection(value, revision, now) {
  if (!value || value.schemaVersion !== 1 || Buffer.byteLength(JSON.stringify(value)) > 32 * 1024
    || value.revision !== revision || !Number.isFinite(value.capturedAt)
    || value.capturedAt > now + 60_000 || now - value.capturedAt > 30_000
    || ![value.width, value.height].every(n => Number.isFinite(n) && n > 0 && n <= 20_000)
    || typeof value.truncated !== "boolean" || !Array.isArray(value.elements) || value.elements.length > 64) throw failure("APP_CONTEXT_INVALID");
  const ids = new Set();
  const elements = value.elements.map(item => {
    if (!item || !/^e[1-9][0-9]?$/.test(item.id) || ids.has(item.id)
      || !["secure-input", "text-input", "button", "switch", "adjustable", "heading", "link", "image", "text", "element"].includes(item.role)
      || !["accessibility", "uikit"].includes(item.source)
      || !Array.isArray(item.frame) || item.frame.length !== 4 || !item.frame.every(Number.isFinite)
      || item.frame[0] < 0 || item.frame[1] < 0 || item.frame[2] <= 0 || item.frame[3] <= 0
      || item.frame[0] + item.frame[2] > value.width + 1 || item.frame[1] + item.frame[3] > value.height + 1
      || (item.enabled != null && typeof item.enabled !== "boolean") || typeof item.selected !== "boolean") throw failure("APP_CONTEXT_INVALID");
    ids.add(item.id);
    const clean = { id: item.id, role: item.role, frame: item.frame, selected: item.selected, source: item.source };
    if (item.enabled != null) clean.enabled = item.enabled;
    for (const key of ["label", "identifier"]) {
      if (item[key] == null) continue;
      if (typeof item[key] !== "string" || Buffer.byteLength(item[key]) > 160) throw failure("APP_CONTEXT_INVALID");
      clean[key] = item[key];
    }
    // Never forward arbitrary values or strings from text inputs.
    if (item.value != null && ["switch", "adjustable"].includes(item.role)) {
      if (typeof item.value !== "string" || item.value.length > 32) throw failure("APP_CONTEXT_INVALID");
      clean.value = item.value;
    }
    return clean;
  });
  if (value.selectedElement != null && !ids.has(value.selectedElement)) throw failure("APP_CONTEXT_INVALID");
  return { capturedAt: new Date(value.capturedAt).toISOString(), revision, width: value.width, height: value.height,
    coordinateSpace: "app-window-points", elements, truncated: value.truncated,
    ...(value.selectedElement != null ? { selectedElement: value.selectedElement } : {}),
    coverage: "Public accessibility and UIKit candidates; custom drawing and some SwiftUI elements may be absent. Geometry does not prove hittability. IDs are snapshot-local; no source-file mapping." };
}

function validateResponse(response, expected) {
  if (!response) throw failure("APP_CONTEXT_UNAVAILABLE");
  if (response.success !== true) {
    const code = String(response.error || "");
    if (code.includes("REPORT_NOT_FOUND")) throw failure("APP_CONTEXT_REPORT_NOT_FOUND");
    if (code.includes("BUSY")) throw failure("APP_CONTEXT_BUSY");
    if (code.includes("IDENTITY_MISMATCH")) throw failure("APP_CONTEXT_WRONG_APP");
    if (code.includes("CAPTURE") || code.includes("SCREENSHOT") || code.includes("FOREGROUND")) throw failure("APP_CONTEXT_CAPTURE_UNAVAILABLE");
    throw failure("APP_CONTEXT_UPDATE_REQUIRED");
  }
  if (response.data?.schema_version !== 1 || !liveBinaryMatches(expected, response.data.identity)) throw failure("APP_CONTEXT_WRONG_APP");
  return response.data;
}

function readCapture(path) {
  assertPrivateParents(dirname(path));
  let stat;
  try { stat = lstatSync(path); } catch { throw failure("APP_CONTEXT_NOT_BOUND"); }
  if (!privateFile(stat) || stat.size > 8 * 1024 * 1024) throw failure("APP_CONTEXT_NOT_BOUND");
  const capture = JSON.parse(readFileSync(path, "utf8"));
  const after = lstatSync(path);
  if (stat.ino !== after.ino || stat.dev !== after.dev || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs
    || stat.size !== after.size || !privateFile(after)) throw failure("APP_CONTEXT_NOT_BOUND");
  if (!capture?.binding?.projectPath || !capture.binding.projectRoot || !capture.binding.scheme) throw failure("APP_CONTEXT_NOT_BOUND");
  return capture;
}

function privateFile(stat) {
  return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && (stat.mode & 0o077) === 0
    && (!process.getuid || stat.uid === process.getuid());
}
function assertPrivateParents(path) {
  // Reject redirection through any ancestor without requiring system ancestors to
  // be private. The capture/cache's direct parent must be owner-only.
  let current = resolve(path);
  const direct = lstatSync(current);
  if ((direct.mode & 0o077) !== 0 || (process.getuid && direct.uid !== process.getuid())) throw failure("APP_CONTEXT_NOT_BOUND");
  for (;;) {
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw failure("APP_CONTEXT_NOT_BOUND");
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function contained(root, path) {
  const child = relative(root, path);
  return child === "" || (!isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

function cwdMatchesProject(binding, cwd) {
  if (contained(resolve(binding.projectRoot), resolve(cwd))) return true;
  // A native project is often nested under apps/mobile. Infer its already
  // qualified scope from the same Git workspace, never from a common parent
  // such as HOME or CursorProjects. No Git process or build probe is needed.
  const workspace = gitWorkspace(cwd);
  return workspace !== null && workspace === gitWorkspace(binding.projectRoot)
    && contained(workspace, canonicalProjectPath(binding.projectPath));
}
function gitWorkspace(path) {
  let current = resolve(path);
  for (;;) {
    try {
      const marker = lstatSync(join(current, ".git"));
      if (!marker.isSymbolicLink() && (marker.isDirectory() || marker.isFile())) return current;
    } catch {}
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function projectMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Buffer.byteLength(JSON.stringify(value)) > 16 * 1024) throw failure("APP_CONTEXT_INVALID");
  const output = {};
  // Notes are explicit user-authored report content. Never forward arbitrary
  // native metadata, credentials, URLs, paths, or application logs.
  for (const [key, limit] of [["note", 2048], ["app_name", 256], ["sdk_version", 128], ["phase", 64], ["error_code", 128]]) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || Buffer.byteLength(value[key]) > limit) throw failure("APP_CONTEXT_INVALID");
      output[key] = value[key];
    }
  }
  if (Number.isSafeInteger(value.revision) && value.revision >= 0) output.revision = value.revision;
  if (UUID.test(value.request_id)) output.requestId = value.request_id;
  if (Number.isFinite(value.captured_at) && value.captured_at > 0) output.capturedAt = new Date(value.captured_at).toISOString();
  return output;
}

export async function saveContextImage(value, { rootPath = join(homedir(), ".swift-sim"), now = () => Date.now(), store = new NodeArtifactStore(), locks } = {}) {
  const image = validateContextJPEG(value);
  assertPrivateParents(rootPath);
  const manager = locks || (await import("./liveEngineLifecycleLock.js")).liveRuntimeLockManager;
  return manager.withLock({ path: join(rootPath, "app-context-cache.lock"), waitMs: 1000,
    staleAfterMs: 1000, ownerMode: 0o600 }, async () => {
    const directory = store.resolveContained(rootPath, "app-context");
    store.createDirectorySync(directory, 0o700);
    assertPrivateParents(directory);
    const files = [];
    for (const name of readdirSync(directory)) {
      if (!UUID.test(name.replace(/\.jpg$/, "")) || !name.endsWith(".jpg")) throw failure("APP_CONTEXT_CACHE_INVALID");
      const path = store.resolveContained(directory, name);
      const stat = lstatSync(path);
      if (!privateFile(stat) || stat.size > MAX_IMAGE) throw failure("APP_CONTEXT_CACHE_INVALID");
      if (now() - stat.mtimeMs > MAX_AGE) store.removeTreeSync(path);
      else files.push({ path, modified: stat.mtimeMs });
    }
    files.sort((a, b) => b.modified - a.modified);
    for (const file of files.slice(4)) store.removeTreeSync(file.path);
    const path = store.resolveContained(directory, `${randomUUID()}.jpg`);
    store.writeSync(path, image.bytes, { mode: 0o600, replace: false });
    return { path, mimeType: "image/jpeg", bytes: image.bytes.length, width: image.width, height: image.height,
      sha256: createHash("sha256").update(image.bytes).digest("hex"), expiresAt: new Date(now() + MAX_AGE).toISOString() };
  });
}

export function validateContextJPEG(value) {
  if (value?.mimeType !== "image/jpeg" || typeof value.data !== "string" || value.data.length > Math.ceil(MAX_IMAGE / 3) * 4
    || !Number.isSafeInteger(value.bytes) || value.bytes < 12 || value.bytes > MAX_IMAGE) throw failure("APP_CONTEXT_IMAGE_INVALID");
  const bytes = Buffer.from(value.data, "base64");
  if (bytes.length !== value.bytes || bytes.toString("base64") !== value.data || bytes.readUInt16BE(0) !== 0xffd8
    || bytes.readUInt16BE(bytes.length - 2) !== 0xffd9) throw failure("APP_CONTEXT_IMAGE_INVALID");
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff && offset < bytes.length) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker) && length >= 8) {
      const height = bytes.readUInt16BE(offset + 3), width = bytes.readUInt16BE(offset + 5);
      if (!height || !width || height * width > 2_000_000) break;
      return { bytes, width, height };
    }
    offset += length;
  }
  throw failure("APP_CONTEXT_IMAGE_INVALID");
}

function failure(code) { return Object.assign(new Error(GUIDANCE[code] || "App context unavailable."), { code }); }
const GUIDANCE = {
  APP_CONTEXT_TOOL_INVALID: "Choose exactly one tool: --appearance app-default|light|dark or --refresh-screen.",
  APP_CONTEXT_TOOL_UNCONFIRMED: "The app did not confirm this developer tool operation. Its effect is unconfirmed; do not blindly repeat it.",
  APP_CONTEXT_FOREGROUND_REQUIRED: "The matching Debug app must be in the foreground for this tool. No action was performed.",
  APP_CONTEXT_SCOPE_REQUIRED: "Run this command from the matching app project, or pass its --project/--workspace and --scheme. No other app was inspected.",
  APP_CONTEXT_NOT_BOUND: "The app's private Debug capture is unavailable. Use its existing Swift Sim integration; no setup, build or restart was started.",
  APP_CONTEXT_UNAVAILABLE: "The connected Debug app could not be inspected. Check the matching app and Mac when available; no build or restart was started.",
  APP_CONTEXT_UPDATE_REQUIRED: "This Debug app and engine need the developer-menu update before context can be read. No automatic update was started.",
  APP_CONTEXT_WRONG_APP: "The matching Debug app is unavailable on this connection. No context from a different app or build was returned.",
  APP_CONTEXT_BUSY: "Hot reload is using the connection. Read context after it completes; no edit was retried.",
  APP_CONTEXT_REPORT_NOT_FOUND: "There is no saved user report for this Debug build. Use --screenshot to inspect the running app directly; no report from another app was returned.",
  APP_CONTEXT_REPORT_EXPIRED: "The saved report has expired. Request current app context instead.",
  APP_CONTEXT_REPORT_INVALID: "Use --report latest or the exact report ID.",
  APP_CONTEXT_OPTIONS_INVALID: "Choose current --screenshot/--elements or a saved --report.",
  APP_CONTEXT_INSPECTION_UNAVAILABLE: "Screen inspection is unavailable, busy, or changed during the request. No screen interaction or code delivery was performed.",
  APP_CONTEXT_INVALID: "The app returned incomplete context. No success or screenshot was inferred.",
  APP_CONTEXT_CAPTURE_UNAVAILABLE: "The app cannot provide a current foreground screenshot. Context capture does not open or navigate the app.",
  APP_CONTEXT_IMAGE_INVALID: "The screenshot failed its format or size checks and was not saved.",
  APP_CONTEXT_CACHE_INVALID: "The private context cache needs inspection. Existing files were preserved.",
};
