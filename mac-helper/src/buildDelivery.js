import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Imported only after a signed fallback build, or an explicit status request.
export async function deliverSavedBuild({ buildID, project, workspace, scheme, device = "", status = false,
  readBuild, saveVerification, direct = nativeInstall, prompt, foregroundClear = noForegroundJournal,
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
  // Existing prompt receipts fence the alternative route, including lost replies.
  const ask = prompt || (await import("./installRequest.js")).requestAppInstall;
  const previous = await ask({ buildID, operation: "status" });
  if (previous.outcome === "install-request") return foreground(previous);
  // Any status ambiguity must not switch transports and install again.
  if (previous.code !== "INSTALL_REQUEST_NOT_FOUND") {
    // A fresh installation need not start the live engine. Only absence of its
    // private journal can establish that no older OTA request needs inspection.
    if (previous.code !== "INSTALL_REQUEST_UNAVAILABLE" || !foregroundClear(build)) return { state: "unconfirmed", buildID, code: previous.code };
  }
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
    return { state: native.state, buildID, ...(observed ? { observedAt: observed } : {}),
      ...(typeof native.launchRequested === "boolean" ? { launchRequested: native.launchRequested } : {}) };
  }
  if (native?.state !== "unavailable" && native?.state !== "not-found") return { state: "unconfirmed", buildID, code: "INSTALL_RESULT_UNCONFIRMED" };
  if (status) return { state: "not-found", buildID };
  if (device) return { state: "blocked", code: "INSTALL_SELECTED_DEVICE_UNAVAILABLE" };
  return foreground(await ask({ buildID, project, workspace, scheme }));
}
function foreground(result) {
  return result.outcome === "install-request"
    ? { state: result.state, buildID: result.buildID, requiresIOSConfirmation: true, expiresAt: result.expiresAt }
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

export function noForegroundJournal(build, directory = join(homedir(), ".swift-sim")) {
  try {
    const parent = lstatSync(directory);
    if (!parent.isDirectory() || parent.isSymbolicLink() || parent.mode & 0o077 || parent.uid !== process.getuid()) return false;
    const file = join(directory, "install-requests.json");
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || stat.uid !== process.getuid() || stat.size > 1024 * 1024) return false;
    // Do not interpret, rewrite or discard another route's uncertainty.
    const entries = JSON.parse(readFileSync(file, "utf8"));
    return Array.isArray(entries) && entries.length <= 32 && entries.every(entry =>
      typeof entry?.selector?.bundle_id === "string" && entry.selector.bundle_id !== build.app.bundleIdentifier);
  } catch (error) { return error?.code === "ENOENT"; }
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
