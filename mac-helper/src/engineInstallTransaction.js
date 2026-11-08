import { createHash } from "node:crypto";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (value) => value === null || /^\d+:\d+$/.test(value || "");
const failure = (code) => Object.assign(new Error(code), { code });
function validate(j) {
  if (
    j?.version !== 1 ||
    !["preparing", "swapping", "committed", "rolled-back"].includes(j.phase) ||
    !identity(j.previousIdentity) ||
    !identity(j.targetIdentity) ||
    !/^\d+\.\d+\.\d+$/.test(j.desired?.version || "") ||
    !/^[a-f0-9]{64}$/.test(j.desired?.sha256 || "") ||
    !/^[a-f0-9]{40}$/.test(j.desired?.sourceRevision || "") ||
    typeof j.previousManifest !== "string" ||
    j.previousManifest.length > 24000 ||
    !/^[a-f0-9]{64}$/.test(j.previousManifestHash || "") ||
    typeof j.previousManifestPresent !== "boolean"
  )
    throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
  const bytes = Buffer.from(j.previousManifest, "base64");
  if (
    bytes.length > 16384 ||
    bytes.toString("base64") !== j.previousManifest ||
    hash(bytes) !== j.previousManifestHash
  )
    throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
  return bytes;
}
async function clean(io, journal) {
  const backup = io.backupIdentity();
  if (backup && backup !== journal.previousIdentity)
    throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
  if (backup) await io.removeBackup();
  await io.removeStage();
  await io.removeJournal();
}

// The lifecycle lock belongs to the caller. All names are fixed by its private
// engine root; a journal supplies identities and bytes, never filesystem paths.
export async function recoverEngineInstall({ io, verifyCurrent }) {
  const j = io.readJournal();
  if (!j) {
    if (io.backupIdentity() || io.stageExists()) throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
    return { recovered: false };
  }
  const previous = validate(j);
  if (j.phase === "committed") {
    if (io.currentIdentity() !== j.targetIdentity || !(await verifyCurrent(j.desired)))
      throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
    await clean(io, j);
    return { recovered: true, committed: true };
  }
  if (j.phase === "rolled-back") {
    if (io.currentIdentity() !== j.previousIdentity)
      throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
    await io.restoreManifest(j.previousManifestPresent ? previous : null);
    await clean(io, j);
    return { recovered: true, committed: false };
  }
  const backup = io.backupIdentity();
  const current = io.currentIdentity();
  if (backup) {
    if (backup !== j.previousIdentity || (current !== null && current !== j.targetIdentity))
      throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
    if (current) await io.removeCurrent();
    await io.restoreBackup();
  } else if (j.previousIdentity) {
    // Crash before the first rename is harmless; an unknown replacement isn't.
    if (current !== j.previousIdentity) throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
  } else if (current) {
    if (!j.targetIdentity || current !== j.targetIdentity)
      throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
    await io.removeCurrent();
  }
  await io.restoreManifest(j.previousManifestPresent ? previous : null);
  await io.writeJournal({ ...j, phase: "rolled-back" });
  await clean(io, j);
  return { recovered: true, committed: false };
}

export async function installEngineTransaction({ desired, io, prepare, stop, verifyCurrent }) {
  await recoverEngineInstall({ io, verifyCurrent });
  const previous = io.readManifest();
  if (
    previous &&
    (previous.length > 16384 || !Buffer.from(previous.toString("utf8")).equals(previous))
  )
    throw failure("ENGINE_MANIFEST_INVALID");
  const j = {
    version: 1,
    phase: "preparing",
    desired,
    previousIdentity: io.currentIdentity(),
    targetIdentity: null,
    previousManifestPresent: previous !== null,
    previousManifest: (previous || Buffer.alloc(0)).toString("base64"),
    previousManifestHash: hash(previous || Buffer.alloc(0)),
  };
  validate(j);
  await io.writeJournal(j);
  try {
    await prepare(); // Download/hash/extract/signature/app metadata, before stop.
    j.targetIdentity = io.stagedIdentity();
    if (!j.targetIdentity || !identity(j.targetIdentity)) throw failure("ENGINE_STAGING_INVALID");
    j.phase = "swapping";
    await io.writeJournal(j);
    await stop();
    if (io.currentIdentity() !== j.previousIdentity || io.backupIdentity())
      throw failure("ENGINE_INSTALL_CHANGED");
    if (j.previousIdentity) await io.backupCurrent();
    await io.publishStaged();
    await io.writeManifest(desired);
    if (!(await verifyCurrent(desired))) throw failure("ENGINE_INSTALL_VALIDATION_FAILED");
    j.phase = "committed";
    await io.writeJournal(j);
  } catch (error) {
    try {
      await recoverEngineInstall({ io, verifyCurrent });
    } catch {
      throw failure("ENGINE_INSTALL_RECOVERY_REQUIRED");
    }
    throw error;
  }
  // Successful publication is already durable. If removal is interrupted, the
  // next setup revalidates and cleans this one backup before another install.
  try {
    await clean(io, j);
    return { installed: true, cleanupPending: false };
  } catch {
    return { installed: true, cleanupPending: true };
  }
}
