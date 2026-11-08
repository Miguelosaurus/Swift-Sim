import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalProjectPath, projectRootForDescriptor } from "./liveSessionDescriptor.js";
import { liveBinaryMatches, normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

// Resolve existing project spelling/aliases to the same file, never to a sibling
// checkout. Missing paths remain distinct and cannot borrow another recipe.
export function canonicalImportedProject(project) {
  const path = canonicalProjectPath(project);
  try {
    return realpathSync(canonicalProjectPath(realpathSync(path)));
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error.code)) {
      if (path.endsWith(".xcodeproj")) return join(path, "project.pbxproj");
      if (path.endsWith(".xcworkspace")) return join(path, "contents.xcworkspacedata");
      return path;
    }
    throw error;
  }
}

export function importXcodeMetadata(store, { metadata, project, scheme }, now = Date.now()) {
  const binary = normalizedLiveBinaryIdentity(metadata?.binaryIdentity);
  const path = canonicalImportedProject(project);
  if (
    metadata?.schema !== 1 ||
    !isAbsolute(metadata.appPath || "") ||
    metadata.appPath.length > 4096 ||
    !metadata.appPath.endsWith(".app") ||
    !/^[A-Za-z0-9]{1,32}$/.test(metadata.teamID || "") ||
    !scheme ||
    scheme.length > 256 ||
    !isAbsolute(path) ||
    !Object.entries(metadata.fingerprints || {}).length ||
    Object.entries(metadata.fingerprints || {}).length > 8 ||
    (metadata.sourceWitness &&
      (!/^[a-f0-9]{64}$/.test(metadata.sourceWitness.fingerprint || "") ||
        !Number.isFinite(Date.parse(metadata.sourceWitness.startedAt)) ||
        Object.keys(metadata.sourceWitness).length !== 2)) ||
    Object.entries(metadata.fingerprints).some(
      ([name, hash]) =>
        name.length > 300 ||
        name.includes("..") ||
        isAbsolute(name) ||
        !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error("XCODE_IMPORT_INVALID");
  const signed = {
    schema: 1,
    appPath: resolve(metadata.appPath),
    binaryIdentity: binary,
    fingerprints: metadata.fingerprints,
    teamID: metadata.teamID,
    projectPath: path,
    scheme,
    ...(metadata.sourceWitness ? { sourceWitness: metadata.sourceWitness } : {}),
  };
  return store.withTransaction((state) => {
    const all = [...state.builds.values()];
    const registered = all.filter(
      (b) =>
        canonicalImportedProject(b.workspace || b.project) === path &&
        b.scheme === scheme &&
        b.app?.bundleIdentifier === binary.bundle_id &&
        b.app?.teamID === metadata.teamID,
    );
    if (!registered.length) throw new Error("XCODE_PROJECT_REGISTRATION_REQUIRED");
    const existing = registered.filter((b) =>
      liveBinaryMatches(
        b.externalBuild?.binaryIdentity || b.liveReload?.recovery?.provenance?.binaryIdentity,
        binary,
      ),
    );
    if (existing.length === 1) {
      const original = existing[0].externalBuild?.fingerprints;
      const compiled = existing[0].liveReload?.recovery?.provenance?.appFingerprint || [];
      if (
        (original && digest(original) !== digest(metadata.fingerprints)) ||
        compiled.some((f) => metadata.fingerprints[f.name] !== f.hash)
      )
        throw new Error("XCODE_BINARY_IDENTITY_REUSED");
      return { build: existing[0], imported: false };
    }
    if (existing.length > 1) throw new Error("XCODE_BINARY_AMBIGUOUS");
    const appID =
      registered[0].app.identity ||
      createHash("sha256")
        .update(`${metadata.teamID.toUpperCase()}\0${binary.bundle_id}`)
        .digest("base64url")
        .slice(0, 24);
    const related = all.filter(
      (b) =>
        b.origin === "xcode" &&
        b.app?.bundleIdentifier === binary.bundle_id &&
        b.app?.teamID === metadata.teamID,
    );
    // Only old metadata without artifacts, compiler ownership, install evidence
    // or pending work can be retired. Never delete Xcode-owned products.
    const removable = related
      .filter(
        (b) =>
          !b.artifacts?.ipaPath &&
          !b.liveReload?.compilerReady &&
          !["verified", "launch-confirmed", "requested"].includes(b.installation?.state),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    while (related.length >= 32 && removable.length) {
      const old = removable.shift();
      state.builds.delete(old.id);
      related.splice(related.indexOf(old), 1);
    }
    if (
      related.length >= 32 ||
      [...state.builds.values()].filter((b) => b.origin === "xcode").length >= 512
    )
      throw new Error("XCODE_HISTORY_PROTECTED_CAPACITY");
    const at = new Date(now).toISOString();
    const build = {
      id: randomUUID(),
      token: randomUUID().replaceAll("-", ""),
      tokenExpiredAt: "",
      revision: 0,
      remoteBaseUrl: registered[0].remoteBaseUrl || "",
      delivery: { mode: "custom", provider: "user-configured", expiresAt: "" },
      project: path.endsWith("/project.pbxproj") ? dirname(path) : path,
      workspace: "",
      scheme,
      configuration: "Debug",
      exportMethod: "development",
      preserveData: true,
      createdAt: at,
      updatedAt: at,
      installTTLMinutes: 120,
      ttlMinutes: 120,
      expiresAt: new Date(now + 7200000).toISOString(),
      buildSettings: registered[0].buildSettings || [],
      state: "ready",
      origin: "xcode",
      externalBuild: signed,
      app: {
        identity: appID,
        name: String(metadata.name || scheme)
          .replace(/[\x00-\x1f]/g, "")
          .slice(0, 100),
        bundleIdentifier: binary.bundle_id,
        version: binary.bundle_version,
        build: binary.build_number,
        teamID: metadata.teamID,
      },
      signing: {
        style: "development",
        method: "development",
        deviceInstallable: false,
        updateSafe: "same-bundle-update",
        warnings: [],
      },
      installation: {
        state: "unknown",
        requestedAt: "",
        verifiedAt: "",
        updatedAt: "",
        verificationDeadlineAt: "",
        devices: [],
      },
      artifacts: { root: "", archivePath: "", exportPath: "", ipaPath: "", manifestPath: "" },
      logs: [],
      liveReload: { eligible: false, compilerReady: false, engineReady: false },
    };
    state.builds.set(build.id, build);
    return { build, imported: true };
  });
}
export async function importXcodeBuild({ app, project, scheme, store, inspect } = {}) {
  if (!store) {
    const { createPhase4ProductionStoreFactories } =
      await import("./persistence/phase4ProductionStores.js");
    store = createPhase4ProductionStoreFactories({
      deviceMaintenance: false,
    }).createDeviceBuildStore();
  }
  if (!inspect) {
    const { runCommandWithDeadline } = await import("./deviceInventory.js");
    inspect = async (appPath) => {
      const result = await runCommandWithDeadline(
        "python3",
        [
          fileURLToPath(new URL("../optional/xcode-import/app_metadata.py", import.meta.url)),
          "--app",
          appPath,
        ],
        { timeoutMs: 150000 },
      );
      const value = JSON.parse(result.stdout);
      if (result.code !== 0 || !value.ok)
        throw new Error(value.code || "XCODE_APP_INSPECTION_FAILED");
      return value.metadata;
    };
  }
  const metadata = await inspect(app);
  try {
    const source = readWitness(project, scheme);
    const { snapshotBuildInputs } = await import("./buildInputSnapshot.js");
    if (
      source.fingerprint ===
      snapshotBuildInputs(projectRootForDescriptor(canonicalImportedProject(project))).fingerprint
    )
      metadata.sourceWitness = { fingerprint: source.fingerprint, startedAt: source.startedAt };
  } catch {
    /* Installation metadata never grants unverified compiler authority. */
  }
  const result = importXcodeMetadata(store, { metadata, project, scheme });
  return {
    outcome: "xcode-build-recorded",
    buildID: result.build.id,
    imported: result.imported,
    artifactAvailable: Boolean(result.build.artifacts.ipaPath),
    installed: ["verified", "launch-confirmed"].includes(result.build.installation.state),
    hotReloadReady: result.build.liveReload?.compilerReady === true,
  };
}
export function externalLaunchBuildMatches(build, proof) {
  try {
    return (
      build.origin === "xcode" &&
      build.state === "ready" &&
      build.configuration === "Debug" &&
      build.externalBuild?.schema === 1 &&
      build.app.teamID === build.externalBuild.teamID &&
      build.scheme === build.externalBuild.scheme &&
      canonicalImportedProject(build.project) ===
        canonicalImportedProject(build.externalBuild.projectPath) &&
      canonicalImportedProject(build.project) ===
        canonicalImportedProject(proof.projectPath.replace(/\/project\.pbxproj$/, "")) &&
      build.scheme === proof.scheme &&
      liveBinaryMatches(build.externalBuild.binaryIdentity, proof.binaryIdentity) &&
      build.app.bundleIdentifier === proof.binaryIdentity.bundle_id &&
      build.app.version === proof.binaryIdentity.bundle_version &&
      build.app.build === proof.binaryIdentity.build_number &&
      digest(build.externalBuild) === proof.provenanceDigest &&
      Date.parse(build.createdAt) <= proof.observedAt
    );
  } catch {
    return false;
  }
}
export const externalBuildDigest = digest;

export async function exportXcodeBuild({ buildID, output, store, run } = {}) {
  if (!store) {
    const { createPhase4ProductionStoreFactories } =
      await import("./persistence/phase4ProductionStores.js");
    store = createPhase4ProductionStoreFactories({
      deviceMaintenance: false,
    }).createDeviceBuildStore();
  }
  const build = store.get(buildID);
  if (build?.origin !== "xcode" || !isAbsolute(output || ""))
    throw new Error("XCODE_EXPORT_BUILD_REQUIRED");
  run ||= (await import("./deviceInventory.js")).runCommandWithDeadline;
  const result = await run(
    "python3",
    [
      fileURLToPath(new URL("../optional/xcode-import/export.py", import.meta.url)),
      "--app",
      build.externalBuild.appPath,
      "--output",
      output,
      "--fingerprints-sha",
      digest(build.externalBuild.fingerprints),
    ],
    { timeoutMs: 300000 },
  );
  const value = JSON.parse(result.stdout);
  if (result.code !== 0) throw new Error(value.code || "XCODE_EXPORT_UNAVAILABLE");
  return value;
}

function witnessPath(project, scheme) {
  return join(
    homedir(),
    ".swift-sim",
    "xcode-import",
    "hooks",
    `${digest([canonicalImportedProject(project), scheme])}.json`,
  );
}
function readWitness(project, scheme) {
  const file = witnessPath(project, scheme);
  const stat = lstatSync(file);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    stat.mode & 0o077 ||
    stat.uid !== process.getuid() ||
    stat.size > 4096
  )
    throw new Error("XCODE_SOURCE_WITNESS_REQUIRED");
  const value = JSON.parse(readFileSync(file, "utf8"));
  if (
    !Number.isFinite(Date.parse(value.startedAt)) ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint || "") ||
    value.project !== canonicalImportedProject(project) ||
    value.scheme !== scheme ||
    Date.now() - Date.parse(value.startedAt) > 3600000 ||
    Date.parse(value.startedAt) > Date.now() + 5000
  )
    throw new Error("XCODE_SOURCE_WITNESS_REQUIRED");
  return value;
}
export async function startXcodeBuildWitness({ project, scheme }) {
  const { snapshotBuildInputs } = await import("./buildInputSnapshot.js");
  const { NodeAtomicFileStore } = await import("./infrastructure/nodeAtomicFileStore.js");
  const path = canonicalImportedProject(project);
  if (!isAbsolute(path) || !scheme || scheme.length > 256) throw new Error("XCODE_IMPORT_INVALID");
  const fingerprint = snapshotBuildInputs(projectRootForDescriptor(path)).fingerprint;
  await new NodeAtomicFileStore().writeJSON(
    witnessPath(path, scheme),
    { project: path, scheme, fingerprint, startedAt: new Date().toISOString() },
    { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true },
  );
  return { outcome: "xcode-build-witnessed" };
}
export async function qualifyXcodeBuild({
  buildID,
  resultBundle,
  store,
  inspect,
  register,
  verifyLinker,
} = {}) {
  if (!store) {
    const { createPhase4ProductionStoreFactories } =
      await import("./persistence/phase4ProductionStores.js");
    store = createPhase4ProductionStoreFactories({
      deviceMaintenance: false,
    }).createDeviceBuildStore();
  }
  const build = store.get(buildID);
  if (
    build?.origin !== "xcode" ||
    !["verified", "launch-confirmed"].includes(build.installation.state) ||
    !/^[a-f0-9]{64}$/.test(build.installation.launchFingerprint || "") ||
    !build.externalBuild.sourceWitness ||
    !isAbsolute(resultBundle || "")
  )
    throw new Error("XCODE_COMPILER_QUALIFICATION_REQUIRED");
  const { snapshotBuildInputs } = await import("./buildInputSnapshot.js");
  if (
    snapshotBuildInputs(projectRootForDescriptor(build.project)).fingerprint !==
    build.externalBuild.sourceWitness.fingerprint
  )
    throw new Error("XCODE_SOURCE_CHANGED");
  const live = await import("./liveReload.js");
  const options = {
    appPath: build.externalBuild.appPath,
    projectPath: canonicalImportedProject(build.project),
    scheme: build.scheme,
    resultBundle,
  };
  const captured = (inspect || live.inspectLiveBuildResult)(options);
  const original = build.externalBuild;
  if (
    !liveBinaryMatches(captured.provenance.binaryIdentity, original.binaryIdentity) ||
    captured.provenance.appFingerprint.length !== 4 ||
    captured.provenance.appFingerprint.some((f) => original.fingerprints[f.name] !== f.hash)
  )
    throw new Error("XCODE_OUTPUT_CHANGED");
  const appCommands = captured.commands.filter(
    (c) =>
      c.arguments.includes("-module-name") &&
      c.arguments.some(
        (a) =>
          a.endsWith(".swift") &&
          resolve(c.working_directory, a).startsWith(projectRootForDescriptor(build.project) + "/"),
      ),
  );
  if (
    !appCommands.length ||
    appCommands.some(
      (c) =>
        !c.arguments.includes("-enable-implicit-dynamic") ||
        !c.arguments.includes("-enable-private-imports"),
    )
  )
    throw new Error("XCODE_COMPILER_FLAGS_REQUIRED");
  const debugImage = Object.keys(original.fingerprints).find((name) =>
    name.endsWith(".debug.dylib"),
  );
  if (
    !debugImage ||
    !captured.linkerCommands?.some(
      (args) =>
        args.includes("-interposable") &&
        args[args.indexOf("-o") + 1] === join(original.appPath, debugImage),
    )
  )
    throw new Error("XCODE_LINKER_FLAGS_REQUIRED");
  const { verifyLiveBuildLinkerCompatibility } = await import("./liveBuildLinkerCompatibility.js");
  const { runBuffered } = await import("./deviceBuilderCore.js");
  const images = Object.keys(original.fingerprints).filter(
    (name) => name !== "Info.plist" && name !== "embedded.mobileprovision" && !name.includes("/"),
  );
  await (verifyLinker || verifyLiveBuildLinkerCompatibility)(
    images.map((name) => join(original.appPath, name)),
    { runCommand: runBuffered },
  );
  // Existing transactional registration rechecks signed inputs before publishing.
  const registered = await (register || live.registerLiveBuildResult)({
    ...options,
    expectedProvenance: captured.provenance,
  });
  const current = store.get(buildID);
  if (
    !current ||
    externalBuildDigest(current.externalBuild) !== externalBuildDigest(original) ||
    snapshotBuildInputs(projectRootForDescriptor(build.project)).fingerprint !==
      original.sourceWitness.fingerprint
  )
    throw new Error("XCODE_IMPORT_CHANGED");
  current.liveReload = {
    eligible: true,
    compilerReady: true,
    engineReady: true,
    capturedCompilations: registered.registered,
    recovery: {
      version: 1,
      phase: "registered",
      completedAt: Date.now(),
      appPath: original.appPath,
      resultBundlePath: resultBundle,
      provenance: registered.provenance,
    },
  };
  store.save(current);
  return { outcome: "xcode-compiler-qualified", buildID, hotReloadReady: true };
}
