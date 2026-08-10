import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceBuildCapabilityApplicationService } from "../mac-helper/src/http/deviceBuildCapabilityApplicationService.js";

test("device build capability service validates dependencies", () => {
  assert.throws(
    () => createDeviceBuildCapabilityApplicationService({}),
    /requires pairedMacEnabled/,
  );
});

test("unknown unpaired build is unauthorized without probing capability details", async () => {
  let verified = false;
  const service = createDeviceBuildCapabilityApplicationService(dependencies({
    getBuild: () => null,
    verifyBuild: async () => {
      verified = true;
      return {};
    },
  }));
  assert.deepEqual(await execute(service, "status", { token: "wrong" }), {
    kind: "unauthorized",
  });
  assert.equal(verified, false);
});

test("paired Mac can see missing builds as not found while gateway mode cannot", async () => {
  const privateService = createDeviceBuildCapabilityApplicationService(dependencies({
    pairingTokenMatches: () => true,
    getBuild: () => null,
  }));
  assert.deepEqual(await execute(privateService, "status"), {
    kind: "not-found",
    message: "Unknown device build.",
  });

  const gatewayService = createDeviceBuildCapabilityApplicationService(dependencies({
    pairedMacEnabled: false,
    pairingTokenMatches: () => true,
    getBuild: () => null,
  }));
  assert.deepEqual(await execute(gatewayService, "status"), { kind: "unauthorized" });
});

test("paired status and logs preserve the private projection while capability output stays redacted", async () => {
  const build = readyBuild({
    app: {
      identity: "app-id",
      name: "App",
      bundleIdentifier: "com.example",
      version: "1",
      build: "2",
      teamID: "TEAM-SECRET",
    },
    installation: {
      state: "verified",
      requestedAt: "",
      verifiedAt: "now",
      devices: [{ name: "Private iPhone" }],
    },
    logs: ["/Users/miguel/secret/App.xcodeproj", "Build is ready to install."],
  });
  const paired = createDeviceBuildCapabilityApplicationService(dependencies({
    pairingTokenMatches: () => true,
    getBuild: () => structuredClone(build),
    projectBuild: (value) => ({ private: value.app.teamID }),
  }));
  assert.deepEqual(await execute(paired, "status"), {
    kind: "json",
    status: 200,
    body: { private: "TEAM-SECRET" },
  });
  assert.deepEqual((await execute(paired, "logs")).body.logs, build.logs);

  const capability = createDeviceBuildCapabilityApplicationService(dependencies({
    getBuild: () => structuredClone(build),
  }));
  const status = await execute(capability, "status", { token: "cap-token" });
  assert.equal(status.status, 200);
  assert.equal(status.body.app.teamID, "");
  assert.deepEqual(status.body.installation.devices, []);
  const logs = await execute(capability, "logs", { token: "cap-token" });
  assert.deepEqual(logs.body.logs, ["[build output redacted]", "Build is ready to install."]);
});

test("capability expiry is fail closed but paired Mac access is not link-expiry gated", async () => {
  const expired = readyBuild({ expiresAt: new Date(Date.now() - 60_000).toISOString() });
  const publicService = createDeviceBuildCapabilityApplicationService(dependencies({
    getBuild: () => structuredClone(expired),
  }));
  assert.deepEqual(await execute(publicService, "status", { token: "cap-token" }), {
    kind: "bad-request",
    status: 410,
    message: "This install link has expired.",
  });

  const pairedService = createDeviceBuildCapabilityApplicationService(dependencies({
    pairingTokenMatches: () => true,
    getBuild: () => structuredClone(expired),
  }));
  assert.equal((await execute(pairedService, "status")).status, 200);
});

test("paired links persist a missing direct origin once and capability links do not mutate it", async () => {
  const saves = [];
  const privateBuild = readyBuild({ remoteBaseUrl: "" });
  const paired = createDeviceBuildCapabilityApplicationService(dependencies({
    pairingTokenMatches: () => true,
    getBuild: () => privateBuild,
    saveBuild: (value) => saves.push(value.remoteBaseUrl),
    buildLinks: (value, base) => ({ id: value.id, base }),
  }));
  assert.deepEqual(await execute(paired, "links", {}, "https://mac.example/api/device-builds/build-1/links"), {
    kind: "json",
    status: 200,
    body: { id: "build-1", base: "https://mac.example" },
  });
  assert.deepEqual(saves, ["https://mac.example"]);

  const publicBuild = readyBuild({ remoteBaseUrl: "" });
  const capability = createDeviceBuildCapabilityApplicationService(dependencies({
    getBuild: () => publicBuild,
    saveBuild: () => saves.push("public-mutated"),
  }));
  const result = await execute(
    capability,
    "links",
    { token: "cap-token" },
    "https://public.example/api/device-builds/build-1/links?token=cap-token",
  );
  assert.equal(result.status, 200);
  assert.equal(publicBuild.remoteBaseUrl, "");
  assert.doesNotMatch(JSON.stringify(saves), /public-mutated/);
});

test("capability mutations require a ready IPA before touching persistence", async () => {
  for (const operation of ["install-request", "verify"]) {
    let touched = false;
    const service = createDeviceBuildCapabilityApplicationService(dependencies({
      getBuild: () => readyBuild({ state: "failed", artifacts: { ipaPath: "" } }),
      markInstallRequested: () => {
        touched = true;
        return readyBuild();
      },
      verifyBuild: async () => {
        touched = true;
        return {};
      },
    }));
    assert.deepEqual(await execute(service, operation, { token: "cap-token" }), {
      kind: "bad-request",
      status: 409,
      message: "This build is not ready or is no longer available.",
    });
    assert.equal(touched, false);
  }
});

test("capability verification obeys the persisted cadence while paired verification stays immediate", async () => {
  let verifyCalls = 0;
  let saveCalls = 0;
  const build = readyBuild();
  const publicService = createDeviceBuildCapabilityApplicationService(dependencies({
    getBuild: () => structuredClone(build),
    claimVerification: () => false,
    verifyBuild: async () => {
      verifyCalls += 1;
      return { state: "verified" };
    },
    saveVerification: () => {
      saveCalls += 1;
      return readyBuild();
    },
  }));
  assert.equal((await execute(publicService, "verify", { token: "cap-token" })).status, 200);
  assert.equal(verifyCalls, 0);
  assert.equal(saveCalls, 0);

  const pairedService = createDeviceBuildCapabilityApplicationService(dependencies({
    pairingTokenMatches: () => true,
    getBuild: () => structuredClone(build),
    claimVerification: () => false,
    verifyBuild: async () => {
      verifyCalls += 1;
      return { state: "verified" };
    },
    saveVerification: (_id, verification) => {
      saveCalls += 1;
      return { ...readyBuild(), installation: verification };
    },
  }));
  assert.equal((await execute(pairedService, "verify")).status, 200);
  assert.equal(verifyCalls, 1);
  assert.equal(saveCalls, 1);
});

test("artifacts and install pages stay capability-only even for a paired Mac", async () => {
  for (const operation of ["artifact", "install-page"]) {
    const service = createDeviceBuildCapabilityApplicationService(dependencies({
      pairingTokenMatches: () => true,
    }));
    assert.deepEqual(await execute(service, operation, {}, undefined, operation === "artifact" ? "ipa" : undefined), {
      kind: "unauthorized",
    });
  }
});

test("capability manifest, IPA, and install page preserve scoped origin and security headers", async () => {
  const build = readyBuild({ remoteBaseUrl: "" });
  const service = createDeviceBuildCapabilityApplicationService(dependencies({
    getBuild: () => structuredClone(build),
    buildManifest: (scoped, base) => `manifest:${scoped.token}:${base}`,
    renderInstallPage: (scoped) => `page:${scoped.token}:${scoped.remoteBaseUrl}`,
  }));
  assert.deepEqual(
    await execute(
      service,
      "artifact",
      { token: "cap-token" },
      "https://public.example/api/device-builds/build-1/artifact/manifest?token=cap-token",
      "manifest",
    ),
    {
      kind: "text",
      status: 200,
      body: "manifest:cap-token:https://public.example",
      contentType: "text/xml; charset=utf-8",
      headers: {},
    },
  );
  assert.deepEqual(
    await execute(service, "artifact", { token: "cap-token" }, undefined, "ipa"),
    {
      kind: "file",
      path: "/tmp/App.ipa",
      contentType: "application/octet-stream",
      filename: "App.ipa",
    },
  );
  const page = await execute(
    service,
    "install-page",
    { token: "cap-token" },
    "https://public.example/d/build-1?token=cap-token",
  );
  assert.equal(page.status, 200);
  assert.equal(page.body, "page:cap-token:https://public.example");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.match(page.headers["content-security-policy"], /default-src 'none'/);
  assert.match(page.headers["content-security-policy"], /form-action 'none'/);
});

function dependencies(overrides = {}) {
  return {
    pairedMacEnabled: true,
    pairingTokenMatches: () => false,
    getBuild: () => readyBuild(),
    saveBuild: () => {},
    markInstallRequested: () => readyBuild({ installation: { state: "requested", devices: [] } }),
    saveVerification: (_id, verification) => readyBuild({ installation: verification }),
    verifyBuild: async () => ({ state: "verified", devices: [] }),
    claimVerification: () => true,
    projectBuild: (build) => ({ private: build.id }),
    buildLinks: (build, base) => ({ buildId: build.id, base }),
    buildManifest: (build, base) => `manifest:${build.id}:${base}`,
    renderInstallPage: (build) => `page:${build.id}`,
    now: () => Date.now(),
    ...overrides,
  };
}

function readyBuild(overrides = {}) {
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
      identity: "app-id",
      name: "App",
      bundleIdentifier: "com.example",
      version: "1",
      build: "2",
      teamID: "TEAM",
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

function execute(
  service,
  operation,
  { token = "" } = {},
  href = `http://127.0.0.1/api/device-builds/build-1${token ? `?token=${token}` : ""}`,
  artifact = undefined,
) {
  return service.execute({
    operation,
    buildID: "build-1",
    request: { headers: {} },
    url: new URL(href),
    ...(artifact ? { artifact } : {}),
  });
}
