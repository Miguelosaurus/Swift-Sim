import test from "node:test";
import assert from "node:assert/strict";
import { badRequest, json, notFound } from "../mac-helper/src/http.js";

function recorder() {
  return {
    status: 0,
    headers: {},
    body: "",
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = "") { this.body += body; },
  };
}

test("token-bearing JSON responses disable referrers and MIME sniffing", () => {
  const response = recorder();
  json(response, 200, { ok: true });
  assert.equal(response.headers["referrer-policy"], "no-referrer");
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(response.headers["cache-control"], "no-store");
});

test("main-helper capability errors do not expose internal details", () => {
  const bad = recorder();
  bad.swiftSimPublicCapability = true;
  badRequest(bad, 400, "/Users/miguel/private/project failed");
  assert.doesNotMatch(bad.body, /Users|miguel|project/);

  const missing = recorder();
  missing.swiftSimPublicCapability = true;
  notFound(missing, "/Users/miguel/private/App.ipa");
  assert.doesNotMatch(missing.body, /Users|miguel|App\.ipa/);
});
