#!/usr/bin/env python3
from pathlib import Path

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing anchor: {label}")
    return text.replace(old, new, 1)

path = Path("mac-helper/src/deviceBuildStoreCore.js")
text = path.read_text()
text = replace_once(text,
    "    this.artifactCleanupJobs = new Map();\n",
    "    this.artifactCleanupJobs = new Map();\n    this.deliveryReferenceCleanupJobs = new Map();\n",
    "constructor cleanup jobs")
text = replace_once(text,
    '''      build.installation.requestedAt = new Date().toISOString();
      build.installation.updatedAt = new Date().toISOString();
''',
    '''      build.installation.requestedAt = new Date().toISOString();
      build.installation.verificationDeadlineAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      build.installation.updatedAt = new Date().toISOString();
''',
    "verification deadline")
text = replace_once(text,
    '''        updatedAt: new Date().toISOString(),
        devices: Array.isArray(verification.devices) ? verification.devices : [],
''',
    '''        updatedAt: new Date().toISOString(),
        verificationDeadlineAt: reportedState === "verified" ? "" : previous.verificationDeadlineAt,
        devices: Array.isArray(verification.devices) ? verification.devices : [],
''',
    "preserve verification deadline")
text = replace_once(text,
    '''        artifactCleanupJobs: new Map(Object.entries(parsed.artifactCleanupJobs || {})),
''',
    '''        artifactCleanupJobs: new Map(Object.entries(parsed.artifactCleanupJobs || {})),
        deliveryReferenceCleanupJobs: new Map(Object.entries(parsed.deliveryReferenceCleanupJobs || {})),
''',
    "read cleanup jobs")
text = replace_once(text,
    '''        return { builds: new Map(), apps: new Map(), artifactCleanupJobs: new Map() };
''',
    '''        return {
          builds: new Map(),
          apps: new Map(),
          artifactCleanupJobs: new Map(),
          deliveryReferenceCleanupJobs: new Map(),
        };
''',
    "empty state")
text = replace_once(text,
    '''      version: 4,
      apps: Object.fromEntries(state.apps),
      artifactCleanupJobs: Object.fromEntries(state.artifactCleanupJobs),
      builds: [...state.builds.values()],
''',
    '''      version: 5,
      apps: Object.fromEntries(state.apps),
      artifactCleanupJobs: Object.fromEntries(state.artifactCleanupJobs),
      deliveryReferenceCleanupJobs: Object.fromEntries(state.deliveryReferenceCleanupJobs || []),
      builds: [...state.builds.values()],
''',
    "write cleanup jobs")
text = replace_once(text,
    "    this.artifactCleanupJobs = new Map(state.artifactCleanupJobs);\n",
    "    this.artifactCleanupJobs = new Map(state.artifactCleanupJobs);\n    this.deliveryReferenceCleanupJobs = new Map(state.deliveryReferenceCleanupJobs || []);\n",
    "apply cleanup jobs")
text = replace_once(text,
    '''    updatedAt: installation.updatedAt || installation.verifiedAt || installation.requestedAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
''',
    '''    updatedAt: installation.updatedAt || installation.verifiedAt || installation.requestedAt || "",
    verificationDeadlineAt: installation.verificationDeadlineAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
''',
    "normalize verification deadline")
path.write_text(text)

path = Path("mac-helper/src/deviceBuildStore.js")
text = path.read_text()
text = text.replace("// round3-capability-generations\nconst MAX_RETAINED_CAPABILITIES = 16;\n", "")
text = replace_once(text,
    '''      const now = Date.now();
      for (const build of app.builds) {
''',
    '''      const now = Date.now();
      const queuedDeliveryReferences = new Set();
      for (const build of app.builds) {
''',
    "delete setup")
text = replace_once(text,
    '''        state.builds.delete(build.id);
      }
      state.apps.delete(id);
''',
    '''        for (const delivery of [
          build.delivery,
          ...(Array.isArray(build.capabilities) ? build.capabilities.map((capability) => capability.delivery) : []),
        ]) {
          if (!delivery?.generation || !delivery?.referenceID) continue;
          const key = `${delivery.generation}\\0${delivery.referenceID}`;
          if (queuedDeliveryReferences.has(key)) continue;
          queuedDeliveryReferences.add(key);
          const job = {
            id: randomUUID(),
            generation: delivery.generation,
            referenceID: delivery.referenceID,
            buildId: build.id,
            createdAt: new Date(now).toISOString(),
            nextAttemptAt: new Date(now).toISOString(),
            attempts: 0,
            lastError: "",
          };
          state.deliveryReferenceCleanupJobs.set(job.id, job);
        }
        state.builds.delete(build.id);
      }
      state.apps.delete(id);
''',
    "queue delivery references")
text = replace_once(text,
    '''  drainArtifactCleanupJobs() {
''',
    '''  listDeliveryReferenceCleanupJobs() {
    return this.readOnly((state) => [...(state.deliveryReferenceCleanupJobs || new Map()).values()]
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))));
  }

  completeDeliveryReferenceCleanupJob(id) {
    return this.withTransaction((state) => state.deliveryReferenceCleanupJobs.delete(id));
  }

  failDeliveryReferenceCleanupJob(id, error) {
    return this.withTransaction((state) => {
      const job = state.deliveryReferenceCleanupJobs.get(id);
      if (!job) return false;
      job.attempts = Number(job.attempts || 0) + 1;
      job.lastError = error instanceof Error ? error.message : String(error);
      job.updatedAt = new Date().toISOString();
      const backoff = Math.min(
        MAX_CLEANUP_BACKOFF_MS,
        CLEANUP_RETRY_INTERVAL_MS * 2 ** Math.min(job.attempts - 1, 7)
      );
      job.nextAttemptAt = new Date(Date.now() + backoff).toISOString();
      return true;
    });
  }

  drainArtifactCleanupJobs() {
''',
    "cleanup job methods")
text = replace_once(text,
    '''  return [...byToken.values()]
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .slice(-MAX_RETAINED_CAPABILITIES);
''',
    '''  return [...byToken.values()]
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt));
''',
    "retain all live capabilities")
text = replace_once(text,
    '''    updatedAt: installation.updatedAt || installation.verifiedAt || installation.requestedAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
''',
    '''    updatedAt: installation.updatedAt || installation.verifiedAt || installation.requestedAt || "",
    verificationDeadlineAt: installation.verificationDeadlineAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
''',
    "subclass verification deadline")
path.write_text(text)
