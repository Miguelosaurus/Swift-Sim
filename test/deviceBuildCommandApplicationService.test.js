import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceBuildCommandApplicationService } from "../mac-helper/src/http/deviceBuildCommandApplicationService.js";
import { trackDeviceBuildTask } from "../mac-helper/src/deviceBuildTaskTracker.js";

test("device build command service validates dependencies", () => {
  assert.throws(
    () => createDeviceBuildCommandApplicationService({}),
    /requires pairingTokenMatches/,
  );
});

for (const operation of ["start-build", "renew-build"]) {
  test(`${operation} authorizes before input or persistence`, async () => {
    let touched = false;
    const service = createDeviceBuildCommandApplicationService(
      dependencies({
        pairingTokenMatches: () => false,
        createBuild: async () => {
          touched = true;
        },
        getBuild: () => {
          touched = true;
        },
      }),
    );
    assert.deepEqual(
      await service.execute({
        operation,
        buildID: "build-1",
        request: {},
        url: url(),
        readInput: async () => {
          touched = true;
          return {};
        },
      }),
      { kind: "unauthorized" },
    );
    assert.equal(touched, false);
  });
}

test("start build preserves input projection and starts exactly once", async () => {
  const events = [];
  const service = createDeviceBuildCommandApplicationService(
    dependencies({
      createBuild: async (values) => {
        events.push(["create", values]);
        return { id: "build-1" };
      },
      startBuild: (build) => events.push(["start", build.id]),
    }),
  );
  assert.deepEqual(
    await service.execute({
      operation: "start-build",
      request: {},
      url: url(),
      readInput: async () => ({
        project: "App.xcodeproj",
        scheme: "App",
        remoteBaseUrl: "https://example.test",
        allowProvisioningUpdates: 1,
        replaceAppData: 0,
      }),
    }),
    { kind: "json", status: 202, body: { public: "build-1" } },
  );
  assert.deepEqual(events, [
    [
      "create",
      {
        project: "App.xcodeproj",
        workspace: undefined,
        scheme: "App",
        configuration: undefined,
        "remote-base-url": "https://example.test",
        delivery: undefined,
        "export-method": undefined,
        "ttl-minutes": undefined,
        "build-setting": undefined,
        "allow-provisioning-updates": true,
        "replace-app-data": false,
      },
    ],
    ["start", "build-1"],
  ]);
});

test("start build returns accepted without waiting for detached build completion", async () => {
  const pending = new Promise(() => {});
  const service = createDeviceBuildCommandApplicationService(
    dependencies({ startBuild: () => pending }),
  );
  assert.deepEqual(
    await service.execute({
      operation: "start-build",
      request: {},
      url: url(),
      readInput: async () => ({}),
    }),
    { kind: "json", status: 202, body: { public: "build-1" } },
  );
});

test("renew reports missing and unusable saved builds before mutation", async () => {
  const missing = createDeviceBuildCommandApplicationService(
    dependencies({ getBuild: () => null }),
  );
  assert.deepEqual(await renew(missing), {
    kind: "not-found",
    message: "That saved app is no longer available on this Mac.",
  });
  let renewed = false;
  const unusable = createDeviceBuildCommandApplicationService(
    dependencies({
      getBuild: () => ({ id: "build-1", state: "ready", artifacts: { ipaPath: "/missing" } }),
      pathExists: () => false,
      renewInstallLink: () => {
        renewed = true;
      },
    }),
  );
  assert.deepEqual(await renew(unusable), {
    kind: "bad-request",
    status: 409,
    message: "The saved app is no longer available. Build it again to create a new link.",
  });
  assert.equal(renewed, false);

  for (const build of [
    { ...readyBuild(), state: "failed" },
    { ...readyBuild(), artifacts: {} },
  ]) {
    const blocked = createDeviceBuildCommandApplicationService(
      dependencies({
        getBuild: () => build,
        renewInstallLink: () => {
          renewed = true;
        },
      }),
    );
    assert.equal((await renew(blocked)).status, 409);
  }
  assert.equal(renewed, false);
});

test("renew tracks delivery, persists success, and returns the public projection", async () => {
  const events = [];
  const build = readyBuild();
  const renewedBuild = { ...build, logs: [], pendingRenewal: { id: "lease-1" } };
  const service = createDeviceBuildCommandApplicationService(
    dependencies({
      getBuild: () => build,
      renewInstallLink: (buildID, options) => {
        events.push(["renew", buildID, options]);
        return renewedBuild;
      },
      prepareDelivery: async (_build, options) => events.push(["prepare", options]),
      saveBuild: (value) => events.push(["save", [...value.logs]]),
      trackTask: async (key, value, start) => {
        events.push(["track", key, value.id]);
        return start();
      },
    }),
  );
  assert.deepEqual(await renew(service), {
    kind: "json",
    status: 200,
    body: { public: "build-1" },
  });
  assert.deepEqual(events, [
    ["renew", "build-1", { ttlMinutes: 60 }],
    ["track", "renewal:build-1:lease-1", "build-1"],
    ["prepare", { markBuildFailed: false }],
    ["save", ["A new install link was generated from the saved app."]],
  ]);
});

test("concurrent renewals join one shared lease delivery and project its result", async () => {
  const active = new Map();
  let candidate = 0;
  let preparations = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const service = createDeviceBuildCommandApplicationService(
    dependencies({
      renewInstallLink: () => ({
        ...readyBuild(),
        marker: ++candidate,
        pendingRenewal: { id: "shared-lease" },
      }),
      trackTask: (key, build, start) => trackDeviceBuildTask(active, key, build, start),
      prepareDelivery: async () => {
        preparations += 1;
        await gate;
      },
      projectBuild: (build) => ({ marker: build.marker }),
    }),
  );

  const first = renew(service);
  const second = renew(service);
  await Promise.resolve();
  assert.equal(preparations, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), [
    { kind: "json", status: 200, body: { marker: 1 } },
    { kind: "json", status: 200, body: { marker: 1 } },
  ]);
  assert.equal(active.size, 0);
});

test("renew restores the prior delivery projection and rethrows delivery failure", async () => {
  const build = readyBuild();
  const renewedBuild = {
    ...build,
    expiresAt: "new",
    remoteBaseUrl: "new-url",
    delivery: { mode: "new" },
    logs: [],
    pendingRenewal: { id: "lease-1" },
  };
  const saves = [];
  const service = createDeviceBuildCommandApplicationService(
    dependencies({
      getBuild: () => build,
      renewInstallLink: () => renewedBuild,
      prepareDelivery: async () => {
        throw new Error("delivery failed");
      },
      saveBuild: (value) =>
        saves.push({
          expiresAt: value.expiresAt,
          remoteBaseUrl: value.remoteBaseUrl,
          delivery: value.delivery,
        }),
      trackTask: async (_key, _build, start) => start(),
    }),
  );
  await assert.rejects(renew(service), /delivery failed/);
  assert.deepEqual(saves, [
    {
      expiresAt: "old-expiry",
      remoteBaseUrl: "old-url",
      delivery: { mode: "old" },
    },
  ]);
});

function dependencies(overrides = {}) {
  return {
    pairingTokenMatches: () => true,
    createBuild: async () => ({ id: "build-1" }),
    startBuild: () => {},
    getBuild: () => readyBuild(),
    pathExists: () => true,
    renewInstallLink: () => ({ ...readyBuild(), logs: [], pendingRenewal: { id: "lease-1" } }),
    trackTask: async (_key, _build, start) => start(),
    prepareDelivery: async () => {},
    saveBuild: () => {},
    projectBuild: (build) => ({ public: build.id }),
    ...overrides,
  };
}

function readyBuild() {
  return {
    id: "build-1",
    state: "ready",
    artifacts: { ipaPath: "/tmp/App.ipa" },
    installTTLMinutes: 60,
    expiresAt: "old-expiry",
    remoteBaseUrl: "old-url",
    delivery: { mode: "old" },
    logs: [],
  };
}

function renew(service) {
  return service.execute({ operation: "renew-build", buildID: "build-1", request: {}, url: url() });
}

function url() {
  return new URL("http://127.0.0.1/api/device-builds/build-1/renew");
}
