import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";

const FIELDS = ["path", "owner", "module", "sourceFile", "layoutDigest", "modulePath", "moduleDigest", "artifactPath", "artifactDigest", "requestId", "processIdentity", "binaryIdentity", "resourceDigest"];
const HASHES = ["layoutDigest", "moduleDigest", "artifactDigest", "resourceDigest"];
export const STATEFUL_COMPONENT_PROTOCOL = 1;
export const statefulOriginsDigest = origins => digest(JSON.stringify(normalizeStatefulOrigins(origins)));

export function normalizeStatefulOrigins(value, scope) {
  let serialized;
  try { serialized = JSON.stringify(value); } catch { throw invalid(); }
  if (!Array.isArray(value) || value.length > 32 || Buffer.byteLength(serialized) > 65_536) throw invalid();
  const seen = new Set();
  return value.map(origin => {
    if (!origin || Array.isArray(origin) || Object.keys(origin).some(key => !FIELDS.includes(key)) || FIELDS.some(key => typeof origin[key] !== "string" || !origin[key] || origin[key].length > 4096 || /[\x00-\x1f]/.test(origin[key]))
      || HASHES.some(key => !/^[a-f0-9]{64}$/.test(origin[key]))
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(origin.owner) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(origin.module)
      || !/^Replacement(?:[0-9]|[12][0-9]|3[01])\.swift$/.test(origin.sourceFile)
      || ![origin.path, origin.modulePath, origin.artifactPath].every(isAbsolute)
      || basename(origin.modulePath) !== origin.module + ".swiftmodule"
      || (scope && (origin.processIdentity !== scope.sessionIdentity || origin.binaryIdentity !== scope.binaryIdentity))) throw invalid();
    const key = origin.path + "#" + origin.owner;
    if (seen.has(key)) throw invalid(); seen.add(key);
    return Object.fromEntries(FIELDS.map(key => [key, origin[key]]));
  }).sort((a, b) => {
    const left = a.path + "#" + a.owner, right = b.path + "#" + b.owner;
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

export function compilationStatefulOrigins(journal, record, now) {
  const same = scope => ["project", "scheme", "appIdentity", "binaryIdentity", "sessionIdentity"].every(key => scope[key] === record.scope[key]);
  const desired = journal.desiredStates?.find(item => same(item.scope));
  let through = desired?.confirmedThroughSequence || 0;
  let origins = desired && !desired.revoked && through < record.sequence ? desired.statefulOrigins || [] : [];
  for (const previous of journal.records) {
    if (!same(previous.scope) || previous.sequence >= record.sequence || previous.sequence <= through
      || previous.expiresAt <= now || ["failed", "expired", "superseded"].includes(previous.state)) continue;
    if (previous.preparedPatch?.statefulComponentProtocol === STATEFUL_COMPONENT_PROTOCOL) {
      origins = previous.preparedPatch.statefulOrigins || [];
      through = previous.sequence;
    }
  }
  return normalizeStatefulOrigins(origins, record.scope);
}

export function retainedStatefulOriginRequests(journal, now) {
  return [...new Set([
    ...(journal.desiredStates || []).filter(item => !item.revoked).flatMap(item => item.statefulOrigins || []),
    ...journal.records.filter(item => (item.expiresAt > now && !["failed", "expired", "superseded"].includes(item.state))
      || ["applying", "applied", "uncertain"].includes(item.state)).flatMap(item => item.preparedPatch?.statefulOrigins || []),
  ].map(origin => origin.requestId))];
}

// Verify only on demand in preparation/admission, never during idle polling.
export function verifyStatefulOrigins(origins, { scope, artifactRoot, patchRoot, resourceDigest }) {
  const normalized = normalizeStatefulOrigins(origins, scope);
  if (!normalized.length) return normalized;
  try {
    privatePath(artifactRoot, true); privatePath(patchRoot, true);
    for (const origin of normalized) {
      const match = basename(origin.artifactPath).match(/^eval_injection_swift_sim_dynamic_([a-f0-9]{64})\.dylib$/);
      if (!match || origin.module !== `SwiftSimLivePatch_${match[1]}` || origin.artifactPath !== join(artifactRoot, basename(origin.artifactPath))
        || origin.modulePath !== join(patchRoot, `queued_${match[1]}`, origin.module + ".swiftmodule")
        || origin.resourceDigest !== resourceDigest) throw invalid();
      privatePath(dirname(origin.modulePath), true);
      const module = privatePath(origin.modulePath), image = privatePath(origin.artifactPath);
      if (!module.size || !image.size || module.size > 8 * 1024 * 1024 || image.size > 32 * 1024 * 1024
        || digest(readFileSync(origin.modulePath)) !== origin.moduleDigest || digest(readFileSync(origin.artifactPath)) !== origin.artifactDigest) throw invalid();
      const markerPath = origin.artifactPath + ".json";
      if (privatePath(markerPath).size > 16_384) throw invalid();
      const marker = JSON.parse(readFileSync(markerPath, "utf8"));
      if (!marker || marker.key !== match[1] || marker.requestId !== origin.requestId || marker.artifactDigest !== origin.artifactDigest
        || marker.binaryIdentity !== origin.binaryIdentity || marker.processIdentity !== origin.processIdentity
        || marker.statefulComponentProtocol !== STATEFUL_COMPONENT_PROTOCOL || marker.resourceDigest !== resourceDigest) throw invalid();
    }
  } catch { throw invalid(); }
  return normalized;
}

function privatePath(path, directory = false) {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || (directory ? !stats.isDirectory() : !stats.isFile() || stats.nlink !== 1)
    || (stats.mode & 0o077) || (process.getuid && stats.uid !== process.getuid())) throw invalid();
  return stats;
}
function digest(bytes) { return createHash("sha256").update(bytes).digest("hex"); }
function invalid() { return Object.assign(new Error("The stateful component origin is unavailable or changed. Reconnect the matching process or restart the Debug app to regenerate its component types; no patch was applied."), { code: "LIVE_STATEFUL_ORIGIN_INVALID" }); }
