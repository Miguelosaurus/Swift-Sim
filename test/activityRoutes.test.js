import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { handleActivityRoutes } from "../mac-helper/src/http/activityRoutes.js";

function request(method, path, body = "", onRead = () => {}) {
  const req = Readable.from((async function* () { onRead(); yield body; })());
  Object.assign(req, { method, url: path, headers: {} }); return req;
}
function response() { return { status: 0, headers: {}, body: null, writeHead(status, headers) { this.status = status; this.headers = headers; }, end(bytes) { this.body = JSON.parse(bytes); } }; }
function fixture() {
  const calls = []; const service = { feed(options) { calls.push(["feed", options]); return { schemaVersion: 1, events: [], cursor: 0 }; }, async registerDevice(input) { calls.push(["register", input]); return { registered: true }; }, async unregisterDevice(id) { calls.push(["remove", id]); return { removed: true }; } };
  return { calls, service, async run(req, options = {}) { const res = response(); const handled = await handleActivityRoutes({ req, res, url: new URL(req.url, "https://private-helper.invalid"), service, privateHelper: true, authorize: () => true, ...options }); return { handled, res }; } };
}

test("private feed and device routes preserve bounded opaque API shapes", async () => {
  const f = fixture();
  const feed = await f.run(request("GET", "/api/activity?after=42&deviceId=fixture"));
  assert.equal(feed.res.status, 200); assert.equal(feed.res.headers["cache-control"], "no-store");
  assert.deepEqual(f.calls[0], ["feed", { after: 42, deviceId: "fixture" }]);
  const body = { deviceId: "11111111-1111-4111-8111-111111111111", environment: "sandbox", preferences: { queued: true } };
  assert.equal((await f.run(request("POST", "/api/activity/device", JSON.stringify(body)))).res.status, 200);
  assert.deepEqual(f.calls[1], ["register", body]);
  assert.equal((await f.run(request("DELETE", `/api/activity/device/${body.deviceId}`))).res.status, 200);
  assert.deepEqual(f.calls[2], ["remove", body.deviceId]);
});

test("public gateway and unauthorized callers cannot read activity or consume mutation bodies", async () => {
  const f = fixture(); let read = false;
  const denied = await f.run(request("POST", "/api/activity/device", "{}", () => { read = true; }), { authorize: () => false });
  assert.equal(denied.res.status, 401); assert.equal(read, false); assert.deepEqual(f.calls, []);
  const gateway = await f.run(request("GET", "/api/activity"), { privateHelper: false });
  assert.equal(gateway.res.status, 404); assert.deepEqual(f.calls, []);
});

test("rotation during body delivery invalidates registration before mutation", async () => {
  const f = fixture(); let authorized = true;
  const req = request("POST", "/api/activity/device", "{}", () => { authorized = false; });
  const result = await f.run(req, { authorize: () => authorized });
  assert.equal(result.res.status, 401); assert.deepEqual(f.calls, []);
});

test("oversized, malformed and unknown input is rejected without leaking request data", async () => {
  const f = fixture();
  for (const body of ["not JSON", JSON.stringify({ token: "secret", privatePath: "/Users/private" }), "x".repeat(17 * 1024)]) {
    const result = await f.run(request("POST", "/api/activity/device", body));
    assert.equal(result.res.status, 400); assert.doesNotMatch(JSON.stringify(result.res.body), /secret|Users|not JSON/);
  }
  assert.equal((await f.run(request("GET", "/api/activity?after=-1"))).res.status, 400);
  assert.deepEqual(f.calls, []);
  assert.equal((await f.run(request("POST", "/api/unrelated"))).handled, false);
});


test("authority read failures reject before consuming input without private diagnostics", async () => {
  const f = fixture(); let read = false;
  const authorize = async () => { throw new Error("private key at /Users/fixture/secret"); };
  const denied = await f.run(request("POST", "/api/activity/device", "{}", () => { read = true; }), { authorize });
  assert.equal(denied.res.status, 401); assert.equal(read, false); assert.deepEqual(f.calls, []);
  assert.doesNotMatch(JSON.stringify(denied.res.body), /private|Users|secret/);
});
