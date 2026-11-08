import test from "node:test";
import assert from "node:assert/strict";
import { readDeliveryStatus } from "../mac-helper/src/deliveryStatus.js";
import { selectDeliveryPresentations } from "../mac-helper/src/deliveryPresentation.js";
import { activitySnapshotEvents } from "../mac-helper/src/activityService.js";

const appID = "app-identity",
  buildId = "11111111-1111-1111-1111-111111111111";
const now = Date.now();
function event(input = {}) {
  return {
    appId: appID,
    buildId,
    intentAt: now,
    time: now,
    kind: "build-ready",
    title: "Zenics — Ready to install",
    message: "Open Zenics to install the update.",
    ...input,
  };
}
function input(status) {
  return {
    project: "/tmp/App.xcodeproj",
    scheme: "App",
    listApps: () => [{ id: appID, builds: [{ project: "/tmp/App.xcodeproj", scheme: "App" }] }],
    loadPairing: () => ({ token: "private-token", installationID: "mac-id" }),
    fetchFeed: async () => ({
      installationId: "mac-id",
      deliveryStatus: { schemaVersion: 1, apps: { [appID]: status } },
    }),
  };
}

test("agent reads precisely the same presentation used by phone and notification event", async () => {
  const build = {
    id: buildId,
    appId: appID,
    app: { name: "Zenics" },
    state: "ready",
    createdAt: new Date(now).toISOString(),
    artifacts: { ipaPath: "private-path" },
    remoteBaseUrl: "https://private.invalid",
    expiresAt: new Date(now + 10000).toISOString(),
  };
  const result = activitySnapshotEvents({
    builds: [build],
    installations: new Map([[buildId, { state: "waiting" }]]),
    now,
  });
  const presentation = result.presentations[appID];
  const agent = await readDeliveryStatus(input(presentation));
  assert.equal(agent.outcome, "delivery-status");
  assert.deepEqual(agent.status, presentation);
  assert.equal(agent.status.message, result.entries[0].message);
  assert.equal(agent.status.nextAction, "open-app");
  assert.doesNotMatch(JSON.stringify(agent), /private|https|token|team|device/i);
});
test("latest intent wins over a late launch of an older build", () => {
  const value = selectDeliveryPresentations([
    event(),
    event({
      buildId: "old-build",
      intentAt: now - 1000,
      time: now + 1000,
      kind: "launch-confirmed",
    }),
  ])[appID];
  assert.equal(value.buildId, buildId);
  assert.equal(value.completionVerified, false);
});
test("uncertain installs dominate optimistic progress and competing active operations are explicit", () => {
  const uncertain = event({
    buildId: "old",
    kind: "attention",
    state: "uncertain",
    intentAt: now - 1000,
  });
  assert.equal(selectDeliveryPresentations([uncertain, event()])[appID].code, "UNCONFIRMED");
  const a = event({ kind: "queued", state: "waiting-for-device" });
  assert.equal(
    selectDeliveryPresentations([
      a,
      event({ buildId: "other", kind: "queued", state: "applying" }),
    ])[appID].code,
    "MULTIPLE_PENDING",
  );
});
test("only complete native live proof promotes an update to applied", () => {
  const build = {
    id: buildId,
    appId: appID,
    state: "ready",
    configuration: "Debug",
    app: { bundleIdentifier: "app", version: "1", build: "2" },
    liveReload: {
      eligible: true,
      recovery: {
        provenance: {
          projectPath: "/tmp/App.xcodeproj",
          scheme: "App",
          binaryIdentity: {
            bundle_id: "app",
            bundle_version: "1",
            build_number: "2",
            executable_uuid: buildId,
            debug_dylib_uuid: buildId,
          },
        },
      },
    },
  };
  // Unknown or unmatched target cannot fabricate an app-level success.
  const result = activitySnapshotEvents({
    builds: [build],
    liveDeliveries: [
      {
        requestId: "request",
        state: "refreshed",
        scope: { appIdentity: "unknown" },
        proof: { applied: true, refreshed: true },
      },
    ],
    now,
  });
  assert.equal(
    Object.values(result.presentations).some((p) => p.code === "CHANGES_APPLIED"),
    false,
  );
});
for (const [label, change, code] of [
  [
    "ambiguous app",
    (f) =>
      (f.listApps = () => [
        { id: "a", builds: [{ project: "/tmp/App.xcodeproj", scheme: "App" }] },
        { id: "b", builds: [{ project: "/tmp/App.xcodeproj", scheme: "App" }] },
      ]),
    "DELIVERY_SCOPE_REQUIRED",
  ],
  [
    "pairing rotation",
    (f) => (f.fetchFeed = async () => ({ installationId: "other" })),
    "DELIVERY_PAIRING_CHANGED",
  ],
  [
    "old helper",
    (f) => (f.fetchFeed = async () => ({ installationId: "mac-id" })),
    "DELIVERY_HELPER_UPDATE_REQUIRED",
  ],
  [
    "unreachable helper",
    (f) =>
      (f.fetchFeed = async () => {
        throw new Error("private token");
      }),
    "DELIVERY_STATUS_UNAVAILABLE",
  ],
  [
    "invalid success",
    (f) =>
      (f.fetchFeed = async () => ({
        installationId: "mac-id",
        deliveryStatus: {
          schemaVersion: 1,
          apps: {
            [appID]: { ...selectDeliveryPresentations([event()])[appID], completionVerified: true },
          },
        },
      })),
    "DELIVERY_STATUS_UNAVAILABLE",
  ],
])
  test(label + " never retries or claims completion", async () => {
    const f = input(selectDeliveryPresentations([event()])[appID]);
    change(f);
    const r = await readDeliveryStatus(f);
    assert.equal(r.code, code);
    assert.equal(r.completionVerified, false);
    assert.doesNotMatch(JSON.stringify(r), /private token/);
  });
test("explicit app selection discards nonpublic fields", async () => {
  const value = {
    ...selectDeliveryPresentations([event()])[appID],
    token: "private",
    deviceID: "secret",
    path: "/private",
  };
  const f = input(value);
  delete f.project;
  delete f.scheme;
  f.appID = appID;
  assert.doesNotMatch(JSON.stringify(await readDeliveryStatus(f)), /private|secret/);
});

test("real paired feed is one bounded authenticated GET, and redirects never carry credentials", async (t) => {
  const { createServer } = await import("node:http");
  const { once } = await import("node:events");
  const presentation = selectDeliveryPresentations([event()])[appID];
  let requests = 0,
    redirect = false;
  const server = createServer((req, res) => {
    requests++;
    assert.equal(req.method, "GET");
    assert.equal(req.url, "/api/activity");
    assert.equal(req.headers.authorization, "Bearer private-token");
    if (redirect) {
      res.writeHead(302, { location: "/must-not-follow" });
      res.end();
      return;
    }
    res.end(
      JSON.stringify({
        installationId: "mac-id",
        deliveryStatus: { schemaVersion: 1, apps: { [appID]: presentation } },
      }),
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const previous = process.env.SWIFT_SIM_PORT;
  process.env.SWIFT_SIM_PORT = String(server.address().port);
  t.after(async () => {
    if (previous === undefined) delete process.env.SWIFT_SIM_PORT;
    else process.env.SWIFT_SIM_PORT = previous;
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  const f = input(presentation);
  delete f.fetchFeed;
  assert.deepEqual((await readDeliveryStatus(f)).status, presentation);
  assert.equal(requests, 1);
  redirect = true;
  assert.equal((await readDeliveryStatus(f)).code, "DELIVERY_STATUS_UNAVAILABLE");
  assert.equal(requests, 2);
});
