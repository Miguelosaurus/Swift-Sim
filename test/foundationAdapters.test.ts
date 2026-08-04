import assert from "node:assert/strict";
import test from "node:test";
import { LoopbackRequestOriginPolicy } from "../mac-helper/src/infrastructure/loopbackRequestOriginPolicy.js";
import { SystemClock } from "../mac-helper/src/infrastructure/systemClock.js";
import { SystemIdGenerator } from "../mac-helper/src/infrastructure/systemIdGenerator.js";

const originPolicy = new LoopbackRequestOriginPolicy();

test("system clock returns wall and monotonic time and honors cancellation", async () => {
  const clock = new SystemClock();
  const wallBefore = Date.now();
  const now = clock.now().getTime();
  const wallAfter = Date.now();
  assert.ok(now >= wallBefore && now <= wallAfter);
  assert.ok(Number.isFinite(clock.monotonicMilliseconds()));
  await assert.rejects(clock.sleep(-1), RangeError);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(clock.sleep(1_000, controller.signal), { name: "AbortError" });
});

test("system ID generator returns UUIDs and bounded base64url tokens", () => {
  const generator = new SystemIdGenerator();
  assert.match(
    generator.randomUUID(),
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  const token = generator.randomToken(32);
  assert.match(token, /^[A-Za-z0-9_-]+$/);
  assert.equal(Buffer.from(token, "base64url").length, 32);
  assert.throws(() => generator.randomToken(0), RangeError);
  assert.throws(() => generator.randomToken(4_097), RangeError);
});

test("origin policy derives the direct request origin", () => {
  assert.deepEqual(
    originPolicy.evaluate({
      socketRemoteAddress: "::1",
      requestProtocol: "http:",
      hostHeader: "Mac.Example.Test:47217",
    }),
    {
      valid: true,
      requestIsLoopback: true,
      forwardedHeadersTrusted: true,
      externalBaseURL: "http://mac.example.test:47217",
      source: "direct",
    },
  );
});

test("origin policy honors only the first trusted forwarded host and protocol", () => {
  assert.deepEqual(
    originPolicy.evaluate({
      socketRemoteAddress: "127.0.0.1",
      requestProtocol: "http:",
      hostHeader: "127.0.0.1:47217",
      forwardedHostHeader: "mac.example.test, attacker.example",
      forwardedProtoHeader: "https, http",
    }),
    {
      valid: true,
      requestIsLoopback: true,
      forwardedHeadersTrusted: true,
      externalBaseURL: "https://mac.example.test",
      source: "trusted-proxy",
    },
  );
});

test("origin policy accepts a requested base only on a direct or trusted proxy host", () => {
  assert.deepEqual(
    originPolicy.evaluate({
      socketRemoteAddress: "::ffff:127.0.0.1",
      requestProtocol: "http:",
      hostHeader: "127.0.0.1:47217",
      forwardedHostHeader: "mac.example.test",
      forwardedProtoHeader: "https",
      requestedExternalBaseURL: "https://mac.example.test/path?ignored=yes",
    }),
    {
      valid: true,
      requestIsLoopback: true,
      forwardedHeadersTrusted: true,
      externalBaseURL: "https://mac.example.test",
      source: "requested",
    },
  );

  assert.deepEqual(
    originPolicy.evaluate({
      socketRemoteAddress: "127.0.0.1",
      requestProtocol: "http:",
      hostHeader: "mac.example.test",
      requestedExternalBaseURL: "https://evil.example",
    }),
    {
      valid: true,
      requestIsLoopback: true,
      forwardedHeadersTrusted: true,
      externalBaseURL: "http://mac.example.test",
      source: "direct",
    },
  );
});

test("origin policy ignores spoofed forwarding from remote peers without rejecting direct origin", () => {
  assert.deepEqual(
    originPolicy.evaluate({
      socketRemoteAddress: "100.64.0.10",
      requestProtocol: "http:",
      hostHeader: "mac.example.test",
      forwardedHostHeader: "evil.example",
      forwardedProtoHeader: "https",
      requestedExternalBaseURL: "https://evil.example",
    }),
    {
      valid: true,
      requestIsLoopback: false,
      forwardedHeadersTrusted: false,
      externalBaseURL: "http://mac.example.test",
      source: "direct",
    },
  );
});

test("origin policy fails closed for a malformed direct host", () => {
  assert.deepEqual(
    originPolicy.evaluate({
      socketRemoteAddress: "127.0.0.1",
      requestProtocol: "http:",
      hostHeader: "user@example.test",
    }),
    {
      valid: false,
      requestIsLoopback: true,
      forwardedHeadersTrusted: true,
      reason: "invalid-host",
    },
  );
});
