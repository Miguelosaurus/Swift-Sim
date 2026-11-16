import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeAtomicFileStore } from "./infrastructure/nodeAtomicFileStore.js";

const FOREGROUND_RETENTION_SECONDS = 86400;
const HANDOFF_STATES = new Set(["opening", "prompt-requested", "unconfirmed"]);

// Saved-build delivery/status and bounded journal maintenance; the native adapter stays lazy.
export async function deliverSavedBuild({ buildID, project, workspace, scheme, device = "", status = false,
  readBuild, saveVerification, direct = nativeInstall, prompt, foregroundFence = foregroundInstallFence, maintain = maintainForegroundJournal,
} = {}) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(buildID || "")) return { state: "blocked", code: "INSTALL_REQUEST_INVALID" };
  if (!readBuild) {
    const { createPhase4ProductionStoreFactories } = await import("./persistence/phase4ProductionStores.js");
    const store = createPhase4ProductionStoreFactories({ deviceMaintenance: false }).createDeviceBuildStore();
    readBuild = id => store.get(id);
    saveVerification = (id, proof) => store.saveVerification(id, proof);
  }
  const build = await readBuild(buildID);
  if (!build || build.state !== "ready" || !build.signing?.deviceInstallable || build.preserveData === false
    || (!status && (build.tokenExpiredAt || Date.parse(build.expiresAt) <= Date.now()
    || !Number.isFinite(Date.parse(build.expiresAt))))) return { state: "blocked", code: "INSTALL_BUILD_UNAVAILABLE" };
  const { canonicalProjectPath } = await import("./liveSessionDescriptor.js");
  if ((project && workspace) || canonicalProjectPath(workspace || project) !== canonicalProjectPath(build.workspace || build.project)
    || (scheme && scheme !== build.scheme)) return { state: "blocked", code: "INSTALL_SCOPE_REQUIRED" };
  if (status && !device && ["launch-confirmed", "verified"].includes(build.installation?.state)
    && /^[a-f0-9]{64}$/.test(build.installation?.launchFingerprint || "")) return { state: "installed-version-observed", buildID };
  if (!status) await maintain().catch(() => {});
  // Existing prompt receipts fence the alternative route, including lost replies.
  const ask = prompt || (await import("./installRequest.js")).requestAppInstall;
  const previous = await ask({ buildID, operation: "status" });
  if (previous.outcome === "install-request") return foreground(previous);
  if (previous.code !== "INSTALL_REQUEST_NOT_FOUND" && previous.code !== "INSTALL_REQUEST_UNAVAILABLE")
    return { state: "unconfirmed", buildID, code: previous.code, nextAction: "check-status" };
  // A different build's live handoff also fences native installation. Terminal
  // tombstones and expired capabilities do not become permanent app-wide locks.
  const fence = foregroundFence(build);
  if (fence) return { state: "unconfirmed", buildID, ...fence };
  const native = await direct(build, { device, status });
  if (["installed", "installed-version-observed", "already-matching-version", "unconfirmed"].includes(native?.state)) {
    const observed = Number.isFinite(Date.parse(native.observedAt)) ? native.observedAt : undefined;
    if (native.state !== "unconfirmed" && observed && saveVerification) await saveVerification(buildID, {
      state: "verified", verifiedAt: observed, observedAt: observed,
      devices: [{ name: "iPhone", state: "installed", version: build.app.version, build: build.app.build }],
    });
    const current = observed && native.state !== "unconfirmed" ? await readBuild(buildID) : null;
    if (["different-version", "not-installed"].includes(current?.installation?.state)
      && Date.parse(current.installation.updatedAt) > Date.parse(observed)) return {
      state: current.installation.state, buildID, code: "INSTALL_RECEIPT_SUPERSEDED",
    };
    return { state: native.state, buildID,
      ...(native.state === "unconfirmed" ? { code: native.code || "INSTALL_RESULT_UNCONFIRMED",
        nextAction: native.nextAction || "check-status", message: native.message || "Check the earlier native install before trying again." } : {}),
      ...(observed ? { observedAt: observed } : {}),
      ...(typeof native.launchRequested === "boolean" ? { launchRequested: native.launchRequested } : {}) };
  }
  if (native?.state !== "unavailable" && native?.state !== "not-found") return { state: "unconfirmed", buildID, code: native?.code || "INSTALL_RESULT_UNCONFIRMED",
    nextAction: native?.nextAction || "check-status", message: native?.message || "Check the existing native installation before trying again." };
  if (status) return { state: "not-found", buildID };
  if (device) return { state: "blocked", code: "INSTALL_SELECTED_DEVICE_UNAVAILABLE" };
  return foreground(await ask({ buildID, project, workspace, scheme }));
}
function foreground(result) {
  return result.outcome === "install-request"
    ? { state: result.state, buildID: result.buildID, requiresIOSConfirmation: true, expiresAt: result.expiresAt,
      nextAction: result.nextAction || (result.state === "waiting" ? "open-app" : result.state === "prompt-requested" ? "confirm-install" : "check-status"),
      ...(["opening", "unconfirmed"].includes(result.state) ? { code: "INSTALL_HANDOFF_PENDING" } : {}) }
    : { state: "blocked", code: result.code };
}
async function nativeInstall(build, { device, status }) {
  const { runCommandWithDeadline } = await import("./deviceInventory.js");
  const args = [fileURLToPath(new URL("../resources/native-install.py", import.meta.url)),
    "--root", join(homedir(), ".swift-sim", "native-build-delivery"), "--build-id", build.id,
    "--bundle", build.app.bundleIdentifier, "--team", build.app.teamID, "--version", build.app.version,
    "--build", build.app.build, "--ipa", build.artifacts.ipaPath, "--expires-at", String(Date.parse(build.expiresAt) / 1000)];
  if (device) args.push("--device", device);
  if (status) args.push("--status");
  const result = await runCommandWithDeadline("python3", args, { timeoutMs: 240_000 });
  try {
    const value = JSON.parse(result.stdout);
    return result.code === 0 ? value : { state: "unconfirmed" };
  } catch { return { state: "unconfirmed" }; }
}

// Read-only fence policy. Keep possible OS handoffs through the engine's
// existing one-day tombstone window; never clear one merely for a newer build.
export function foregroundInstallFence(build, directory = join(homedir(), ".swift-sim"), now = Date.now() / 1000) {
  try {
    const entry = readForegroundJournal(directory).find(entry => entry.selector.bundle_id === build.app?.bundleIdentifier
      && !["cancelled", "rejected", "expired"].includes(entry.state)
      && foregroundDeadline(entry) > now);
    return entry ? { code: "INSTALL_HANDOFF_PENDING", nextAction: entry.state === "waiting" ? "cancel-request" : "check-status",
      message: entry.state === "waiting" ? "An older update is queued. Cancel its request or let it expire before another install."
        : "An earlier iOS handoff may still finish. Check its status; the fence expires at resolvesAt.",
      requestId: entry.id, resolvesAt: new Date(foregroundDeadline(entry) * 1000).toISOString() } : null;
  } catch { return { code: "INSTALL_QUEUE_UNAVAILABLE", nextAction: "check-mac",
    message: "The private install journal could not be read. Check the Mac before another install." }; }
}
export function noForegroundJournal(build, directory, now) { return !foregroundInstallFence(build, directory, now); }
function foregroundDeadline(entry) { return entry.expiresAt + (HANDOFF_STATES.has(entry.state) ? FOREGROUND_RETENTION_SECONDS : 0); }
function journalUnavailable() { return Object.assign(new Error("The private install journal is unavailable."), { code: "INSTALL_QUEUE_UNAVAILABLE" }); }
function readForegroundJournal(directory) {
  try {
    const parent = lstatSync(directory), file = join(directory, "install-requests.json");
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077 || parent.uid !== process.getuid()) throw journalUnavailable();
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 196608) throw journalUnavailable();
    const entries = JSON.parse(readFileSync(file, "utf8"));
    if (!Array.isArray(entries) || entries.length > 32 || new Set(entries.map(e => e.id)).size !== entries.length
      || entries.some(e => !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(e.id || "")
        || typeof e.selector?.bundle_id !== "string" || !e.selector.bundle_id
        || !["waiting", "opening", "prompt-requested", "unconfirmed", "rejected", "cancelled", "expired"].includes(e.state)
        || !Number.isFinite(e.expiresAt) || e.expiresAt <= 0 || !Number.isFinite(Date.parse(new Date(e.expiresAt * 1000).toISOString())))) throw journalUnavailable();
    return entries;
  } catch (error) { if (error.code === "ENOENT") return []; throw journalUnavailable(); }
}
// The Swift engine caches this journal. Only mutate while its existing lifecycle
// lock proves it is stopped; an unreachable live engine is never treated as dead.
export async function maintainForegroundJournal({ directory = join(homedir(), ".swift-sim"), cancelID,
  now = Date.now() / 1000, lock, assertStopped } = {}) {
  const entries = readForegroundJournal(directory);
  if (!cancelID && !entries.some(e => e.expiresAt + FOREGROUND_RETENTION_SECONDS <= now)) return;
  lock ||= (await import("./liveEngineLifecycleLock.js")).withLiveEngineLifecycleLock;
  assertStopped ||= (await import("./liveReload.js")).assertStoppedLiveEngineForRecovery;
  return lock(async () => {
    assertStopped();
    const current = readForegroundJournal(directory), selected = current.find(e => e.id === cancelID);
    const result = selected ? { ...selected, state: foregroundDeadline(selected) <= now ? "expired"
      : selected.state === "waiting" ? "cancelled" : selected.state } : null;
    const retained = current.filter(e => e.expiresAt + FOREGROUND_RETENTION_SECONDS > now)
      .map(e => e.id === cancelID ? result : e);
    if (JSON.stringify(retained) !== JSON.stringify(current)) await new NodeAtomicFileStore().writeJSON(join(directory, "install-requests.json"), retained,
      { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
    return result;
  }, { waitMs: 0 });
}
export async function offlineInstallRequest(id, operation) {
  const directory = join(homedir(), ".swift-sim");
  const entry = operation === "cancel" ? await maintainForegroundJournal({ cancelID: id })
    : readForegroundJournal(directory).find(e => e.id === id);
  if (!entry) return { success: false, error: "INSTALL_REQUEST_NOT_FOUND" };
  return { success: true, data: { build_id: entry.id, state: foregroundDeadline(entry) <= Date.now() / 1000 ? "expired" : entry.state,
    expires_at: entry.expiresAt, installed: false, requires_ios_confirmation: true } };
}

export async function holdChangedBuild(buildID, store) {
  if (!store) {
    const { createPhase4ProductionStoreFactories } = await import("./persistence/phase4ProductionStores.js");
    store = createPhase4ProductionStoreFactories({ deviceMaintenance: false }).createDeviceBuildStore();
  }
  const build = store.get(buildID);
  if (!build || build.state !== "ready") return;
  const { recordDeviceBuildFailure } = await import("./buildFailure.js");
  const error = Object.assign(new Error("Project inputs changed during the build. Prepare a stable build before installing."), { code: "BUILD_INPUTS_CHANGED" });
  build.tokenExpiredAt = new Date().toISOString();
  build.expiresAt = build.tokenExpiredAt;
  recordDeviceBuildFailure(build, error, value => store.save(value));
}
