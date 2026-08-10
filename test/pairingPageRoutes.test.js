import assert from "node:assert/strict";
import test from "node:test";
import {
  handlePairingPageRoutes,
  pairingPageAuthorizationMatrix,
} from "../mac-helper/src/http/pairingPageRoutes.js";

test("pairing page route declares the private helper authorization boundary", () => {
  assert.deepEqual(pairingPageAuthorizationMatrix, [
    {
      route: "GET /pair",
      exposure: "private-helper",
      authorization: "pairing-token-or-one-time-invite",
    },
  ]);
});

test("GET /pair delegates once and projects the complete HTML response", async () => {
  const response = responseRecorder();
  const req = { method: "GET", headers: {} };
  const url = new URL("http://127.0.0.1/pair?invite=invite-1");
  let received;
  let calls = 0;
  assert.equal(
    await handlePairingPageRoutes({
      req,
      res: response,
      url,
      service: {
        execute: async (input) => {
          calls += 1;
          received = input;
          return {
            kind: "text",
            status: 200,
            body: "<html>pair</html>",
            contentType: "text/html; charset=utf-8",
            headers: {
              "content-security-policy": "default-src 'none'",
              "x-extra": "value",
            },
          };
        },
      },
    }),
    true,
  );
  assert.equal(calls, 1);
  assert.equal(received.request, req);
  assert.equal(received.url, url);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body, "<html>pair</html>");
  assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(response.headers["content-security-policy"], "default-src 'none'");
  assert.equal(response.headers["x-extra"], "value");
  assert.equal(response.ended, true);
});

test("pairing page route preserves unauthorized and expired-invite projections", async () => {
  const unauthorizedResponse = responseRecorder();
  assert.equal(
    await handlePairingPageRoutes({
      req: { method: "GET", headers: {} },
      res: unauthorizedResponse,
      url: new URL("http://127.0.0.1/pair?token=wrong"),
      service: { execute: async () => ({ kind: "unauthorized" }) },
    }),
    true,
  );
  assert.equal(unauthorizedResponse.statusCode, 401);
  assert.match(unauthorizedResponse.body, /Unauthorized/);
  assert.equal(unauthorizedResponse.ended, true);

  const expiredResponse = responseRecorder();
  assert.equal(
    await handlePairingPageRoutes({
      req: { method: "GET", headers: {} },
      res: expiredResponse,
      url: new URL("http://127.0.0.1/pair?invite=expired"),
      service: {
        execute: async () => ({
          kind: "bad-request",
          status: 410,
          message: "Pairing invitation expired or already used.",
        }),
      },
    }),
    true,
  );
  assert.equal(expiredResponse.statusCode, 410);
  assert.match(expiredResponse.body, /Pairing invitation expired or already used/);
  assert.equal(expiredResponse.ended, true);
});

test("pairing page route falls through for unsupported methods and neighboring paths", async () => {
  for (const [method, pathname] of [
    ["POST", "/pair"],
    ["GET", "/pair/"],
    ["GET", "/api/pair"],
  ]) {
    assert.equal(
      await handlePairingPageRoutes({
        req: { method, headers: {} },
        res: responseRecorder(),
        url: new URL(`http://127.0.0.1${pathname}`),
        service: {
          execute: async () => {
            throw new Error("service must not be touched");
          },
        },
      }),
      false,
    );
  }
});

function responseRecorder() {
  return {
    statusCode: null,
    headers: {},
    body: "",
    ended: false,
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
    },
    end(body = "") {
      this.body = String(body);
      this.ended = true;
    },
  };
}
