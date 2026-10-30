import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomUUID, verify } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeAtomicFileStore } from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import { configureApnsProvider, createApnsProvider, disableApnsProvider, apnsConfigurationStatus } from "../mac-helper/src/apnsProvider.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-apns-")); const keyPath = join(root, "PushKey.p8"); const configPath = join(root, "notifications", "apns.json");
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
  const config = { keyPath, keyId: "KEY1234567", teamId: "TEAM123456", topic: "dev.local.SwiftSimCompanion" };
  const message = { token: "ab".repeat(32), environment: "sandbox", payload: { aps: { alert: { title: "Build ready", body: "Open Swift Sim" } } }, collapseId: createHash("sha256").update("event").digest("hex"), apnsId: randomUUID() };
  let response = { status: 200 }; const sent = []; let clock = 1_800_000_000_000;
  const provider = createApnsProvider({ configPath, now: () => clock, transport: async (request) => { sent.push(request); return response; } });
  return { root, keyPath, configPath, config, message, publicKey, provider, sent, setResponse(value) { response = value; }, advance(ms) { clock += ms; }, configure: () => configureApnsProvider(config, { configPath }), cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("APNs signs ES256 provider credentials privately and 200 means accepted, not displayed", async () => {
  const f = fixture(); try {
    await f.configure(); const outcome = await f.provider.send(f.message);
    assert.deepEqual(outcome, { state: "accepted", reason: "APNS_ACCEPTED" });
    const input = f.sent[0]; assert.equal(input.environment, "sandbox");
    const jwt = input.headers.authorization.slice("bearer ".length).split(".");
    assert.deepEqual(JSON.parse(Buffer.from(jwt[0], "base64url")), { alg: "ES256", kid: f.config.keyId });
    assert.equal(JSON.parse(Buffer.from(jwt[1], "base64url")).iss, f.config.teamId);
    assert.equal(Buffer.from(jwt[2], "base64url").length, 64);
    assert.equal(verify("sha256", Buffer.from(jwt.slice(0, 2).join(".")), { key: f.publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(jwt[2], "base64url")), true);
    assert.equal(input.headers["apns-push-type"], "alert");
    assert.equal(input.headers["apns-collapse-id"], f.message.collapseId);
    assert.equal(lstatSync(f.configPath).mode & 0o777, 0o600);
    assert.doesNotMatch(JSON.stringify(apnsConfigurationStatus({ configPath: f.configPath })), /PushKey|KEY123|TEAM123|PRIVATE KEY|keyPath/);
    await f.provider.send(f.message); assert.equal(f.sent[1].headers.authorization, input.headers.authorization);
    f.advance(51 * 60_000); await f.provider.send(f.message); assert.notEqual(f.sent[2].headers.authorization, input.headers.authorization);
  } finally { f.cleanup(); }
});

test("unregistered tokens and transient failures have distinct bounded recovery", async () => {
  const f = fixture(); try {
    await f.configure();
    for (const response of [{ status: 410, reason: "Unregistered" }, { status: 400, reason: "BadDeviceToken" }]) {
      f.setResponse(response); assert.equal((await f.provider.send(f.message)).state, "unregistered");
    }
    f.setResponse({ status: 429, reason: "TooManyRequests", retryAfter: "999999" });
    assert.equal((await f.provider.send(f.message)).retryAfterMs, 60 * 60_000);
    f.setResponse({ status: 503, reason: "ServiceUnavailable" }); assert.equal((await f.provider.send(f.message)).state, "retry");
    f.setResponse({ status: 403, reason: "InvalidProviderToken" }); assert.equal((await f.provider.send(f.message)).state, "rejected");
    f.setResponse({ status: 400, reason: "private /Users/secret Bearer key" });
    assert.deepEqual(await f.provider.send(f.message), { state: "rejected", reason: "APNS_REQUEST_REJECTED" });
  } finally { f.cleanup(); }
});

test("missing, broad, linked and wrong-curve credentials fail without network or secret diagnostics", async () => {
  const f = fixture(); try {
    assert.equal(f.provider.status().configured, false); assert.equal((await f.provider.send(f.message)).state, "not-configured");
    await f.configure(); chmodSync(f.keyPath, 0o644); assert.equal(f.provider.status().configured, false); chmodSync(f.keyPath, 0o600);
    const safe = join(f.root, "original-key"); writeFileSync(safe, new NodeAtomicFileStore().readTextSync(f.keyPath), { mode: 0o600 }); rmSync(f.keyPath); symlinkSync(safe, f.keyPath);
    assert.equal(f.provider.status().configured, false); assert.equal(f.sent.length, 0);
    rmSync(f.keyPath); const wrong = generateKeyPairSync("ec", { namedCurve: "secp384r1" }); writeFileSync(f.keyPath, wrong.privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    assert.equal(f.provider.status().configured, false);
  } finally { f.cleanup(); }
});

test("disable/reconfigure fences old jobs even when a poll missed the disabled state", async () => {
  const f = fixture(); try {
    await f.configure(); const original = f.provider.status().generation;
    await disableApnsProvider({ configPath: f.configPath });
    assert.deepEqual(apnsConfigurationStatus({ configPath: f.configPath }), { configured: false, reason: "APNS_DISABLED" });
    await f.configure(); assert.notEqual(f.provider.status().generation, original);
    assert.deepEqual(await f.provider.send({ ...f.message, expectedGeneration: original }), { state: "not-configured", reason: "APNS_CONFIGURATION_CHANGED" });
    assert.equal(f.sent.length, 0);
  } finally { f.cleanup(); }
});

test("malformed registration, oversized payload and cancellation never send", async () => {
  const f = fixture(); try {
    await f.configure();
    assert.equal((await f.provider.send({ ...f.message, token: "bad" })).state, "rejected");
    assert.equal((await f.provider.send({ ...f.message, payload: { text: "x".repeat(5000) } })).state, "rejected");
    const controller = new AbortController(); controller.abort(); assert.equal((await f.provider.send({ ...f.message, signal: controller.signal })).reason, "CANCELLED");
    assert.equal(f.sent.length, 0);
  } finally { f.cleanup(); }
});

test("actual HTTP2 adapter aborts an unresponsive connection on its absolute deadline", async () => {
  const { EventEmitter } = await import("node:events");
  const { sendApnsRequest } = await import("../mac-helper/src/apnsProvider.js");
  const session = new EventEmitter(); let destroyed = false; session.destroy = () => { destroyed = true; };
  const started = Date.now();
  const result = await sendApnsRequest({ environment: "sandbox", token: "ab".repeat(32), body: "{}", headers: {}, timeoutMs: 25,
    connectImpl(origin) { assert.equal(origin, "https://api.sandbox.push.apple.com"); return session; } });
  assert.deepEqual(result, { status: 0 }); assert.equal(destroyed, true); assert.ok(Date.now() - started < 500);
});

test("actual HTTP2 adapter bounds response bytes and cancellation closes active streams", async () => {
  const { EventEmitter } = await import("node:events");
  const { sendApnsRequest } = await import("../mac-helper/src/apnsProvider.js");
  for (const cancel of [false, true]) {
    const session = new EventEmitter(); const request = new EventEmitter(); let destroyed = false; let closed = false;
    session.destroy = () => { destroyed = true; }; request.close = () => { closed = true; };
    const controller = new AbortController();
    session.request = () => request;
    request.end = () => { if (cancel) controller.abort(); else { request.emit("response", { ":status": 503 }); request.emit("data", Buffer.alloc(8193)); } };
    const promise = sendApnsRequest({ environment: "production", token: "ab".repeat(32), body: "{}", headers: {}, signal: controller.signal, timeoutMs: 500, connectImpl: () => session });
    session.emit("connect"); const result = await promise;
    assert.deepEqual(result, { status: 0 }); assert.equal(closed, true); assert.equal(destroyed, true);
  }
});
