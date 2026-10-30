import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { liveBinaryMatches, normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const CAPABILITIES = ["prepared-delivery-v1", "receipt-v1", "replacement-proof-v2"];
const MAX_OBSERVATION_MS = 5_000;

// Read only a helper-owned capture. Public request bodies never supply this
// provenance or native observation, and constructor/read paths do not write.
export function readQualifiedLaunchCapture(path) {
  const directory = lstatSync(dirname(path));
  const file = lstatSync(path);
  if (!directory.isDirectory() || directory.isSymbolicLink() || (directory.mode & 0o077)
    || !file.isFile() || file.isSymbolicLink() || file.nlink !== 1 || (file.mode & 0o077)
    || file.size > 8 * 1024 * 1024
    || (process.getuid && (file.uid !== process.getuid() || directory.uid !== process.getuid()))) throw invalidCapture();
  const capture = JSON.parse(readFileSync(path, "utf8"));
  validateCapture(capture);
  return capture;
}

export function createRemoteLaunchVerifier({ listBuilds, readCapture, inspectClient, saveConfirmation, now = () => Date.now() } = {}) {
  for (const dependency of [listBuilds, readCapture, inspectClient, saveConfirmation, now]) if (typeof dependency !== "function") throw new TypeError("Remote launch verification requires explicit trusted observation dependencies.");
  let running;
  let stopping = false;
  async function observe() {
    if (stopping) return { changed: false };
    const started = now();
    if (!Number.isSafeInteger(started)) return { changed: false };
    let capture;
    let observed;
    let captureDigest;
    try {
      capture = await readCapture();
      validateCapture(capture);
      captureDigest = hash(capture);
      observed = await inspectClient(capture);
      if (stopping || captureDigest !== hash(capture) || captureDigest !== hash(await readCapture())) return { changed: false };
    } catch { return { changed: false }; }
    const timestamp = now();
    if (!Number.isSafeInteger(timestamp) || timestamp < started || timestamp - started > MAX_OBSERVATION_MS) return { changed: false };
    const proof = nativeObservation(capture, observed, timestamp);
    if (!proof) return { changed: false };
    const candidates = listBuilds().filter((build) => launchBuildMatches(build, proof));
    // Two records claiming the same binary do not identify a unique build.
    if (candidates.length !== 1) return { changed: false };
    const build = candidates[0];
    const previous = build.installation || {};
    if (previous.launchFingerprint === proof.fingerprint) return { changed: false };
    const lastSeen = Date.parse(previous.lastSeenAt || "");
    if (Number.isFinite(lastSeen) && timestamp <= lastSeen) return { changed: false };
    if (stopping) return { changed: false };
    const result = await saveConfirmation(build.id, proof);
    return { changed: Boolean(result), ...(result ? { buildId: build.id } : {}) };
  }
  return Object.freeze({
    runOnce() {
      if (stopping) return Promise.resolve({ changed: false });
      if (!running) running = observe().finally(() => { running = null; });
      return running;
    },
    async stop() { stopping = true; if (running) await running.catch(() => {}); },
  });
}

// Rechecked by the store under its transaction, not just by a poll's snapshot.
export function launchBuildMatches(build, proof) {
  try {
    const provenance = build?.liveReload?.recovery?.provenance;
    const createdAt = Date.parse(build?.createdAt || "");
    return build?.state === "ready" && String(build.configuration).toLowerCase() === "debug"
      && build.liveReload?.eligible === true && build.liveReload?.compilerReady === true
      && typeof build.app?.teamID === "string" && build.app.teamID.length > 0
      && isAbsolute(build.project || "") && resolve(build.project) === projectContainer(proof.projectPath)
      && build.scheme === proof.scheme && Number.isFinite(createdAt) && createdAt <= proof.observedAt
      && Number.isFinite(build.liveReload.recovery.completedAt) && build.liveReload.recovery.completedAt <= proof.observedAt
      && liveBinaryMatches(provenance?.binaryIdentity, proof.binaryIdentity)
      && build.app.bundleIdentifier === proof.binaryIdentity.bundle_id
      && build.app.version === proof.binaryIdentity.bundle_version && build.app.build === proof.binaryIdentity.build_number
      && hash(provenance) === proof.provenanceDigest;
  } catch { return false; }
}

export function normalizedLaunchProof(proof) {
  if (!proof || !Number.isSafeInteger(proof.observedAt) || proof.observedAt < 0
    || !HASH.test(proof.fingerprint || "") || !HASH.test(proof.processFingerprint || "")
    || !HASH.test(proof.provenanceDigest || "") || !isAbsolute(proof.projectPath || "")
    || typeof proof.scheme !== "string" || !proof.scheme || proof.scheme.length > 256) return null;
  try { return { ...proof, binaryIdentity: normalizedLiveBinaryIdentity(proof.binaryIdentity) }; } catch { return null; }
}

function nativeObservation(capture, observed, timestamp) {
  const status = observed?.status?.success === true ? observed.status.data : null;
  const registration = observed?.registration?.success === true ? observed.registration.data : null;
  const receipt = registration?.current_registration || registration;
  const client = status?.client_identity;
  const binding = capture.registration;
  if (!status || status.prepared_delivery_protocol !== 1 || status.has_connected_client !== true
    || !Array.isArray(status.client_capabilities) || !CAPABILITIES.every((value) => status.client_capabilities.includes(value))
    || status.engine_instance_nonce !== binding.engineNonce || !client || client.is_active !== true || client.root_ready !== true
    || !Number.isSafeInteger(client.root_revision) || client.root_revision < 0
    || !ID.test(client.process_nonce || "") || !ID.test(client.connection_nonce || "")
    || !liveBinaryMatches(capture.binaryIdentity, client)
    || registration?.pending_registration || receipt?.state !== "committed"
    || receipt.engine_instance_nonce !== binding.engineNonce || receipt.registration_id !== binding.requestId
    || receipt.current_registration_id !== binding.requestId || receipt.map_digest !== binding.mapDigest
    || receipt.provenance_digest !== binding.provenanceDigest || receipt.command_count !== binding.commandCount
    || !Number.isSafeInteger(receipt.registered_count) || receipt.registered_count < 1
    || !Array.isArray(receipt.sources) || receipt.sources.length < 1) return null;
  return {
    observedAt: timestamp, binaryIdentity: normalizedLiveBinaryIdentity(client),
    // A cached status must never turn a reconnect or later poll into a new
    // launch confirmation. Only another exact app process advances history.
    fingerprint: hash(client.process_nonce),
    processFingerprint: hash(client.process_nonce), projectPath: capture.binding.projectPath,
    scheme: capture.binding.scheme, provenanceDigest: binding.provenanceDigest,
  };
}
function validateCapture(capture) {
  normalizedLiveBinaryIdentity(capture?.binaryIdentity);
  const registration = capture.registration;
  const sources = Object.entries(capture.sourceBaselines || {});
  if (capture.version !== 1 || !isAbsolute(capture.binding?.projectPath || "")
    || !isAbsolute(capture.binding?.projectRoot || "") || typeof capture.binding?.scheme !== "string"
    || !capture.binding.scheme || capture.binding.scheme.length > 256 || !sources.length || sources.length > 8192
    || sources.some(([path, digest]) => !isAbsolute(path) || !HASH.test(digest))
    || !registration || !ID.test(registration.requestId || "") || !ID.test(registration.engineNonce || "")
    || !HASH.test(registration.mapDigest || "") || !HASH.test(registration.provenanceDigest || "")
    || !Number.isSafeInteger(registration.commandCount) || registration.commandCount < 1 || registration.commandCount > 1024) throw invalidCapture();
}
function projectContainer(path) { const value = resolve(path); return value.endsWith("/project.pbxproj") ? dirname(value) : value; }
function hash(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function invalidCapture() { return Object.assign(new Error("Qualified private launch capture unavailable."), { code: "REMOTE_LAUNCH_PROVENANCE_REQUIRED" }); }
