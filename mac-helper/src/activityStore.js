import { createHash, randomUUID } from "node:crypto";
import { lstatSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { NodeAtomicFileStore, ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { validDeviceToken } from "./apnsProvider.js";

export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({ buildReady: true, attention: true, hotReload: true, launchConfirmed: false, queued: true });
const PREFERENCE_FOR_KIND = { queued: "queued", "build-ready": "buildReady", attention: "attention", "live-applied": "hotReload", "launch-confirmed": "launchConfirmed" };
const KINDS = new Set(["queued", "live-applied", "build-ready", "attention", "launch-confirmed"]);
const MAX_EVENTS = 500;
const MAX_DEVICES = 256;
const MAX_JOBS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;
const EVENT_TTL = 7 * 24 * 60 * 60_000;
const PUSH_TTL = 60 * 60_000;

export function createActivityStore({ rootPath = join(homedir(), ".swift-sim", "notifications"), fileStore = new NodeAtomicFileStore(), lockManager, now = () => Date.now(), newId = randomUUID } = {}) {
  if (!isAbsolute(rootPath || "")) throw failure("ACTIVITY_ROOT_INVALID");
  const root = resolve(rootPath); const path = join(root, "activity.json");
  function read() {
    assertPrivate(root, "directory");
    const stat = assertPrivate(path, "file");
    if (!stat) return { schemaVersion: 1, nextSequence: 1, epoch: "", providerGeneration: "unconfigured", initialized: false, events: [], devices: [], jobs: [], observations: {}, quietCohorts: [] };
    if (stat.size > MAX_BYTES) throw failure("ACTIVITY_STORE_INVALID");
    let value; try { value = fileStore.readJSONSync(path); validateJournal(value); value.quietCohorts ||= []; } catch { throw failure("ACTIVITY_STORE_INVALID"); }
    return value;
  }
  async function mutate(operation) {
    if (!lockManager || typeof lockManager.withLock !== "function") throw failure("ACTIVITY_LOCK_REQUIRED");
    assertPrivate(root, "directory"); ensureDirectoryModeSync(root, 0o700);
    return lockManager.withLock({ path: join(root, "activity.lock"), waitMs: 5000, staleAfterMs: 1000, ownerMode: 0o600 }, async () => {
      const journal = read(); const previous = JSON.stringify(journal); const time = now();
      const result = operation(journal, time);
      prune(journal, time);
      const encoded = JSON.stringify(journal);
      if (Buffer.byteLength(encoded) > MAX_BYTES) throw failure("ACTIVITY_CAPACITY_EXHAUSTED");
      if (encoded !== previous) await fileStore.writeJSON(path, journal, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
      return structuredClone(result);
    });
  }
  function context(journal, epoch, generation, isCurrent) {
    if (isCurrent && !isCurrent()) throw failure("ACTIVITY_AUTHORITY_CHANGED");
    if (!validEpoch(epoch)) throw failure("ACTIVITY_AUTHORITY_REQUIRED");
    if (journal.epoch !== epoch) { journal.epoch = epoch; journal.devices = []; journal.jobs = []; journal.quietCohorts = []; }
    if (journal.providerGeneration !== generation) { journal.providerGeneration = generation; journal.jobs = []; }
  }
  return Object.freeze({
    snapshot: () => structuredClone(read()),
    feed({ after = 0, deviceId, epoch } = {}) {
      if (!Number.isSafeInteger(after) || after < 0) throw failure("ACTIVITY_CURSOR_INVALID");
      const value = read();
      const matching = value.events.filter((event) => event.sequence > after);
      const events = matching.slice(-200).map(publicEvent);
      const device = value.epoch === epoch ? value.devices.find((item) => item.id === deviceId) : null;
      return { schemaVersion: 1, events, cursor: value.nextSequence - 1, truncated: matching.length > 200, ...(device ? { preferences: device.preferences } : {}) };
    },
    async sync({ entries, observations, epoch, providerGeneration = "unconfigured", notifyReady = false, isCurrent } = {}) {
      return mutate((journal, time) => {
        context(journal, epoch, providerGeneration, isCurrent);
        const initial = !journal.initialized;
        for (const input of entries) {
          const event = normalizeEvent(input, time);
          const existing = journal.events.find((item) => item.id === event.id);
          if (existing && ["kind", "state", "title", "message", "revision", "launchURL"].every((key) => existing[key] === event[key])) continue;
          journal.events = journal.events.filter((item) => item.id !== event.id);
          journal.jobs = journal.jobs.filter((item) => item.eventId !== event.id);
          if (event.kind === "live-applied") { journal.jobs = journal.jobs.filter((job) => job.collapseId !== event.cohortId); journal.quietCohorts = journal.quietCohorts.filter((item) => item.collapseId !== event.cohortId); }
          journal.events.push({ ...event, ...(existing ? { createdAt: existing.createdAt, updatedAt: event.createdAt } : {}), sequence: journal.nextSequence++ });
          if (initial || !notifyReady || input.notify === false || time - event.time > PUSH_TTL) continue;
          const preference = PREFERENCE_FOR_KIND[event.kind];
          if (!preference) continue;
          for (const device of journal.devices) {
            if (!device.token || !device.enabled || !device.preferences[preference] || device.registeredAt > event.time || device.epoch !== epoch) continue;
            const collapseId = event.cohortId || event.id;
            if (event.kind === "queued" && journal.quietCohorts.some((item) => item.deviceId === device.id && item.collapseId === collapseId && item.expiresAt > time)) continue;
            if (event.kind === "queued") journal.jobs = journal.jobs.filter((job) => job.deviceId !== device.id || job.collapseId !== collapseId);
            if (journal.jobs.length >= MAX_JOBS) break;
            journal.jobs.push({ id: newId(), collapseId, eventId: event.id, deviceId: device.id, registrationRevision: device.revision, epoch, providerGeneration, attempts: 0, nextAttemptAt: Math.max(time + (event.kind === "attention" ? 1000 : 0), event.time + event.notifyDelayMs), expiresAt: Math.min(event.time + PUSH_TTL, time + PUSH_TTL), state: "pending", claim: null });
          }
        }
        journal.observations = Object.fromEntries(Object.entries(observations || {}).slice(-2000));
        journal.initialized = true;
        return { initial, events: journal.events.length };
      });
    },
    async registerDevice(input, { epoch, providerGeneration = "unconfigured", isCurrent } = {}) {
      if (!uuid(input?.deviceId) || !["sandbox", "production"].includes(input?.environment) || (input.token !== undefined && input.token !== "" && !validDeviceToken(input.token))) throw failure("ACTIVITY_DEVICE_INVALID");
      const preferences = normalizePreferences(input.preferences);
      return mutate((journal, time) => {
        context(journal, epoch, providerGeneration, isCurrent);
        const existing = journal.devices.find((item) => item.id === input.deviceId);
        if (!existing && journal.devices.length >= MAX_DEVICES) throw failure("ACTIVITY_DEVICE_LIMIT");
        const token = input.token === undefined ? existing?.token || "" : String(input.token).toLowerCase();
        const mergedPreferences = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...existing?.preferences || {}, ...preferences };
        if (existing && existing.token === token && existing.environment === input.environment && JSON.stringify(existing.preferences) === JSON.stringify(mergedPreferences)) return { registered: true, preferences: mergedPreferences };
        journal.devices = journal.devices.filter((item) => item.id !== input.deviceId);
        journal.jobs = journal.jobs.filter((job) => job.deviceId !== input.deviceId);
        journal.devices.push({ id: input.deviceId, revision: newId(), epoch, token, environment: input.environment, preferences: mergedPreferences, enabled: Boolean(token), registeredAt: time });
        return { registered: true, preferences: mergedPreferences };
      });
    },
    async unregisterDevice(deviceId, { epoch, providerGeneration = "unconfigured", isCurrent } = {}) {
      if (!uuid(deviceId)) throw failure("ACTIVITY_DEVICE_INVALID");
      return mutate((journal) => {
        context(journal, epoch, providerGeneration, isCurrent);
        journal.devices = journal.devices.filter((item) => item.id !== deviceId);
        journal.jobs = journal.jobs.filter((item) => item.deviceId !== deviceId);
        return { removed: true };
      });
    },
    async claimNext({ epoch, providerGeneration, isCurrent } = {}) {
      return mutate((journal, time) => {
        context(journal, epoch, providerGeneration, isCurrent);
        prune(journal, time);
        const job = journal.jobs.find((item) => item.nextAttemptAt <= time && (!item.claim || item.claim.expiresAt <= time));
        if (!job) return null;
        const device = journal.devices.find((item) => item.id === job.deviceId && item.revision === job.registrationRevision);
        const event = journal.events.find((item) => item.id === job.eventId);
        if (!device || !event || !device.enabled || !device.token || !device.preferences[PREFERENCE_FOR_KIND[event.kind]]) { journal.jobs = journal.jobs.filter((item) => item.id !== job.id); return null; }
        job.claim = { token: newId(), expiresAt: time + 30_000 }; job.state = "sending";
        return { job, device, event: publicEvent(event) };
      });
    },
    claimIsCurrent(id, token, { epoch, providerGeneration } = {}) {
      const journal = read();
      return journal.epoch === epoch && journal.providerGeneration === providerGeneration && journal.jobs.some((job) => job.id === id && job.claim?.token === token && job.claim.expiresAt > now() && job.expiresAt > now() && job.epoch === epoch && job.providerGeneration === providerGeneration && journal.devices.some((device) => device.id === job.deviceId && device.revision === job.registrationRevision && device.enabled));
    },
    async settle(id, claimToken, outcome, { epoch, providerGeneration } = {}) {
      return mutate((journal, time) => {
        if (journal.epoch !== epoch || journal.providerGeneration !== providerGeneration) return false;
        const job = journal.jobs.find((item) => item.id === id);
        if (!job || job.claim?.token !== claimToken) return false;
        const device = journal.devices.find((item) => item.id === job.deviceId && item.revision === job.registrationRevision);
        if (!device) return false;
        const event = journal.events.find((item) => item.id === job.eventId);
        if (outcome.state === "accepted" && event?.kind === "queued") journal.quietCohorts.push({ deviceId: device.id, collapseId: job.collapseId, expiresAt: time + 10 * 60_000 });
        if (outcome.state === "unregistered") { device.token = ""; device.enabled = false; }
        if (outcome.state === "retry" && ++job.attempts < 6 && job.expiresAt > time) {
          job.nextAttemptAt = time + Math.max(1000, Math.min(Number(outcome.retryAfterMs) || 30_000 * 2 ** (job.attempts - 1), 15 * 60_000));
          job.state = "pending"; job.claim = null;
        } else {
          if (event) event.lastPushState = outcome.state === "accepted" ? "accepted" : "not-accepted";
          journal.jobs = journal.jobs.filter((item) => item.id !== id);
        }
        return true;
      });
    },
  });
}

function normalizeEvent(value, time) {
  if (!KINDS.has(value?.kind) || !/^[a-f0-9]{64}$/.test(value?.id || "") || !Number.isFinite(value.time)) throw failure("ACTIVITY_EVENT_INVALID");
  const launchURL = value.kind === "queued" && !["expired", "superseded", "unavailable", "failed"].includes(value.state) ? safeActivityLaunchURL(value.launchURL) : "";
  return { id: value.id, ...(launchURL ? { launchURL } : {}), ...(typeof value.cohortId === "string" && /^[a-f0-9]{64}$/.test(value.cohortId) ? { cohortId: value.cohortId } : {}), notifyDelayMs: Math.max(0, Math.min(Number(value.notifyDelayMs) || 0, 60_000)), ...(typeof value.targetAppName === "string" ? { targetAppName: boundedText(value.targetAppName, 60) } : {}), kind: value.kind, title: boundedText(value.title, 100), message: boundedText(value.message, 240), state: boundedText(value.state, 40), time: Math.min(time, Math.max(0, value.time)), createdAt: new Date(Math.min(time, Math.max(0, value.time))).toISOString(), ...(opaque(value.buildId) ? { buildId: value.buildId } : {}), ...(opaque(value.requestId) ? { requestId: value.requestId } : {}), ...(Number.isSafeInteger(value.revision) && value.revision > 0 ? { revision: value.revision } : {}) };
}
function publicEvent(value) {
  return { id: value.id, sequence: value.sequence, kind: value.kind, title: value.title, message: value.message, state: value.state, createdAt: value.createdAt,
    ...(value.updatedAt ? { updatedAt: value.updatedAt } : {}), ...(value.buildId ? { buildId: value.buildId } : {}), ...(value.requestId ? { requestId: value.requestId } : {}),
    ...(value.revision ? { revision: value.revision } : {}), ...(value.targetAppName ? { targetAppName: value.targetAppName } : {}), ...(value.launchURL ? { launchURL: value.launchURL } : {}) };
}
export function activityEventId(value) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function safeActivityLaunchURL(value) {
  if (typeof value !== "string" || value.length > 512 || /[\s\u0000-\u001f\u007f]/.test(value)) return "";
  try {
    const url = new URL(value); const scheme = url.protocol.slice(0, -1).toLowerCase();
    if (!scheme || ["http", "https", "file", "data", "javascript", "tel", "sms", "facetime", "mailto", "itms-services", "itms-apps", "swift-sim", "swiftsim", "app-settings"].includes(scheme) || url.username || url.password || url.search || url.hash) return "";
    return url.href;
  } catch { return ""; }
}
function normalizePreferences(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !(Object.hasOwn(DEFAULT_NOTIFICATION_PREFERENCES, key)) || typeof value[key] !== "boolean")) throw failure("ACTIVITY_PREFERENCES_INVALID");
  return value;
}
function prune(journal, time) {
  journal.quietCohorts = (journal.quietCohorts || []).filter((item) => item.expiresAt > time).slice(-1000);
  journal.events = journal.events.filter((event) => event.time + EVENT_TTL > time).slice(-MAX_EVENTS);
  const events = new Set(journal.events.map((event) => event.id));
  journal.jobs = journal.jobs.filter((job) => events.has(job.eventId) && job.expiresAt > time && job.epoch === journal.epoch && job.providerGeneration === journal.providerGeneration && journal.devices.some((device) => device.id === job.deviceId && device.revision === job.registrationRevision && device.enabled)).slice(-MAX_JOBS);
}
function validateJournal(value) {
  if (!value || value.schemaVersion !== 1 || !Number.isSafeInteger(value.nextSequence) || value.nextSequence < 1 || typeof value.initialized !== "boolean" || typeof value.epoch !== "string" || typeof value.providerGeneration !== "string" || !Array.isArray(value.events) || value.events.length > MAX_EVENTS || !Array.isArray(value.devices) || value.devices.length > MAX_DEVICES || !Array.isArray(value.jobs) || value.jobs.length > MAX_JOBS || !value.observations || typeof value.observations !== "object" || Array.isArray(value.observations) || Object.keys(value.observations).length > 2000) throw failure("ACTIVITY_STORE_INVALID");
  if (value.quietCohorts !== undefined && (!Array.isArray(value.quietCohorts) || value.quietCohorts.length > 1000 || value.quietCohorts.some((item) => !uuid(item.deviceId) || !/^[a-f0-9]{64}$/.test(item.collapseId || "") || !Number.isSafeInteger(item.expiresAt)))) throw failure("ACTIVITY_STORE_INVALID");
  let sequence = 0; const ids = new Set();
  for (const event of value.events) { normalizeEvent(event, Number.MAX_SAFE_INTEGER); if (!Number.isSafeInteger(event.sequence) || event.sequence <= sequence || ids.has(event.id)) throw failure("ACTIVITY_STORE_INVALID"); sequence = event.sequence; ids.add(event.id); }
  if (value.nextSequence <= sequence) throw failure("ACTIVITY_STORE_INVALID");
  for (const device of value.devices) if (!uuid(device.id) || !uuid(device.revision) || !validEpoch(device.epoch) || typeof device.token !== "string" || (device.token && !validDeviceToken(device.token)) || !["sandbox", "production"].includes(device.environment) || typeof device.enabled !== "boolean" || !Number.isSafeInteger(device.registeredAt)) throw failure("ACTIVITY_STORE_INVALID"); else normalizePreferences(device.preferences);
  for (const job of value.jobs) if (!uuid(job.id) || !uuid(job.deviceId) || !uuid(job.registrationRevision) || !validEpoch(job.epoch) || !/^[a-f0-9]{64}$/.test(job.eventId) || !Number.isSafeInteger(job.attempts) || job.attempts < 0 || job.attempts >= 6 || !Number.isSafeInteger(job.nextAttemptAt) || !Number.isSafeInteger(job.expiresAt) || !["pending", "sending"].includes(job.state) || (job.claim && (!uuid(job.claim.token) || !Number.isSafeInteger(job.claim.expiresAt)))) throw failure("ACTIVITY_STORE_INVALID");
}
function assertPrivate(path, kind) {
  let info; try { info = lstatSync(path); } catch (error) { if (error?.code === "ENOENT") return null; throw failure("ACTIVITY_STORE_UNREADABLE"); }
  if (info.isSymbolicLink() || (kind === "file" ? !info.isFile() || info.nlink !== 1 : !info.isDirectory()) || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw failure("ACTIVITY_STORE_UNSAFE");
  return info;
}
function boundedText(value, maximum) { return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, maximum); }
function opaque(value) { return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value); }
function validEpoch(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }
function uuid(value) { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value); }
function failure(code) { return Object.assign(new Error(`Swift Sim activity: ${code}.`), { code }); }
