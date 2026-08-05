import assert from "node:assert/strict";
import test from "node:test";
import {
  createHelperRequestContext,
  helperRequestToken,
  normalizedRequestHeader,
} from "../mac-helper/src/http/helperRequestContext.js";

test("helper request context preserves method, URL, and origin inputs", () => {
  const context = createHelperRequestContext({
    method: "GET",
    url: "/api/device-builds/build-1/logs?token=query-token&base=https%3A%2F%2Fexample.test",
    headers: {
      host: "127.0.0.1:47217",
      authorization: "Bearer bearer-token",
      "x-forwarded-host": ["swift.example", "ignored.example"],
      "x-forwarded-proto": "https",
    },
    socket: { remoteAddress: "127.0.0.1" },
  });

  assert.ok(context);
  assert.equal(context.method, "GET");
  assert.equal(context.pathname, "/api/device-builds/build-1/logs");
  assert.equal(context.url.searchParams.get("base"), "https://example.test");
  assert.equal(context.bearerToken, "bearer-token");
  assert.equal(context.hostHeader, "127.0.0.1:47217");
  assert.equal(context.forwardedHostHeader, "swift.example,ignored.example");
  assert.equal(context.forwardedProtoHeader, "https");
  assert.equal(context.socketRemoteAddress, "127.0.0.1");
  assert.equal(helperRequestToken(context), "bearer-token");
});

test("helper request token falls back to the selected query parameter", () => {
  const context = createHelperRequestContext({
    method: "POST",
    url: "/pair?invite=invite-token&token=query-token",
    headers: {},
  });
  assert.ok(context);
  assert.equal(context.url.origin, "http://127.0.0.1");
  assert.equal(helperRequestToken(context), "query-token");
  assert.equal(helperRequestToken(context, "invite"), "invite-token");
});

test("helper request context preserves malformed URL fall-through", () => {
  assert.equal(
    createHelperRequestContext({
      method: "GET",
      url: "/pair",
      headers: { host: "[" },
    }),
    null,
  );
});

test("helper request context rejects invalid explicit configuration", () => {
  assert.throws(
    () => createHelperRequestContext(undefined, { defaultHost: "" }),
    /requires a non-empty default host/,
  );
  const context = createHelperRequestContext({ url: "/" });
  assert.ok(context);
  assert.throws(() => helperRequestToken(context, ""), /requires a non-empty query name/);
});

test("request header normalization matches Node header coercion", () => {
  assert.equal(normalizedRequestHeader(undefined), undefined);
  assert.equal(normalizedRequestHeader(42), "42");
  assert.equal(normalizedRequestHeader(["one", "two"]), "one,two");
});
