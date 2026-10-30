import { activityEventId, safeActivityLaunchURL } from "./activityStore.js";
import { createApnsProvider } from "./apnsProvider.js";
import { buildFailureNotice } from "./buildFailure.js";
import { isAbsolute, join, resolve } from "node:path";
import { normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";

const LIVE_PENDING = new Set(["queued", "compiling", "waiting-for-device", "waiting-for-foreground", "applying", "applied"]);
const BUILD_PENDING = new Set(["queued", "validating", "preparing", "archiving", "building", "exporting", "delivering"]);

export function createActivityService({ store, provider = createApnsProvider(), getPairing, listBuilds = () => [], listLiveDeliveries = () => [], now = () => Date.now() } = {}) {
  if (!store || typeof getPairing !== "function") throw new TypeError("Activity service requires a store and current pairing authority.");
  let running; let refreshing; let stopped = false; const cancellation = new AbortController();
  function authority() {
    const value = getPairing();
    if (!value || !/^[a-f0-9]{64}$/.test(value.epoch || "") || typeof value.installationId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(value.installationId)) throw new Error("Activity pairing authority is unavailable.");
    return value;
  }
  function providerState() { const value = provider.status(); const valid = typeof value.generation === "string" && value.generation.length > 0 && value.generation.length <= 256; return { ...value, configured: value.configured === true && valid, generation: valid ? value.generation : "unconfigured", ...(!valid && value.configured ? { reason: "APNS_CONFIGURATION_INVALID" } : {}) }; }
  function publicProviderState() { const state = providerState(); return { configured: state.configured === true, ...(state.reason ? { reason: state.reason } : {}) }; }
  function refreshSnapshots() {
    if (stopped) return Promise.resolve(null);
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const pairing = authority(); const status = providerState();
      const snapshot = store.snapshot();
      const { entries, observations } = activitySnapshotEvents({ builds: listBuilds(), liveDeliveries: listLiveDeliveries(), previous: snapshot.observations, knownEvents: snapshot.events, now: now() });
      await store.sync({ entries, observations, epoch: pairing.epoch, providerGeneration: status.generation, notifyReady: status.configured === true, isCurrent: () => authority().epoch === pairing.epoch });
      return { pairing, status };
    })().finally(() => { refreshing = null; });
    return refreshing;
  }
  async function tick() {
    const snapshot = await refreshSnapshots();
    if (!snapshot) return { processed: false };
    const { pairing, status } = snapshot;
    if (stopped || !status.configured) return { processed: false };
    let sent = 0; let accepted = 0;
    for (let index = 0; index < 8 && !stopped; index++) {
      const current = authority(); const currentStatus = providerState();
      if (current.epoch !== pairing.epoch || current.installationId !== pairing.installationId || currentStatus.generation !== status.generation || !currentStatus.configured) break;
      const claim = await store.claimNext({ epoch: current.epoch, providerGeneration: currentStatus.generation, isCurrent: () => authority().epoch === current.epoch });
      if (!claim) break;
      await refreshSnapshots();
      const fresh = authority(); const freshStatus = providerState();
      if (stopped || fresh.epoch !== current.epoch || freshStatus.generation !== currentStatus.generation) break;
      if (!(await store.claimIsCurrent(claim.job.id, claim.job.claim.token, { epoch: fresh.epoch, providerGeneration: freshStatus.generation }))) continue;
      const event = claim.event;
      const outcome = await provider.send({ token: claim.device.token, environment: claim.device.environment,
        apnsId: claim.job.id, collapseId: claim.job.collapseId || event.id, expectedGeneration: currentStatus.generation,
        isCurrent: async () => {
          await refreshSnapshots();
          const latest = authority(); const latestProvider = providerState();
          return !stopped && latest.epoch === current.epoch && latest.installationId === current.installationId && latestProvider.generation === currentStatus.generation && store.claimIsCurrent(claim.job.id, claim.job.claim.token, { epoch: latest.epoch, providerGeneration: latestProvider.generation });
        },
        payload: { aps: { alert: { title: event.title, body: event.message }, sound: "default" }, eventId: event.id, macID: current.installationId,
          ...(event.buildId ? { buildId: event.buildId } : {}), ...(event.requestId ? { requestId: event.requestId } : {}) }, signal: cancellation.signal });
      await store.settle(claim.job.id, claim.job.claim.token, outcome, { epoch: current.epoch, providerGeneration: currentStatus.generation });
      sent++; if (outcome.state === "accepted") accepted++;
    }
    return { processed: sent > 0, attempts: sent, acceptedRequests: accepted };
  }
  return Object.freeze({
    refresh: refreshSnapshots,
    runOnce() {
      if (stopped) return Promise.resolve({ processed: false });
      if (running) return running;
      running = tick().finally(() => { running = null; }); return running;
    },
    feed({ after = 0, deviceId } = {}) {
      const pairing = authority();
      return { ...store.feed({ after, deviceId, epoch: pairing.epoch }), installationId: pairing.installationId, notificationStatus: publicProviderState() };
    },
    async registerDevice(input) {
      const pairing = authority(); const status = providerState();
      const result = await store.registerDevice(input, { epoch: pairing.epoch, providerGeneration: status.generation, isCurrent: () => authority().epoch === pairing.epoch });
      if (authority().epoch !== pairing.epoch) throw new Error("Pairing changed while registering notifications. Connect the Mac again.");
      return { ...result, notificationStatus: publicProviderState() };
    },
    async unregisterDevice(id) {
      const pairing = authority(); const status = providerState();
      return store.unregisterDevice(id, { epoch: pairing.epoch, providerGeneration: status.generation, isCurrent: () => authority().epoch === pairing.epoch });
    },
    async stop() { stopped = true; cancellation.abort(); if (running) await running.catch(() => {}); if (refreshing) await refreshing.catch(() => {}); },
  });
}

export function activitySnapshotEvents({ builds = [], liveDeliveries = [], previous = {}, knownEvents = [], now = Date.now() } = {}) {
  const entries = []; const observations = {};
  function add(key, event) {
    const fingerprint = activityEventId([event.kind, event.state, event.message, event.revision || 0, event.launchURL || ""]);
    observations[key] = fingerprint;
    if (previous[key] !== fingerprint) entries.push({ id: activityEventId(key), ...event });
  }
  for (const build of builds.slice(0, 500)) {
    if (!opaque(build?.id)) continue;
    const time = parseTime(build.updatedAt || build.createdAt, now);
    const base = { buildId: build.id, time, state: String(build.state || "unknown") };
    if (BUILD_PENDING.has(build.state)) add(`build:${build.id}`, { ...base, kind: "queued", title: "Preparing update", message: "Your signed update is being prepared.", notify: false });
    else if (build.state === "ready" && build.artifacts?.ipaPath && build.remoteBaseUrl && !build.tokenExpiredAt && Date.parse(build.expiresAt || "") > now) add(`build:${build.id}`, { ...base, kind: "build-ready", title: "New build ready", message: "Your signed update is ready to install." });
    else if (build.state === "ready") add(`build:${build.id}`, { ...base, state: build.tokenExpiredAt || (build.expiresAt && Date.parse(build.expiresAt) <= now) ? "expired" : "delivering", kind: "queued", title: build.tokenExpiredAt || (build.expiresAt && Date.parse(build.expiresAt) <= now) ? "Install link expired" : "Preparing install", message: build.tokenExpiredAt || (build.expiresAt && Date.parse(build.expiresAt) <= now) ? "Open app history for the current install action." : "The app is packaged; its install delivery is being prepared.", notify: false });
    else if (build.state === "failed") {
      const marker = String(build.logs?.at(-1) || "").match(/\[([A-Z][A-Z0-9_]{1,79})\]/)?.[1];
      const notice = buildFailureNotice({ code: marker || "BUILD_FAILED" });
      add(`build:${build.id}`, { ...base, kind: "attention", title: "Build needs attention", message: notice.message });
    }
    const installation = build.installation;
    if (["launch-confirmed", "verified"].includes(installation?.state) && Number.isFinite(Date.parse(installation?.launchConfirmedAt || ""))) add(`launch:${build.id}`, { buildId: build.id, time: parseTime(installation.launchConfirmedAt || installation.lastSeenAt || installation.verifiedAt, now), state: "launch-confirmed", kind: "launch-confirmed", title: "App launch confirmed", message: "The exact installed Debug build connected successfully." });
  }
  for (const input of liveDeliveries.slice(-256)) {
    const expiresAt = typeof input?.expiresAt === "number" ? input.expiresAt : Date.parse(input?.expiresAt || "");
    const record = Number.isFinite(expiresAt) && expiresAt <= now && ["queued", "compiling", "waiting-for-device", "waiting-for-foreground"].includes(input?.state) ? { ...input, state: "expired" } : input;
    if (!opaque(record?.requestId)) continue;
    const presentation = presentationForRecord(record, builds);
    const targetAppName = presentation.targetAppName || safeAppName(record.targetAppName);
    const cohortId = activityEventId(["live-cohort", record.scope?.appIdentity || "", record.scope?.binaryIdentity || record.requestId]);
    const base = { cohortId, ...(targetAppName ? { targetAppName } : {}), requestId: record.requestId, time: parseTime(record.updatedAt || record.createdAt, now), state: String(record.state || "unknown") };
    if (LIVE_PENDING.has(record.state)) {
      const waiting = ["waiting-for-device", "waiting-for-foreground"].includes(record.state) && /^[a-f0-9]{64}$/.test(record.preparedPatch?.patchDigest || "");
      add(`live:${record.requestId}`, { ...base, ...(waiting && presentation.launchURL ? { launchURL: presentation.launchURL } : {}), kind: "queued", title: waiting ? "Hot reload queued" : "Update waiting", message: record.state === "applied" ? "Application was acknowledged; its refresh is still unconfirmed." : waiting ? `Open ${targetAppName || "your app"} to apply the update. This may take a few seconds.` : "Your edit is being prepared for the matching app.", notify: waiting, notifyDelayMs: waiting ? 5000 : 0 });
    }
    else if (record.state === "refreshed" && completeLiveProof(record)) add(`live:${record.requestId}`, { ...base, kind: "live-applied", revision: record.proof.revision, title: "Update applied", message: "Your Debug app acknowledged the edit and refreshed." });
    else if (["uncertain", "failed"].includes(record.state)) add(`live:${record.requestId}`, { ...base, kind: "attention", title: "Update needs attention", message: record.state === "uncertain" ? "The update could not be confirmed. Open Swift Sim for its current status." : "The update did not complete. Open Swift Sim for its current status." });
    else if (["superseded", "expired"].includes(record.state)) add(`live:${record.requestId}`, { ...base, kind: "queued", title: record.state === "superseded" ? "Update replaced" : "Update expired", message: record.state === "superseded" ? "A later request now represents this edit." : "The pending request expired without confirmed completion.", notify: false });
  }
  for (const event of knownEvents) {
    if (event.buildId && !builds.some((build) => build.id === event.buildId)) {
      add(`missing:${event.id}`, { ...event, time: now, state: "unavailable", kind: "queued", title: "Build unavailable", message: "This build was removed or is no longer retained.", notify: false });
      continue;
    }
    if (event.kind === "queued" && event.requestId && !liveDeliveries.some((record) => record.requestId === event.requestId)) {
      add(`live:${event.requestId}`, { requestId: event.requestId, time: now, state: "unavailable", kind: "queued", title: "Update status unavailable", message: "This older request is no longer retained. Check the app's current activity.", notify: false });
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return { entries, observations };
}
function completeLiveProof(record) {
  const proof = record.proof;
  return typeof record.scope?.sessionIdentity === "string" && record.scope.sessionIdentity.length > 0 && typeof record.scope?.binaryIdentity === "string" && record.scope.binaryIdentity.length > 0 && Number.isSafeInteger(record.baselineRevision) && record.baselineRevision >= 0 && proof?.requestId === record.requestId && proof.sessionIdentity === record.scope?.sessionIdentity && proof.binaryIdentity === record.scope?.binaryIdentity
    && proof.patchDigest === record.preparedPatch?.patchDigest && /^[a-f0-9]{64}$/.test(proof.patchDigest || "")
    && proof.applied === true && proof.refreshed === true && Number.isSafeInteger(proof.revision) && proof.revision > record.baselineRevision;
}
function safeAppName(value) { return typeof value === "string" && value.length <= 60 && !/[\/\\\r\n]|https?:|Bearer |token=/i.test(value) ? value.trim() : ""; }
function presentationForRecord(record, builds) {
  for (const build of builds.slice(0, 500)) {
    const provenance = build?.liveReload?.recovery?.provenance;
    if (build?.state !== "ready" || String(build.configuration).toLowerCase() !== "debug" || build.liveReload?.eligible !== true || !isAbsolute(provenance?.projectPath || "")) continue;
    try {
      const identity = normalizedLiveBinaryIdentity(provenance.binaryIdentity);
      const project = resolve(provenance.projectPath);
      const canonicalProject = project.endsWith(".xcodeproj") ? join(project, "project.pbxproj") : project.endsWith(".xcworkspace") ? join(project, "contents.xcworkspacedata") : project;
      if (record.scope?.project !== canonicalProject || record.scope?.scheme !== provenance.scheme
        || record.scope?.appIdentity !== activityEventId([identity.bundle_id, identity.bundle_version, identity.build_number])
        || record.scope?.binaryIdentity !== `${identity.executable_uuid}:${identity.debug_dylib_uuid}`
        || build.app?.bundleIdentifier !== identity.bundle_id || build.app?.version !== identity.bundle_version || build.app?.build !== identity.build_number) continue;
      const targetAppName = safeAppName(build.liveReload.presentation?.targetAppName);
      const launchURL = safeActivityLaunchURL(build.liveReload.presentation?.launchURL);
      return { ...(targetAppName ? { targetAppName } : {}), ...(launchURL ? { launchURL } : {}) };
    } catch {}
  }
  return {};
}
function parseTime(value, fallback) { const time = typeof value === "number" ? value : Date.parse(value || ""); return Number.isFinite(time) && time >= 0 ? time : fallback; }
function opaque(value) { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
