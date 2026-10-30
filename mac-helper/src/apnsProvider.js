import { createHash, createPrivateKey, createPublicKey, randomUUID, sign } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { connect } from "node:http2";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { NodeAtomicFileStore, ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";

const DEFAULT_CONFIG = join(homedir(), ".swift-sim", "notifications", "apns.json");
const RETRY_REASONS = new Set(["TooManyRequests", "InternalServerError", "ServiceUnavailable", "Shutdown", "IdleTimeout"]);
const SAFE_REASONS = new Set([...RETRY_REASONS, "BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered", "ExpiredProviderToken", "InvalidProviderToken", "MissingProviderToken", "TopicDisallowed", "BadTopic", "BadPriority", "PayloadTooLarge", "BadExpirationDate", "Forbidden"]);

export function createApnsProvider({ configPath = DEFAULT_CONFIG, now = () => Date.now(), transport = sendApnsRequest } = {}) {
  let cachedToken;
  function configuration() {
    try { return loadConfiguration(configPath); } catch (error) {
      return { configured: false, generation: "unconfigured", reason: error?.code === "ENOENT" ? "APNS_NOT_CONFIGURED" : "APNS_CONFIGURATION_INVALID" };
    }
  }
  return Object.freeze({
    status() {
      const value = configuration();
      return { configured: value.configured, generation: value.generation, ...(value.reason ? { reason: value.reason } : {}) };
    },
    async send({ token, environment, payload, collapseId, apnsId, signal, expectedGeneration, isCurrent = () => true } = {}) {
      const value = configuration();
      if (!value.configured) return { state: "not-configured", reason: value.reason };
      if (expectedGeneration && expectedGeneration !== value.generation) return { state: "not-configured", reason: "APNS_CONFIGURATION_CHANGED" };
      if (!validDeviceToken(token) || !["sandbox", "production"].includes(environment)) return { state: "rejected", reason: "INVALID_DEVICE_REGISTRATION" };
      const encoded = JSON.stringify(payload);
      if (Buffer.byteLength(encoded) > 4096 || !/^[a-zA-Z0-9_-]{1,64}$/.test(collapseId || "") || !isUUID(apnsId)) return { state: "rejected", reason: "INVALID_NOTIFICATION" };
      if (signal?.aborted) return { state: "retry", reason: "CANCELLED" };
      const issuedAt = Math.floor(now() / 1000);
      if (!cachedToken || cachedToken.generation !== value.generation || issuedAt - cachedToken.issuedAt >= 50 * 60 || issuedAt < cachedToken.issuedAt) {
        const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: value.config.keyId })).toString("base64url");
        const claims = Buffer.from(JSON.stringify({ iss: value.config.teamId, iat: issuedAt })).toString("base64url");
        const content = `${header}.${claims}`;
        cachedToken = { generation: value.generation, issuedAt, token: `${content}.${sign("sha256", Buffer.from(content), { key: value.key, dsaEncoding: "ieee-p1363" }).toString("base64url")}` };
      }
      let response;
      try {
        response = await transport({ environment, token, body: encoded, signal, isCurrent: async () => {
          if (!await isCurrent()) return false;
          const latest = configuration();
          return !signal?.aborted && latest.configured && latest.generation === value.generation;
        }, headers: {
          authorization: `bearer ${cachedToken.token}`, "apns-topic": value.config.topic,
          "apns-push-type": "alert", "apns-priority": "10", "apns-id": apnsId,
          "apns-collapse-id": collapseId, "apns-expiration": String(Math.floor((now() + 60 * 60_000) / 1000)),
        } });
      } catch { return { state: "retry", reason: signal?.aborted ? "CANCELLED" : "APNS_TRANSPORT_ERROR" }; }
      if (response?.revoked) return { state: "rejected", reason: "NOTIFICATION_REVOKED" };
      const status = Number(response?.status || 0);
      const reason = SAFE_REASONS.has(response?.reason) ? response.reason : "APNS_REQUEST_REJECTED";
      if (status === 200) return { state: "accepted", reason: "APNS_ACCEPTED" };
      if (status === 410 || (status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic"].includes(reason))) return { state: "unregistered", reason };
      if (!status || status === 429 || status >= 500 || RETRY_REASONS.has(reason)) return { state: "retry", reason: !status ? "APNS_TRANSPORT_ERROR" : reason, retryAfterMs: boundedRetryAfter(response?.retryAfter, now()) };
      return { state: "rejected", reason };
    },
  });
}

export async function configureApnsProvider({ keyPath, keyId, teamId, topic }, { configPath = DEFAULT_CONFIG, fileStore = new NodeAtomicFileStore() } = {}) {
  const config = { ...normalizeConfiguration({ keyPath, keyId, teamId, topic }), revision: randomUUID() };
  const key = loadKey(config.keyPath);
  if (!key) throw new Error("The APNs signing key could not be validated.");
  assertPrivateParent(dirname(configPath));
  assertExistingConfiguration(configPath);
  ensureDirectoryModeSync(dirname(configPath), 0o700);
  await fileStore.writeJSON(configPath, config, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
  return { configured: true, message: "APNs credentials are configured locally. A push-enabled companion must register before alerts can be accepted by Apple." };
}

export async function disableApnsProvider({ configPath = DEFAULT_CONFIG, fileStore = new NodeAtomicFileStore() } = {}) {
  assertPrivateParent(dirname(configPath));
  assertExistingConfiguration(configPath);
  ensureDirectoryModeSync(dirname(configPath), 0o700);
  await fileStore.writeJSON(configPath, { enabled: false, revision: randomUUID() }, { mode: 0o600, createParentMode: 0o700, replace: true, syncDirectory: true });
  return { configured: false, reason: "APNS_DISABLED" };
}

export function apnsConfigurationStatus(options = {}) {
  const { generation: _generation, ...publicStatus } = createApnsProvider(options).status();
  return publicStatus;
}

function loadConfiguration(path) {
  assertPrivateFile(path, 16 * 1024);
  const raw = JSON.parse(readFileSync(path, "utf8"));
  if (raw.enabled === false) return { configured: false, generation: `disabled:${raw.revision || "legacy"}`, reason: "APNS_DISABLED" };
  const config = normalizeConfiguration(raw);
  const key = loadKey(config.keyPath);
  const publicKey = createPublicKey(key).export({ type: "spki", format: "der" });
  return { configured: true, config, key, generation: createHash("sha256").update(JSON.stringify(config)).update(publicKey).digest("hex") };
}
function normalizeConfiguration(value) {
  if (!value || !isAbsolute(value.keyPath || "") || !/^[A-Z0-9]{10}$/.test(value.keyId || "") || !/^[A-Z0-9]{10}$/.test(value.teamId || "") || !/^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$/.test(value.topic || "")) throw new Error("APNs configuration is invalid.");
  return { keyPath: resolve(value.keyPath), keyId: value.keyId, teamId: value.teamId, topic: value.topic, revision: isUUID(value.revision) ? value.revision : "legacy" };
}
function assertExistingConfiguration(path) {
  try { assertPrivateFile(path, 16 * 1024); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
function loadKey(path) {
  assertPrivateFile(path, 16 * 1024);
  const key = createPrivateKey(readFileSync(path));
  if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") throw new Error("APNs requires a P-256 signing key.");
  return key;
}
function assertPrivateFile(path, maximum) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()) || info.size > maximum) throw new Error("The APNs file must be a private regular file.");
}
function assertPrivateParent(path) {
  try {
    const info = lstatSync(path);
    if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid())) throw new Error("The notification directory is unsafe.");
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
}
export function validDeviceToken(value) { return typeof value === "string" && /^[a-fA-F0-9]{32,512}$/.test(value) && value.length % 2 === 0; }
function isUUID(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }
function boundedRetryAfter(value, time) {
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(String(value)) - time;
  return Number.isFinite(delay) ? Math.max(1000, Math.min(delay, 60 * 60_000)) : 30_000;
}

export function sendApnsRequest({ environment, token, body, headers, signal, timeoutMs = 10_000, connectImpl = connect, isCurrent = () => true }) {
  return new Promise((resolveRequest) => {
    let settled = false; let session; let request; let deadline; let received = 0; const chunks = [];
    const finish = (value) => {
      if (settled) return; settled = true; clearTimeout(deadline);
      signal?.removeEventListener("abort", aborted);
      request?.close(); session?.destroy(); resolveRequest(value);
    };
    const aborted = () => finish({ status: 0 });
    if (signal?.aborted) return aborted();
    signal?.addEventListener("abort", aborted, { once: true });
    deadline = setTimeout(() => finish({ status: 0 }), Math.max(1, Math.min(Number(timeoutMs) || 10_000, 10_000)));
    try {
      session = connectImpl(environment === "sandbox" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
      session.on("error", () => finish({ status: 0 }));
      session.on("connect", async () => {
        if (settled) return;
        let admitted = false;
        try { admitted = await isCurrent(); } catch {}
        if (settled) return;
        if (!admitted) return finish({ status: 0, revoked: true });
        try {
          let responseHeaders;
          request = session.request({ ":method": "POST", ":path": `/3/device/${token}`, ...headers });
          request.on("error", () => finish({ status: 0 }));
          request.on("response", (value) => { responseHeaders = value; });
          request.on("data", (chunk) => { received += chunk.length; if (received > 8192) finish({ status: 0 }); else chunks.push(chunk); });
          request.on("end", () => {
            let payload = {}; try { payload = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch {}
            finish({ status: responseHeaders?.[":status"] || 0, reason: payload.reason, retryAfter: responseHeaders?.["retry-after"] });
          });
          request.end(body);
        } catch { finish({ status: 0 }); }
      });
    } catch { finish({ status: 0 }); }
  });
}
