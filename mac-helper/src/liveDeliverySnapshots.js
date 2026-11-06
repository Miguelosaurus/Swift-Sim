// Pure bounded source projection. No file access, locks, workers or native authority.
import { createHash } from "node:crypto";
import { compilationStatefulOrigins, normalizeStatefulOrigins } from "./liveStatefulOrigins.js";

export const LIVE_SOURCE_LIMITS = Object.freeze({ files: 32, fileBytes: 1024 * 1024, requestBytes: 8 * 1024 * 1024 });
const LIMITS = LIVE_SOURCE_LIMITS;
export function sameBinaryScope(a, b) { return ["project", "scheme", "appIdentity", "binaryIdentity"].every(field => a[field] === b[field]); }
function sha(source) { return createHash("sha256").update(source).digest("hex"); }
function queueError(code) { return Object.assign(new Error(`Swift Sim live delivery journal: ${code}.`), { code }); }

export function compilationFiles(journal, scope, incoming, sequence, time, requireOriginal = false) {
  const requested = normalizeFiles(incoming);
  const requestedPaths = new Set(requested.map(file => file.path));
  const original = journal.binaryBaselines.find(item => sameBinaryScope(item.scope, scope));
  const desired = journal.desiredStates.find(item => sameBinaryScope(item.scope, scope)
    && item.confirmedThroughSequence < sequence);
  const files = new Map();
  const carry = (file) => files.set(file.path, { path: file.path, beforeSource: file.afterSource, afterSource: file.afterSource });
  for (const file of !desired?.revoked && desired?.files || []) carry(file);
  for (const record of journal.records) {
    if (!sameBinaryScope(record.scope, scope) || record.sequence >= sequence || record.sequence <= (desired?.confirmedThroughSequence || 0)
      || record.expiresAt <= time || ["failed", "expired", "superseded"].includes(record.state)) continue;
    for (const file of record.desiredSnapshots || record.files) carry(file);
  }
  for (const file of requested) files.set(file.path, file);
  const baselines = new Map();
  const retained = [...files.values()].filter(file => {
    const baseline = original?.files.find(item => item.path === file.path);
    if (baseline) {
      if (baseline.beforeHash !== sha(baseline.beforeSource)) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
      baselines.set(file.path, baseline.beforeSource);
    } else if (requireOriginal || !requestedPaths.has(file.path)) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
    return requestedPaths.has(file.path) || baseline.beforeSource !== file.afterSource;
  });
  return normalizeFiles(retained).map(file => baselines.has(file.path) && baselines.get(file.path) !== file.beforeSource
    ? { ...file, installedBaseline: baselines.get(file.path) } : file);
}
export function normalizeFiles(files) {
  if (!Array.isArray(files) || files.length === 0 || files.length > LIMITS.files) throw queueError("QUEUE_SNAPSHOT_INVALID");
  const seen = new Set(); let bytes = 0;
  const snapshots = files.map((file) => {
    if (!file || typeof file.path !== "string" || !file.path || file.path.length > 4096
      || typeof file.beforeSource !== "string" || typeof file.afterSource !== "string" || seen.has(file.path)) throw queueError("QUEUE_SNAPSHOT_INVALID");
    seen.add(file.path);
    const beforeBytes = Buffer.byteLength(file.beforeSource); const afterBytes = Buffer.byteLength(file.afterSource);
    bytes += beforeBytes + afterBytes;
    if (beforeBytes > LIMITS.fileBytes || afterBytes > LIMITS.fileBytes || bytes > LIMITS.requestBytes) throw queueError("QUEUE_LIMIT_REACHED");
    return { path: file.path, beforeSource: file.beforeSource, afterSource: file.afterSource, beforeHash: sha(file.beforeSource), afterHash: sha(file.afterSource) };
  });
  return snapshots.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}


export function projectCompilationRecord(journal, record, time) {
  const original = journal.binaryBaselines.find(item => sameBinaryScope(item.scope, record.scope));
  const projected = structuredClone(record);
  const desired = journal.desiredStates.find(item => sameBinaryScope(item.scope, record.scope));
  const cohort = (!desired?.revoked && desired?.requiresCohort === true && desired.confirmedThroughSequence < record.sequence)
    || journal.records.some(item => sameBinaryScope(item.scope, record.scope) && item.sequence < record.sequence
      && item.sequence > (desired?.revoked ? desired.confirmedThroughSequence : 0)
      && item.expiresAt > time && !["failed", "expired", "superseded"].includes(item.state)
      && (item.preparedPatch?.sharedAdditive === true || item.preparedPatch?.statefulComponentProtocol === 1));
  const origins = compilationStatefulOrigins(journal, record, time);
  if (origins.length) projected.statefulOrigins = origins;
  if (cohort) projected.files = compilationFiles(journal, record.scope, record.files, record.sequence, time, true);
  else projected.files = projected.files.map(file => {
    const baseline = original?.files.find(item => item.path === file.path);
    if (!baseline || baseline.beforeHash !== sha(baseline.beforeSource)) throw queueError("QUEUE_REBASE_BASELINE_UNAVAILABLE");
    return baseline.beforeSource === file.beforeSource ? file : { ...file, installedBaseline: baseline.beforeSource };
  });
  return projected;
}

export function preparedStatefulOrigins(patch, scope) {
  if (patch?.statefulOrigins === undefined && patch?.statefulComponentProtocol === undefined) return undefined;
  if (patch.statefulComponentProtocol !== 1) throw queueError("QUEUE_PATCH_INVALID");
  try {
    const origins = normalizeStatefulOrigins(patch.statefulOrigins, scope);
    if (origins.some(origin => !/^[A-Za-z0-9_.:-]{1,128}$/.test(origin.requestId))) throw queueError("QUEUE_PATCH_INVALID");
    return origins;
  } catch { throw queueError("QUEUE_PATCH_INVALID"); }
}

export function desiredStatefulOrigins(previous, record, snapshots) {
  if (!snapshots.some(file => file.beforeHash !== file.afterHash)) return {};
  const origins = preparedStatefulOrigins(record.preparedPatch, record.scope)
    ?? (previous && !previous.revoked && previous.scope.sessionIdentity === record.scope.sessionIdentity ? previous.statefulOrigins : undefined);
  return origins?.length ? { statefulOrigins: normalizeStatefulOrigins(origins, record.scope) } : {};
}

export function validateDesiredStatefulOrigins(desired) {
  if (desired.statefulOrigins === undefined) return;
  const origins = normalizeStatefulOrigins(desired.statefulOrigins, desired.scope);
  if (origins.length && (desired.revoked || desired.confirmation !== "refreshed"
    || !desired.files.some(file => file.beforeHash !== file.afterHash))) throw queueError("QUEUE_JOURNAL_INVALID");
  if (origins.some(origin => !/^[A-Za-z0-9_.:-]{1,128}$/.test(origin.requestId))) throw queueError("QUEUE_JOURNAL_INVALID");
}

export function retainedStatefulOrigins(journal, time) {
  const origins = [
    ...(journal.desiredStates || []).filter(item => !item.revoked).flatMap(item => item.statefulOrigins || []),
    ...journal.records.filter(item => (item.expiresAt > time && !["failed", "expired", "superseded"].includes(item.state))
      || ["applying", "applied", "uncertain"].includes(item.state)).flatMap(item => item.preparedPatch?.statefulOrigins || []),
  ];
  return [...new Map(origins.map(origin => [origin.requestId + "#" + origin.path + "#" + origin.owner, origin])).values()];
}
