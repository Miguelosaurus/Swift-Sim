import { createHash } from "node:crypto";
import { constants, createReadStream, lstatSync, readFileSync } from "node:fs";
import { open } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";
import { canonicalProjectPath, projectRootForDescriptor } from "./liveSessionDescriptor.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(["waiting", "opening", "prompt-requested", "unconfirmed", "rejected", "cancelled", "expired"]);

// Explicit, one-shot composition only. Normal helper, notification and hot-reload
// startup never imports this module or reads/hashes a signed build for it.
export async function requestAppInstall({ buildID, operation = "enqueue", project, workspace, scheme,
  cwd = process.cwd(), now = () => Date.now(), readBuild, control, digest = hashArtifact,
  readIdentity = capturedIdentity,
} = {}) {
  try {
    if (!UUID.test(buildID || "") || !["enqueue", "status", "cancel"].includes(operation)) throw failure("INSTALL_REQUEST_INVALID");
    const id = buildID.toLowerCase();
    const request = control || (await import("./liveReload.js")).queuedLiveEngineControl;
    if (operation !== "enqueue") return projectResult(await request({ action: "install_request", operation, build_id: id }), id);
    if (!readBuild) {
      const { createPhase4ProductionStoreFactories } = await import("./persistence/phase4ProductionStores.js");
      const store = createPhase4ProductionStoreFactories({ deviceMaintenance: false }).createDeviceBuildStore();
      readBuild = value => store.get(value);
    }
    const build = await readBuild(id);
    if (!build || build.id !== id || build.state !== "ready" || build.signing?.deviceInstallable !== true
      || build.preserveData === false || !build.app?.teamID || !build.app?.bundleIdentifier
      || !build.app?.version || !build.app?.build || !build.artifacts?.ipaPath
      || build.tokenExpiredAt || !Number.isFinite(Date.parse(build.expiresAt)) || Date.parse(build.expiresAt) <= now()) throw failure("INSTALL_BUILD_UNAVAILABLE");
    const selected = workspace || project;
    const buildPath = canonicalProjectPath(build.workspace || build.project);
    const rel = relative(projectRootForDescriptor(buildPath), resolve(cwd));
    if ((project && workspace) || (selected ? canonicalProjectPath(selected) !== buildPath
      : isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) || (scheme && scheme !== build.scheme)) throw failure("INSTALL_SCOPE_REQUIRED");
    const engine = await request({ action: "status" });
    if (engine?.success !== true || engine.data?.foreground_install_requests !== true) throw failure("INSTALL_ENGINE_UPDATE_REQUIRED");
    // A repeated command reads the original receipt; it cannot renew or resend it.
    const previous = await request({ action: "install_request", operation: "status", build_id: id });
    if (previous?.success === true) return projectResult(previous, id);
    if (previous?.error !== "INSTALL_REQUEST_NOT_FOUND") throw failure("INSTALL_QUEUE_UNAVAILABLE");
    const observed = engine.data.client_identity;
    const selector = normalizedLiveBinaryIdentity(observed?.bundle_id === build.app.bundleIdentifier ? observed : await readIdentity());
    if (selector.bundle_id !== build.app.bundleIdentifier) throw failure("INSTALL_RUNNING_APP_REQUIRED");
    if (selector.build_number === build.app.build) throw failure(
      observed?.bundle_id === build.app.bundleIdentifier ? "INSTALL_ALREADY_RUNNING" : "INSTALL_RUNNING_APP_REQUIRED");
    if (observed?.bundle_id === selector.bundle_id && !engine.data.client_capabilities?.includes("foreground-install-v1")) throw failure("INSTALL_SDK_UPDATE_REQUIRED");
    const base = new URL(build.remoteBaseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash
      || (base.port && base.port !== "443") || !["", "/"].includes(base.pathname)
      || !/^[A-Za-z0-9_-]{24,256}$/.test(build.token)) throw failure("INSTALL_BUILD_UNAVAILABLE");
    const manifest = new URL(`/api/device-builds/${id}/artifact/manifest`, base);
    manifest.searchParams.set("token", build.token);
    const sha256 = await digest(build.artifacts.ipaPath);
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw failure("INSTALL_BUILD_UNAVAILABLE");
    // Revalidate the authoritative record after hashing; do not freeze a revoked
    // or replaced payload, or let an expired delivery become a new permission.
    const current = await readBuild(id);
    if (JSON.stringify(binding(current)) !== JSON.stringify(binding(build)) || Date.parse(current.expiresAt) <= now()) throw failure("INSTALL_BUILD_CHANGED");
    const value = JSON.stringify({ buildID: id, bundleID: build.app.bundleIdentifier, version: build.app.version,
      build: build.app.build, sha256, manifestURL: manifest.href,
      expiresAt: Math.min(Date.parse(build.expiresAt), now() + 2 * 60 * 60 * 1000) / 1000 });
    return projectResult(await request({ action: "install_request", operation: "enqueue", build_id: id, selector, value }), id);
  } catch (error) {
    const code = Object.hasOwn(GUIDANCE, error?.code) ? error.code : "INSTALL_REQUEST_UNAVAILABLE";
    return { outcome: "needs-user-action", code, guidance: GUIDANCE[code], installed: false };
  }
}

function binding(build) {
  if (!build) return null;
  return { id: build.id, app: build.app, signing: build.signing, state: build.state, token: build.token,
    expired: build.tokenExpiredAt, expiresAt: build.expiresAt, base: build.remoteBaseUrl,
    ipa: build.artifacts?.ipaPath, project: build.project, workspace: build.workspace, scheme: build.scheme, preserveData: build.preserveData };
}
function projectResult(response, id) {
  const value = response?.data;
  if (response?.success !== true || value?.build_id !== id || !STATES.has(value.state)
    || value.installed !== false || value.requires_ios_confirmation !== true || !Number.isFinite(value.expires_at)) {
    throw failure(Object.hasOwn(GUIDANCE, response?.error) ? response.error : "INSTALL_REQUEST_UNAVAILABLE");
  }
  return { outcome: "install-request", buildID: id, state: value.state,
    expiresAt: new Date(value.expires_at * 1000).toISOString(), installed: false, requiresIOSConfirmation: true,
    guidance: value.state === "waiting" ? "Waiting for the matching Debug app to be foregrounded. Confirm installation in iOS when prompted."
      : value.state === "prompt-requested" ? "The app handed the request to iOS. Confirm Install, and Download if iOS asks about cellular data. Installation is not yet verified."
      : value.state === "unconfirmed" || value.state === "opening" ? "The handoff may have occurred. Check the phone; this request will not be sent again automatically."
      : `The install request is ${value.state}. No installation success is inferred.` };
}
async function hashArtifact(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    if (!before.isFile() || before.nlink !== 1 || before.size < 1) throw failure("INSTALL_BUILD_UNAVAILABLE");
    const hash = createHash("sha256");
    for await (const part of createReadStream(path, { fd: file.fd, autoClose: false })) hash.update(part);
    const after = await file.stat();
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) throw failure("INSTALL_BUILD_CHANGED");
    return hash.digest("hex");
  } finally { await file.close(); }
}
function capturedIdentity() {
  const path = `${homedir()}/.swift-sim/live/compilations.json`;
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077
    || stat.uid !== process.getuid() || stat.size > 8 * 1024 * 1024) throw failure("INSTALL_RUNNING_APP_REQUIRED");
  return JSON.parse(readFileSync(path, "utf8")).binaryIdentity;
}
function failure(code) { return Object.assign(new Error(code), { code }); }
const GUIDANCE = {
  INSTALL_REQUEST_INVALID: "Select one saved build and one operation: request, status, or cancel.",
  INSTALL_BUILD_UNAVAILABLE: "A ready, signed, unexpired saved build is required. No build or link renewal was started.",
  INSTALL_BUILD_CHANGED: "The saved build changed while preparing the request. Nothing was queued.",
  INSTALL_SCOPE_REQUIRED: "Run from the matching app project or provide its --project/--workspace and --scheme.",
  INSTALL_RUNNING_APP_REQUIRED: "Open the matching Debug app once to establish its exact installed binary.",
  INSTALL_ALREADY_RUNNING: "The matching connected app already reports this build. No prompt was requested.",
  INSTALL_ENGINE_UPDATE_REQUIRED: "Update the Swift Sim engine before requesting installs through the Debug connection.",
  INSTALL_SDK_UPDATE_REQUIRED: "This Debug app needs the one-time SDK update for foreground installation requests.",
  INSTALL_REQUEST_CONFLICT: "Another request for this app is pending or uncertain. Inspect or cancel it before requesting another build.",
  INSTALL_REQUEST_NOT_FOUND: "No install request is saved for that build.",
  INSTALL_QUEUE_CAPACITY: "The bounded install request history is full. Existing requests were preserved.",
  INSTALL_QUEUE_UNAVAILABLE: "The private install queue is unavailable. No request will be replayed automatically.",
  INSTALL_REQUEST_UNAVAILABLE: "The request could not be confirmed. Read its status before trying again; no installation success is inferred.",
};
