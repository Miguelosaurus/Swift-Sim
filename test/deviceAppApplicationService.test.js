import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceAppApplicationService } from "../mac-helper/src/http/deviceAppApplicationService.js";

test("device app service validates its complete dependency surface", () => {
  assert.throws(() => createDeviceAppApplicationService({}), /requires pairingTokenMatches/);
});

for (const operation of [
  "list-builds",
  "list-apps",
  "get-app",
  "archive-app",
  "rebuild-app",
  "delete-app",
]) {
  test(`${operation} authorizes before input or persistence`, async () => {
    let touched = false;
    const service = createDeviceAppApplicationService(
      dependencies({
        pairingTokenMatches: () => false,
        listBuilds: () => {
          touched = true;
          return [];
        },
        listApps: () => {
          touched = true;
          return [];
        },
        getApp: () => {
          touched = true;
        },
        setAppArchived: () => {
          touched = true;
        },
        findRebuild: () => {
          touched = true;
        },
        deleteApp: () => {
          touched = true;
          return false;
        },
      }),
    );
    assert.deepEqual(
      await service.execute({
        operation,
        appID: "app-1",
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

test("device build and app catalog projections remain bounded", async () => {
  let includeArchived;
  const service = createDeviceAppApplicationService(
    dependencies({
      listBuilds: () => Array.from({ length: 22 }, (_, index) => ({ id: `build-${index}` })),
      listApps: (options) => {
        includeArchived = options.includeArchived;
        return [{ id: "app-1" }];
      },
    }),
  );
  const builds = await service.execute({
    operation: "list-builds",
    request: {},
    url: url(),
  });
  assert.equal(builds.body.builds.length, 20);
  assert.deepEqual(
    await service.execute({
      operation: "list-apps",
      request: {},
      url: url("?archived=true"),
    }),
    { kind: "json", status: 200, body: { apps: [{ public: "app-1" }] } },
  );
  assert.equal(includeArchived, true);
  await service.execute({ operation: "list-apps", request: {}, url: url("?archived=TRUE") });
  assert.equal(includeArchived, false);
});

test("get, archive, and delete preserve outcomes and cleanup ordering", async () => {
  const events = [];
  const service = createDeviceAppApplicationService(
    dependencies({
      getApp: () => null,
      setAppArchived: (appID, archived) => ({ id: appID, archived }),
      deleteApp: (appID, options) => {
        events.push(["delete", appID, options]);
        return true;
      },
      drainDeliveryReferences: () => events.push(["drain"]),
    }),
  );
  assert.deepEqual(
    await service.execute({ operation: "get-app", appID: "missing", request: {}, url: url() }),
    { kind: "not-found", message: "Unknown app." },
  );
  assert.deepEqual(
    await service.execute({
      operation: "archive-app",
      appID: "app-1",
      request: {},
      url: url(),
      readInput: async () => ({ archived: false }),
    }),
    { kind: "json", status: 200, body: { public: "app-1", archived: false } },
  );
  assert.deepEqual(
    await service.execute({
      operation: "archive-app",
      appID: "app-1",
      request: {},
      url: url(),
      readInput: async () => ({}),
    }),
    { kind: "json", status: 200, body: { public: "app-1", archived: true } },
  );
  assert.deepEqual(
    await service.execute({
      operation: "delete-app",
      appID: "app-1",
      request: {},
      url: url("?keepArtifacts=true"),
    }),
    { kind: "json", status: 200, body: { deleted: true, appId: "app-1" } },
  );
  assert.deepEqual(events, [["delete", "app-1", { deleteArtifacts: false }], ["drain"]]);

  const missing = createDeviceAppApplicationService(
    dependencies({
      deleteApp: (_appID, options) => {
        events.push(["missing-delete", options]);
        return false;
      },
      drainDeliveryReferences: () => events.push(["unexpected-drain"]),
    }),
  );
  assert.deepEqual(
    await missing.execute({
      operation: "delete-app",
      appID: "missing",
      request: {},
      url: url(),
    }),
    { kind: "not-found", message: "Unknown app." },
  );
  assert.deepEqual(events.at(-1), ["missing-delete", { deleteArtifacts: true }]);
  assert.equal(
    events.some(([name]) => name === "unexpected-drain"),
    false,
  );
});

test("rebuild validates, deduplicates, verifies the recipe, and starts once", async () => {
  const starts = [];
  const source = { id: "source", project: "/tmp/App.xcodeproj" };
  const service = createDeviceAppApplicationService(
    dependencies({
      latestReusableBuildForApp: () => source,
      createRebuild: (_source, options) => ({ id: "new-build", options }),
      startBuild: (build) => starts.push(build),
    }),
  );
  assert.deepEqual(await rebuild(service, "short"), {
    kind: "bad-request",
    status: 400,
    message: "A valid idempotency key is required.",
  });
  assert.deepEqual(await rebuild(service, "valid-key"), {
    kind: "json",
    status: 202,
    body: { public: "new-build", options: { appID: "app-1", idempotencyKey: "valid-key" } },
  });
  assert.equal(starts.length, 1);

  const existing = createDeviceAppApplicationService(
    dependencies({
      findRebuild: ({ idempotencyKey }) => (idempotencyKey ? { id: "existing" } : null),
    }),
  );
  assert.deepEqual(await rebuild(existing, "valid-key"), {
    kind: "json",
    status: 200,
    body: { public: "existing" },
  });

  const active = createDeviceAppApplicationService(
    dependencies({
      findRebuild: ({ activeOnly }) => (activeOnly ? { id: "active" } : null),
      startBuild: () => {
        throw new Error("must not start a duplicate");
      },
    }),
  );
  assert.deepEqual(await rebuild(active, "valid-key"), {
    kind: "json",
    status: 200,
    body: { public: "active" },
  });

  const missingRecipe = createDeviceAppApplicationService(
    dependencies({ latestReusableBuildForApp: () => null }),
  );
  assert.deepEqual(await rebuild(missingRecipe, "valid-key"), {
    kind: "bad-request",
    status: 409,
    message:
      "No successful device build is available as a trusted build recipe. Create one from the Mac first.",
  });

  const missingPath = createDeviceAppApplicationService(
    dependencies({ latestReusableBuildForApp: () => source, pathExists: () => false }),
  );
  assert.deepEqual(await rebuild(missingPath, "valid-key"), {
    kind: "bad-request",
    status: 409,
    message: "The saved Xcode project is no longer available at its original location on this Mac.",
  });
});

function dependencies(overrides = {}) {
  return {
    pairingTokenMatches: () => true,
    listBuilds: () => [{ id: "build-1" }],
    projectBuild: (build) => ({
      public: build.id,
      ...(build.options ? { options: build.options } : {}),
    }),
    listApps: () => [{ id: "app-1" }],
    projectApp: (app) => ({
      public: app.id,
      ...(app.archived === undefined ? {} : { archived: app.archived }),
    }),
    getApp: (appID) => ({ id: appID }),
    setAppArchived: (appID, archived) => ({ id: appID, archived }),
    findRebuild: () => null,
    latestReusableBuildForApp: () => ({ id: "source", project: "/tmp/App.xcodeproj" }),
    pathExists: () => true,
    createRebuild: (_source, options) => ({ id: "new-build", options }),
    startBuild: () => {},
    deleteApp: () => false,
    drainDeliveryReferences: () => {},
    ...overrides,
  };
}

function url(search = "") {
  return new URL(`http://127.0.0.1/api/apps${search}`);
}

function rebuild(service, idempotencyKey) {
  return service.execute({
    operation: "rebuild-app",
    appID: "app-1",
    request: {},
    url: url(),
    readInput: async () => ({ idempotencyKey }),
  });
}
