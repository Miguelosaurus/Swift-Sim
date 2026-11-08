import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";
import { canonicalProjectPath, projectRootForDescriptor } from "./liveSessionDescriptor.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set(["waiting", "opening", "prompt-requested", "unconfirmed", "rejected", "cancelled", "expired"]);

// Explicit, one-shot composition only. Normal helper, notification and hot-reload
// startup never imports this module or reads/hashes a signed build for it.
export async function requestAppInstall({ buildID, operation = "enqueue", project, workspace, scheme,
  cwd = process.cwd(), now = () => Date.now(), readBuild, control, digest = hashArtifact,
  listBuilds,
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
      listBuilds ||= () => store.list();
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
    const selector = observed?.bundle_id === build.app.bundleIdentifier
      ? normalizedLiveBinaryIdentity(observed)
      : previouslyLaunchedIdentity(build, await listBuilds?.(), now());
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
    guidance: value.state === "waiting" ? "Queued. Unlock your iPhone and return to the matching Debug app to see the iOS install prompt. Confirm Install when prompted."
      : value.state === "prompt-requested" ? "The app handed the request to iOS. Confirm Install, and Download if iOS asks about cellular data. Installation is not yet verified."
      : value.state === "unconfirmed" || value.state === "opening" ? "The handoff may have occurred. Check the phone; this request will not be sent again automatically."
      : `The install request is ${value.state}. No installation success is inferred.` };
}
async function hashArtifact(path) {
  const artifacts = new NodeArtifactStore();
  try {
    const approved = artifacts.resolveContained(dirname(path), path);
    return await artifacts.sha256(approved);
  } catch (error) {
    throw failure(error?.code === "ARTIFACT_CHANGED" ? "INSTALL_BUILD_CHANGED" : "INSTALL_BUILD_UNAVAILABLE");
  }
}
// Reuse existing helper-owned launch receipts only when the app is disconnected.
// This is a future exact-match selector, never a claim that a phone is reachable
// or still running that build. A new compiler capture is not install evidence.
function previouslyLaunchedIdentity(target, builds, timestamp) {
  const candidates = [];
  for (const build of builds || []) {
    try {
      const receipt = build.installation;
      const seen = Date.parse(receipt?.lastSeenAt || "");
      if (!["launch-confirmed", "verified"].includes(receipt?.state)
        || !/^[a-f0-9]{64}$/.test(receipt.launchFingerprint || "")
        || receipt.launchFingerprint !== receipt.launchProcessFingerprint
        || !Number.isFinite(seen) || seen > timestamp + 5000
        || build.state !== "ready" || build.signing?.deviceInstallable !== true
        || String(build.configuration).toLowerCase() !== "debug"
        || build.liveReload?.eligible !== true || build.liveReload?.compilerReady !== true
        || !Number.isFinite(build.liveReload?.recovery?.completedAt)
        || build.liveReload.recovery.completedAt > seen
        || !Number.isFinite(Date.parse(build.createdAt)) || Date.parse(build.createdAt) > seen
        || canonicalProjectPath(build.workspace || build.project) !== canonicalProjectPath(target.workspace || target.project)
        || build.scheme !== target.scheme || build.app?.teamID !== target.app.teamID
        || build.app?.bundleIdentifier !== target.app.bundleIdentifier) continue;
      const identity = normalizedLiveBinaryIdentity(build.liveReload.recovery.provenance?.binaryIdentity);
      if (identity.bundle_id !== build.app.bundleIdentifier || identity.bundle_version !== build.app.version
        || identity.build_number !== build.app.build) continue;
      candidates.push({ identity, seen });
    } catch { /* An incomplete historical record grants no install selector. */ }
  }
  candidates.sort((a, b) => b.seen - a.seen);
  if (!candidates.length || candidates[0].seen === candidates[1]?.seen) throw failure("INSTALL_RUNNING_APP_REQUIRED");
  return candidates[0].identity;
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
