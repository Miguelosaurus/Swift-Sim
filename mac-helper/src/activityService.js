import { selectDeliveryPresentations } from "./deliveryPresentation.js";
import { activityEventId, safeActivityLaunchURL } from "./activityStore.js";
import { createApnsProvider } from "./apnsProvider.js";
import { isAbsolute, join, resolve } from "node:path";
import { normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";

const LIVE_PENDING = new Set(["queued", "compiling", "waiting-for-device", "waiting-for-foreground", "applying", "applied"]);
const BUILD_PENDING = new Set(["queued", "validating", "preparing", "archiving", "building", "exporting", "delivering"]);

export function activityLiveDeliveryView(queue) {
  const records = queue.pollingSnapshot().records;
  const pending = records.filter((record) => LIVE_PENDING.has(record.state));
  if (!pending.length) return records;
  const readiness = queue.readinessSnapshot(pending);
  return records.map((record) => readiness.has(record.requestId) ? { ...record, readiness: readiness.get(record.requestId) } : record);
}

export function createActivityService({ store, provider = createApnsProvider(), getPairing, listBuilds = () => [], listLiveDeliveries = () => [], readInstallPresentations = () => new Map(), now = () => Date.now() } = {}) {
  if (!store || typeof getPairing !== "function") throw new TypeError("Activity service requires a store and current pairing authority.");
  let running; let refreshing; let deliveryStatuses = {}; let statusEpoch = ""; let statusAt = 0; let stopped = false; const cancellation = new AbortController();
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
      const builds = listBuilds();
      const { entries, observations, presentations } = activitySnapshotEvents({ builds, installations: readInstallPresentations(builds), liveDeliveries: listLiveDeliveries(), previous: snapshot.observations, knownEvents: snapshot.events, now: now() });
      await store.sync({ entries, observations, epoch: pairing.epoch, providerGeneration: status.generation, notifyReady: status.configured === true, isCurrent: () => authority().epoch === pairing.epoch });
      deliveryStatuses = presentations; statusEpoch = pairing.epoch; statusAt = now();
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
    deliveryStatusForApp(appID) { return statusEpoch === authority().epoch && now() - statusAt <= 30000 ? structuredClone(deliveryStatuses[appID] || null) : null; },
    runOnce() {
      if (stopped) return Promise.resolve({ processed: false });
      if (running) return running;
      running = tick().finally(() => { running = null; }); return running;
    },
    feed({ after = 0, deviceId } = {}) {
      const pairing = authority();
      return { ...store.feed({ after, deviceId, epoch: pairing.epoch }), installationId: pairing.installationId, notificationStatus: publicProviderState(), deliveryStatus: { schemaVersion: 1, apps: statusEpoch === pairing.epoch && now() - statusAt <= 30000 ? structuredClone(deliveryStatuses) : {} } };
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

// Execute inside the store's existing locked read, before detached cloning.
// Notifications need neither historical log bodies nor compiler source maps.
export function activityBuildView(state) {
  return [...state.builds.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(build => ({
    id: build.id, origin: build.origin, appId: build.app?.identity, state: build.state, createdAt: build.createdAt, updatedAt: build.updatedAt,
    configuration: build.configuration, remoteBaseUrl: build.remoteBaseUrl,
    tokenExpiredAt: build.tokenExpiredAt, expiresAt: build.expiresAt,
    app: { identity: build.app?.identity, teamID: build.app?.teamID, name: build.app?.name, bundleIdentifier: build.app?.bundleIdentifier, version: build.app?.version, build: build.app?.build },
    artifacts: { ipaPath: build.artifacts?.ipaPath },
    logs: build.logs?.length ? [build.logs.at(-1)] : [],
    installation: { state: build.installation?.state, launchConfirmedAt: build.installation?.launchConfirmedAt, lastSeenAt: build.installation?.lastSeenAt, verifiedAt: build.installation?.verifiedAt },
    liveReload: { eligible: build.liveReload?.eligible, presentation: { targetAppName: build.liveReload?.presentation?.targetAppName, launchURL: build.liveReload?.presentation?.launchURL },
      recovery: { provenance: { projectPath: build.liveReload?.recovery?.provenance?.projectPath,
        scheme: build.liveReload?.recovery?.provenance?.scheme,
        binaryIdentity: build.liveReload?.recovery?.provenance?.binaryIdentity } } },
  }));
}

export function activitySnapshotEvents({ builds = [], liveDeliveries = [], installations = new Map(), previous = {}, knownEvents = [], now = Date.now() } = {}) {
  const entries = []; const observations = {}; const current = [];
  function add(key, event) {
    current.push(event);
    const fingerprint = activityEventId([event.kind, event.state, event.title, event.message, event.revision || 0, event.launchURL || ""]);
    observations[key] = fingerprint;
    if (previous[key] !== fingerprint) entries.push({ id: activityEventId(key), ...event });
  }
  for (const build of builds.slice(0, 500)) {
    if (!opaque(build?.id)) continue;
    const time = parseTime(build.updatedAt || build.createdAt, now);
    const targetAppName = safeAppName(build.app?.name);
    const title = (text) => targetAppName ? `${targetAppName} — ${text}` : text;
    const base = { appId: build.appId || build.app?.identity, intentAt: parseTime(build.createdAt, time), buildId: build.id, ...(targetAppName ? { targetAppName } : {}), time, state: String(build.state || "unknown") };
    const install = installations.get(build.id);
    if (BUILD_PENDING.has(build.state)) add(`build:${build.id}`, { ...base, kind: "queued", title: title("Building update"), message: "Your Mac is building a new version. We'll let you know when it's ready to install.", notify: false });
    else if (build.state === "failed") add(`build:${build.id}`, { ...base, kind: "attention", title: title("Build couldn't finish"), message: "Your Mac couldn't finish this build. Open Swift Sim for details." });
    else if (build.state === "ready" && ["verified","launch-confirmed"].includes(build.installation?.state)) add(`build:${build.id}`, { ...base, kind: "queued", state: "installed", deliveryCode: "BUILD_INSTALLED", deliveryAction: "none", title: title("Installed"), message: "This version was confirmed installed on your iPhone.", notify: false });
    else if (build.state === "ready" && ["unavailable","unconfirmed"].includes(install?.state)) add(`build:${build.id}`, { ...base, kind: "attention", state: "uncertain", deliveryCode: "UNCONFIRMED", deliveryAction: "check-status", title: title("Check installation status"), message: install.state === "unconfirmed" ? "The installation may have started. Ask your agent to check the existing request before trying again." : "Swift Sim couldn't read this installation's status. Ask your agent to check your Mac." });
    else if (build.state === "ready" && build.origin === "xcode") add(`build:${build.id}`, { ...base, kind: "queued", state: "recorded", deliveryCode: "BUILT_IN_XCODE", deliveryAction: "none", title: title("Built in Xcode"), message: "Awaiting confirmation from this exact app build.", notify: false });
    else if (build.state === "ready" && ["cancelled","rejected","expired"].includes(install?.state)) add(`build:${build.id}`, { ...base, kind: "queued", state: install.state, deliveryCode: install.state === "expired" ? "EXPIRED" : "INSTALL_CANCELLED", deliveryAction: "open-swift-sim", title: title(install.state === "expired" ? "Update expired" : "Installation stopped"), message: "Open this app's history in Swift Sim to check its latest install options.", notify: false });
    else if (build.state === "ready" && build.artifacts?.ipaPath && build.remoteBaseUrl && !build.tokenExpiredAt && Date.parse(build.expiresAt || "") > now) {
      const hints = installPresentation(install?.state || (build.installation?.state === "requested" ? "confirming" : ""), targetAppName);
      add(`build:${build.id}`, { ...base, ...hints, kind: "build-ready", title: title(hints.heading), message: hints.message });
    }
    else if (build.state === "ready") add(`build:${build.id}`, { ...base, state: build.tokenExpiredAt || (build.expiresAt && Date.parse(build.expiresAt) <= now) ? "expired" : "delivering", kind: "queued", title: title(build.tokenExpiredAt || (build.expiresAt && Date.parse(build.expiresAt) <= now) ? "Install link expired" : "Preparing install link"), message: build.tokenExpiredAt || (build.expiresAt && Date.parse(build.expiresAt) <= now) ? "Open this app's history in Swift Sim for the latest install options." : "Your build is complete. Swift Sim is preparing its install link.", notify: false });
    const installation = build.installation;
    if (["launch-confirmed", "verified"].includes(installation?.state) && Number.isFinite(Date.parse(installation?.launchConfirmedAt || ""))) add(`launch:${build.id}`, { ...base, time: parseTime(installation.launchConfirmedAt || installation.lastSeenAt || installation.verifiedAt, now), state: "launch-confirmed", kind: "launch-confirmed", title: title("Opened successfully"), message: "This version was confirmed running on your iPhone." });
  }
  for (const input of liveDeliveries.slice(-256)) {
    const expiresAt = typeof input?.expiresAt === "number" ? input.expiresAt : Date.parse(input?.expiresAt || "");
    const record = Number.isFinite(expiresAt) && expiresAt <= now && ["queued", "compiling", "waiting-for-device", "waiting-for-foreground"].includes(input?.state) ? { ...input, state: "expired" } : input;
    if (!opaque(record?.requestId)) continue;
    const presentation = presentationForRecord(record, builds);
    const targetAppName = presentation.targetAppName || safeAppName(record.targetAppName);
    const title = (text) => targetAppName ? `${targetAppName} — ${text}` : text;
    const cohortId = activityEventId(["live-cohort", record.scope?.appIdentity || "", record.scope?.binaryIdentity || record.requestId]);
    const base = { appId: presentation.appId, intentAt: parseTime(record.createdAt, now), cohortId, ...(targetAppName ? { targetAppName } : {}), requestId: record.requestId, time: parseTime(record.updatedAt || record.createdAt, now), state: String(record.state || "unknown") };
    const fault = record.readiness && !["LIVE_READY", "LIVE_PREPARING", "LIVE_READINESS_CHECKING"].includes(record.readiness.code);
    if (LIVE_PENDING.has(record.state) && fault) {
      const mismatch = ["LIVE_CAPTURE_MISMATCH", "LIVE_TARGET_APP_MISMATCH"].includes(record.readiness.code);
      add(`live:${record.requestId}`, { ...base, state: record.readiness.code, time: parseTime(record.readiness.changedAt, base.time), kind: "attention", title: title(mismatch ? "Check app version" : "Update needs your Mac"), message: mismatch ? "This update needs its matching app version. Check Swift Sim on your Mac before continuing." : "Hot reload is paused. Check Swift Sim on your Mac to continue this update." });
    }
    else if (LIVE_PENDING.has(record.state)) {
      const waiting = ["waiting-for-device", "waiting-for-foreground"].includes(record.state) && /^[a-f0-9]{64}$/.test(record.preparedPatch?.patchDigest || "");
      const finishing = ["applying", "applied"].includes(record.state);
      add(`live:${record.requestId}`, { ...base, ...(waiting && presentation.launchURL ? { launchURL: presentation.launchURL } : {}), kind: "queued", title: title(waiting ? "Ready to apply" : finishing ? "Finishing update" : "Preparing changes"), message: waiting ? `Open ${targetAppName || "your app"} to apply your latest changes. No install needed.` : finishing ? "Your changes are being applied. Waiting for the app to confirm they're ready." : "Your Mac is preparing your latest changes.", notify: waiting, notifyDelayMs: waiting ? 5000 : 0 });
    }
    else if (record.state === "refreshed" && completeLiveProof(record)) add(`live:${record.requestId}`, { ...base, kind: "live-applied", revision: record.proof.revision, title: targetAppName ? `${targetAppName} updated` : "Changes applied", message: "Your changes were applied successfully. They're ready to try." });
    else if (record.state === "refreshed") current.push({ ...base, kind: "attention", state: "uncertain", title: title("Check update status"), message: "The app's complete update confirmation is missing. Ask your agent to check the existing request." });
    else if (["uncertain", "failed"].includes(record.state)) add(`live:${record.requestId}`, { ...base, kind: "attention", title: title(record.state === "uncertain" ? "Check update status" : "Update couldn't finish"), message: record.state === "uncertain" ? "We couldn't confirm your changes were applied. Open Swift Sim to check the update." : "Your changes couldn't be applied. Open Swift Sim for details." });
    else if (["superseded", "expired"].includes(record.state)) add(`live:${record.requestId}`, { ...base, kind: "queued", title: title(record.state === "superseded" ? "Newer update available" : "Update expired"), message: record.state === "superseded" ? "A newer update has replaced these changes. Check the latest update for its status." : "These changes weren't confirmed before the update expired. Open Swift Sim for the latest status.", notify: false });
  }
  for (const event of knownEvents) {
    if (event.buildId && !builds.some((build) => build.id === event.buildId)) {
      const name = safeAppName(event.targetAppName);
      add(`missing:${event.id}`, { ...event, time: now, state: "unavailable", kind: "queued", title: name ? `${name} — Build no longer available` : "Build no longer available", message: "This build is no longer available. Open the app's history for its latest version.", notify: false });
      continue;
    }
    if (event.kind === "queued" && event.requestId && !liveDeliveries.some((record) => record.requestId === event.requestId)) {
      const name = safeAppName(event.targetAppName);
      add(`live:${event.requestId}`, { requestId: event.requestId, ...(name ? { targetAppName: name } : {}), time: now, state: "unavailable", kind: "queued", title: name ? `${name} — Check latest update` : "Check latest update", message: "This older update is no longer available. Check the app's latest activity for its current status.", notify: false });
    }
  }
  entries.sort((a, b) => a.time - b.time);
  return { entries, observations, presentations: selectDeliveryPresentations(current) };
}
function completeLiveProof(record) {
  const proof = record.proof;
  return typeof record.scope?.sessionIdentity === "string" && record.scope.sessionIdentity.length > 0 && typeof record.scope?.binaryIdentity === "string" && record.scope.binaryIdentity.length > 0 && Number.isSafeInteger(record.baselineRevision) && record.baselineRevision >= 0 && proof?.requestId === record.requestId && proof.sessionIdentity === record.scope?.sessionIdentity && proof.binaryIdentity === record.scope?.binaryIdentity
    && proof.patchDigest === record.preparedPatch?.patchDigest && /^[a-f0-9]{64}$/.test(proof.patchDigest || "")
    && proof.applied === true && proof.refreshed === true && Number.isSafeInteger(proof.revision) && proof.revision > record.baselineRevision;
}
function safeAppName(value) { return typeof value === "string" && value.length <= 60 && !/[\/\\\u0000-\u001f\u007f]|https?:|Bearer |token=/i.test(value) ? value.trim() : ""; }
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
      return { appId: build.appId || build.app?.identity, ...(targetAppName ? { targetAppName } : {}), ...(launchURL ? { launchURL } : {}) };
    } catch {}
  }
  return {};
}
function parseTime(value, fallback) { const time = typeof value === "number" ? value : Date.parse(value || ""); return Number.isFinite(time) && time >= 0 ? time : fallback; }
function opaque(value) { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }

function installPresentation(state, name) {
  if (state === "waiting") return { heading: "Ready to install", message: `Open ${name || "your app"} to install the update. Confirm Install when iOS asks.`, deliveryCode: "INSTALL_QUEUED", deliveryAction: "open-app" };
  if (["opening", "prompt-requested"].includes(state)) return { heading: "Confirm installation", message: "Confirm Install on your iPhone, and Download if iOS asks about cellular data. Installation is confirmed separately.", deliveryCode: "CONFIRM_INSTALL", deliveryAction: "confirm-install" };
  if (state === "confirming") return { heading: "Checking installation", message: "Your Mac recorded the install request. Ask your agent to check that existing request for confirmation.", deliveryCode: "INSTALL_CONFIRMING", deliveryAction: "check-status" };
  return { heading: "Ready to install", message: "Your new version is ready. Open Swift Sim to install it.", deliveryCode: "READY_TO_INSTALL", deliveryAction: "open-swift-sim" };
}
