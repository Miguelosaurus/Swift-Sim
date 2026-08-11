import assert from "node:assert/strict";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { createDeviceBuildCapabilityApplicationService } from "../mac-helper/src/http/deviceBuildCapabilityApplicationService.js";
import { handleDeviceBuildCapabilityRoutes } from "../mac-helper/src/http/deviceBuildCapabilityRoutes.js";

type Dependencies = Parameters<typeof createDeviceBuildCapabilityApplicationService>[0];
type BuildRecord = NonNullable<ReturnType<Dependencies["getBuild"]>>;
type Observation = {
  surface: string;
  key: string;
  legacy: unknown;
};

function readyBuild(overrides: Partial<BuildRecord> = {}): BuildRecord {
  const now = Date.now();
  const expiresAt = new Date(now + 60_000).toISOString();
  return {
    id: "build-1",
    token: "cap-token",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt,
    state: "ready",
    configuration: "Release",
    buildSettings: [],
    app: {
      name: "App",
      bundleIdentifier: "com.example",
      version: "1",
      build: "2",
    },
    signing: {
      method: "development",
      deviceInstallable: true,
      updateSafe: "same-bundle-update",
      warnings: [],
    },
    delivery: { mode: "custom", provider: "user-configured", expiresAt },
    preserveData: true,
    installation: { state: "unknown", requestedAt: "", verifiedAt: "", devices: [] },
    liveReload: {},
    remoteBaseUrl: "https://example.test",
    installTTLMinutes: 60,
    artifacts: { ipaPath: "/tmp/App.ipa" },
    logs: ["Build is ready to install."],
    capabilities: [],
    ...overrides,
  };
}

function dependencies(build: BuildRecord, overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    pairedMacEnabled: true,
    pairingTokenMatches: () => false,
    getBuild: () => build,
    saveBuild: () => {},
    markInstallRequested: () => build,
    saveVerification: () => build,
    verifyBuild: async () => ({ state: "verified", devices: [] }),
    claimVerification: () => true,
    projectBuild: (value) => ({ id: value.id }),
    buildLinks: (value, base) => ({ id: value.id, base }),
    buildManifest: (value, base) => `manifest:${value.id}:${base}`,
    renderInstallPage: (value) => `page:${value.id}`,
    now: () => Date.now(),
    ...overrides,
  };
}

test("authorized build status writes its response before deferred shadow observation", async () => {
  const build = readyBuild();
  const events: string[] = [];
  const observations: Observation[] = [];
  const service = createDeviceBuildCapabilityApplicationService(
    dependencies(build, {
      shadowObserver: {
        observe(input: Observation) {
          events.push("observe");
          observations.push(input);
        },
      },
    }),
  );
  const req = {
    method: "GET",
    headers: {},
  } as unknown as IncomingMessage;
  const res = {
    writeHead() {
      events.push("writeHead");
      return this;
    },
    end() {
      events.push("end");
      return this;
    },
  } as unknown as ServerResponse;

  assert.equal(
    await handleDeviceBuildCapabilityRoutes({
      req,
      res,
      url: new URL("http://127.0.0.1/api/device-builds/build-1?token=cap-token"),
      service,
    }),
    true,
  );
  assert.deepEqual(events, ["writeHead", "end"]);

  if (build.app) build.app.name = "mutated-after-response";
  await flushImmediate();
  assert.deepEqual(events, ["writeHead", "end", "observe"]);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.surface, "build");
  assert.equal(observations[0]?.key, "build-1");
  const legacy = observations[0]?.legacy as { app?: { name?: unknown } };
  assert.equal(legacy.app?.name, "App");
});

test("only successful read-only build operations schedule observation", async () => {
  const build = readyBuild();
  const observations: Observation[] = [];
  const service = createDeviceBuildCapabilityApplicationService(
    dependencies(build, {
      shadowObserver: {
        observe(input: Observation) {
          observations.push(input);
        },
      },
    }),
  );

  await execute(service, "status");
  await execute(service, "logs");
  await execute(service, "artifact", "cap-token", "manifest");
  await execute(service, "install-page");
  await flushImmediate();
  assert.equal(observations.length, 4);
  assert.ok(observations.every((item) => item.surface === "build" && item.key === build.id));

  await execute(service, "links");
  await execute(service, "install-request");
  await execute(service, "verify");
  await flushImmediate();
  assert.equal(observations.length, 4);
});

test("unauthorized, expired, and failed read operations never schedule observation", async () => {
  const observations: Observation[] = [];
  const build = readyBuild();
  const service = createDeviceBuildCapabilityApplicationService(
    dependencies(build, {
      shadowObserver: {
        observe(input: Observation) {
          observations.push(input);
        },
      },
    }),
  );

  assert.deepEqual(await execute(service, "status", "wrong-token"), { kind: "unauthorized" });

  const expired = readyBuild({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const expiredService = createDeviceBuildCapabilityApplicationService(
    dependencies(expired, {
      shadowObserver: {
        observe: () => observations.push({ surface: "build", key: "expired", legacy: expired }),
      },
    }),
  );
  assert.deepEqual(await execute(expiredService, "status"), {
    kind: "bad-request",
    status: 410,
    message: "This install link has expired.",
  });

  const unavailable = readyBuild({ state: "failed" });
  const unavailableService = createDeviceBuildCapabilityApplicationService(
    dependencies(unavailable, {
      shadowObserver: {
        observe: () => observations.push({ surface: "build", key: "failed", legacy: unavailable }),
      },
    }),
  );
  assert.deepEqual(await execute(unavailableService, "artifact", "cap-token", "manifest"), {
    kind: "bad-request",
    status: 409,
    message: "Device build is not ready yet.",
  });

  await flushImmediate();
  assert.deepEqual(observations, []);
});

test("shadow observer access, execution, and rejected promises cannot alter a successful response", async () => {
  for (const mode of ["dependency-getter", "method-getter", "throw", "reject"] as const) {
    const build = readyBuild();
    const deps = dependencies(build);
    if (mode === "dependency-getter") {
      Object.defineProperty(deps, "shadowObserver", {
        configurable: true,
        get() {
          throw new Error("private observer accessor detail");
        },
      });
    } else if (mode === "method-getter") {
      const observer = {};
      Object.defineProperty(observer, "observe", {
        get() {
          throw new Error("private method accessor detail");
        },
      });
      deps.shadowObserver = observer;
    } else if (mode === "throw") {
      deps.shadowObserver = {
        observe() {
          throw new Error("private observer detail");
        },
      };
    } else {
      deps.shadowObserver = {
        observe() {
          return Promise.reject(new Error("private rejected observer detail"));
        },
      };
    }

    const service = createDeviceBuildCapabilityApplicationService(deps);
    const response = await execute(service, "status");
    assert.equal(response.kind, "json");
    assert.equal(response.status, 200);
    await flushImmediate();
    await Promise.resolve();
  }
});

function execute(
  service: ReturnType<typeof createDeviceBuildCapabilityApplicationService>,
  operation: string,
  token = "cap-token",
  artifact?: string,
) {
  return service.execute({
    operation,
    buildID: "build-1",
    request: { headers: {} },
    url: new URL(`http://127.0.0.1/api/device-builds/build-1${token ? `?token=${token}` : ""}`),
    ...(artifact ? { artifact } : {}),
  });
}

function flushImmediate() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}
