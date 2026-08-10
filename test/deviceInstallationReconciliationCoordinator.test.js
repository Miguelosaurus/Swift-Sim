import assert from "node:assert/strict";
import test from "node:test";
import { createDeviceInstallationReconciliationCoordinator } from "../mac-helper/src/http/deviceInstallationReconciliationCoordinator.js";

const NOW = Date.parse("2026-08-10T18:00:00.000Z");

function build(overrides = {}) {
  return {
    id: overrides.id || "build-1",
    state: "ready",
    installation: {
      state: "requested",
      verificationDeadlineAt: new Date(NOW + 60_000).toISOString(),
      ...overrides.installation,
    },
    app: {
      bundleIdentifier: "com.example.app",
      ...overrides.app,
    },
    ...Object.fromEntries(
      Object.entries(overrides).filter(([key]) => !["id", "installation", "app"].includes(key)),
    ),
  };
}

function harness({ builds = [build()], verifyBuild, saveVerification, nowMs, nowIso } = {}) {
  const saves = [];
  const verified = [];
  const coordinator = createDeviceInstallationReconciliationCoordinator({
    listBuilds: () => builds,
    verifyBuild:
      verifyBuild ||
      (async (candidate) => {
        verified.push(candidate.id);
        return { state: "installed", buildID: candidate.id };
      }),
    saveVerification:
      saveVerification ||
      ((buildID, verification) => {
        saves.push([buildID, verification]);
      }),
    nowMs: nowMs || (() => NOW),
    nowIso: nowIso || (() => "2026-08-10T18:00:01.000Z"),
  });
  return { coordinator, saves, verified };
}

test("reconciles ready builds with active requested installation verification", async () => {
  const first = build({ id: "build-1", installation: { state: "requested" } });
  const second = build({ id: "build-2", installation: { state: "not-installed" } });
  const third = build({ id: "build-3", installation: { state: "different-version" } });
  const { coordinator, saves, verified } = harness({ builds: [first, second, third] });

  await coordinator.runOnce();

  assert.deepEqual(verified, ["build-1", "build-2", "build-3"]);
  assert.deepEqual(
    saves.map(([buildID]) => buildID),
    ["build-1", "build-2", "build-3"],
  );
});

test("skips builds that are not ready, have no bundle identifier, or have an inactive installation state", async () => {
  const builds = [
    build({ id: "building", state: "building" }),
    build({ id: "missing-bundle", app: { bundleIdentifier: "" } }),
    build({ id: "installed", installation: { state: "installed" } }),
    build({ id: "unknown", installation: { state: "unknown" } }),
  ];
  const { coordinator, saves, verified } = harness({ builds });

  await coordinator.runOnce();

  assert.deepEqual(verified, []);
  assert.deepEqual(saves, []);
});

test("uses a strict future verification deadline and does not fall back when a deadline parses", async () => {
  const builds = [
    build({
      id: "future",
      installation: { verificationDeadlineAt: new Date(NOW + 1).toISOString() },
    }),
    build({
      id: "equal",
      installation: {
        verificationDeadlineAt: new Date(NOW).toISOString(),
        requestedAt: new Date(NOW - 1_000).toISOString(),
      },
    }),
    build({
      id: "past",
      installation: {
        verificationDeadlineAt: new Date(NOW - 1).toISOString(),
        requestedAt: new Date(NOW - 1_000).toISOString(),
      },
    }),
  ];
  const { coordinator, verified } = harness({ builds });

  await coordinator.runOnce();

  assert.deepEqual(verified, ["future"]);
});

test("falls back to the 15-minute requestedAt window when the verification deadline is absent or invalid", async () => {
  const builds = [
    build({
      id: "inside-window",
      installation: {
        verificationDeadlineAt: "not-a-date",
        requestedAt: new Date(NOW - 15 * 60 * 1000 + 1).toISOString(),
      },
    }),
    build({
      id: "boundary",
      installation: {
        verificationDeadlineAt: "",
        requestedAt: new Date(NOW - 15 * 60 * 1000).toISOString(),
      },
    }),
    build({
      id: "invalid-requested-at",
      installation: { verificationDeadlineAt: "", requestedAt: "not-a-date" },
    }),
  ];
  const { coordinator, verified } = harness({ builds });

  await coordinator.runOnce();

  assert.deepEqual(verified, ["inside-window"]);
});

test("uses the injected clock independently for each active-window decision", async () => {
  const calls = [];
  const values = [NOW, NOW + 2_000];
  const { coordinator, verified } = harness({
    builds: [
      build({
        id: "first",
        installation: { verificationDeadlineAt: new Date(NOW + 1_000).toISOString() },
      }),
      build({
        id: "second",
        installation: { verificationDeadlineAt: new Date(NOW + 1_000).toISOString() },
      }),
    ],
    nowMs: () => {
      const value = values[calls.length];
      calls.push(value);
      return value;
    },
  });

  await coordinator.runOnce();

  assert.deepEqual(calls, [NOW, NOW + 2_000]);
  assert.deepEqual(verified, ["first"]);
});

test("verification failures are projected to unknown state and reconciliation continues", async () => {
  const saves = [];
  const { coordinator } = harness({
    builds: [build({ id: "bad" }), build({ id: "good" })],
    verifyBuild: async (candidate) => {
      if (candidate.id === "bad") throw new Error("inventory unavailable");
      return { state: "installed" };
    },
    saveVerification: (buildID, verification) => saves.push([buildID, verification]),
    nowIso: () => "2026-08-10T18:00:03.000Z",
  });

  await coordinator.runOnce();

  assert.deepEqual(saves, [
    [
      "bad",
      {
        state: "unknown",
        verifiedAt: "2026-08-10T18:00:03.000Z",
        devices: [],
        detail: "inventory unavailable",
      },
    ],
    ["good", { state: "installed" }],
  ]);
});

test("non-Error verification failures preserve their string detail", async () => {
  const saves = [];
  const { coordinator } = harness({
    verifyBuild: async () => Promise.reject("offline"),
    saveVerification: (buildID, verification) => saves.push([buildID, verification]),
  });

  await coordinator.runOnce();

  assert.equal(saves[0][1].detail, "offline");
});

test("concurrent runs are suppressed rather than duplicating verification work", async () => {
  let release;
  let started = 0;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const { coordinator } = harness({
    verifyBuild: async () => {
      started += 1;
      await gate;
      return { state: "installed" };
    },
  });

  const first = coordinator.runOnce();
  await new Promise((resolve) => setImmediate(resolve));
  const second = coordinator.runOnce();
  await second;
  assert.equal(started, 1);

  release();
  await first;
  assert.equal(started, 1);
});

test("the single-flight lock is released when listing or persistence fails", async () => {
  let listCalls = 0;
  let saveCalls = 0;
  const coordinator = createDeviceInstallationReconciliationCoordinator({
    listBuilds: () => {
      listCalls += 1;
      if (listCalls === 1) throw new Error("store unavailable");
      return [build()];
    },
    verifyBuild: async () => ({ state: "installed" }),
    saveVerification: () => {
      saveCalls += 1;
    },
    nowMs: () => NOW,
    nowIso: () => "2026-08-10T18:00:01.000Z",
  });

  await assert.rejects(() => coordinator.runOnce(), /store unavailable/);
  await coordinator.runOnce();

  assert.equal(listCalls, 2);
  assert.equal(saveCalls, 1);
});

test("a failed successful-verification save is retried as an unknown verification exactly like the legacy loop", async () => {
  const saves = [];
  const { coordinator } = harness({
    saveVerification: (buildID, verification) => {
      saves.push([buildID, verification]);
      if (saves.length === 1) throw new Error("write failed");
    },
    nowIso: () => "2026-08-10T18:00:04.000Z",
  });

  await coordinator.runOnce();

  assert.equal(saves.length, 2);
  assert.deepEqual(saves[1], [
    "build-1",
    {
      state: "unknown",
      verifiedAt: "2026-08-10T18:00:04.000Z",
      devices: [],
      detail: "write failed",
    },
  ]);
});

test("validates every dependency at construction", () => {
  const dependencies = {
    listBuilds: () => [],
    verifyBuild: async () => ({}),
    saveVerification: () => {},
    nowMs: () => NOW,
    nowIso: () => "2026-08-10T18:00:00.000Z",
  };
  for (const name of Object.keys(dependencies)) {
    assert.throws(
      () => createDeviceInstallationReconciliationCoordinator({ ...dependencies, [name]: undefined }),
      new RegExp(`requires ${name}`),
    );
  }
});
