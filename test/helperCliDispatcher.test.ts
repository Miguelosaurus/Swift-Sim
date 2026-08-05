import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  dispatchHelperCliCommand,
  helperCliCommandIsExtracted,
} from "../mac-helper/src/helperCliDispatcher.js";
import { runHelperBootstrap } from "../mac-helper/src/helperEntrypoint.js";
import { createExtractedHelperServices } from "../mac-helper/src/helperCliRuntime.js";

function services(overrides: Record<string, unknown> = {}) {
  return {
    pair: () => ({
      macName: "Test Mac",
      links: {
        universalLink: "https://pair.example/invite",
        customScheme: "swiftsim://pair",
      },
      expiresAt: "2026-08-05T12:00:00.000Z",
    }),
    listApps: () => [{ id: "app-1", name: "App" }],
    archiveApp: ({ appID, archived }: { appID: string; archived: boolean }) => ({
      id: appID,
      archived,
    }),
    verifyDeviceBuild: async (buildID: string) => ({ id: buildID, state: "ready" }),
    deviceDeliveryStatus: () => ({ running: true }),
    stopDeviceDelivery: () => true,
    inspectServeSim: async () => ({ available: true }),
    printQRCode: () => undefined,
    ...overrides,
  };
}

function runtimeFactories(events: string[]) {
  return {
    createStateRootStore() {
      events.push("state-root");
      const pairing = {
        token: "token",
        installationID: "installation",
        macName: "Test Mac",
      };
      return {
        current: () => pairing,
        rotate: () => pairing,
        updateMacName: () => pairing,
      };
    },
    createPairingInviteStore() {
      events.push("pairing-invite-store");
      return {
        create: () => ({
          invite: "invite",
          expiresAt: "2026-08-05T12:00:00.000Z",
        }),
      };
    },
    createDeviceBuildStore() {
      events.push("device-build-store");
      return {
        listApps: () => [],
        setAppArchived: () => null,
        get: () => null,
        saveVerification: () => null,
      };
    },
    createDeviceInventory() {
      events.push("device-inventory");
      return { verifyApp: async () => ({ state: "verified" }) };
    },
    createDeviceDelivery() {
      events.push("device-delivery");
      return {
        status: () => ({ status: "stopped" }),
        stop: () => false,
      };
    },
    createServeSim() {
      events.push("serve-sim");
      return { inspect: async () => ({ available: true }) };
    },
  };
}

test("helper CLI extraction owns only the declared one-shot commands", async () => {
  for (const command of [
    "pair",
    "list-apps",
    "archive-app",
    "verify-device-build",
    "device-delivery-status",
    "device-delivery-stop",
    "serve-sim-info",
  ]) {
    assert.equal(helperCliCommandIsExtracted(command), true, command);
  }
  for (const command of [
    undefined,
    "serve",
    "start-session",
    "build-device",
    "delete-app",
    "stop-session",
    "unknown",
  ]) {
    assert.equal(helperCliCommandIsExtracted(command), false, String(command));
  }

  let serviceAccessed = false;
  const untouchedServices = new Proxy(services(), {
    get(target, property, receiver) {
      serviceAccessed = true;
      return Reflect.get(target, property, receiver);
    },
  });
  assert.equal(
    await dispatchHelperCliCommand({
      argv: ["serve"],
      services: untouchedServices,
    }),
    false,
  );
  assert.equal(serviceAccessed, false);
});

test("runtime composition constructs only the selected command owners", () => {
  const cases: Array<[string, string[]]> = [
    ["pair", ["state-root", "pairing-invite-store"]],
    ["list-apps", ["state-root", "device-build-store"]],
    ["archive-app", ["state-root", "device-build-store"]],
    [
      "verify-device-build",
      ["state-root", "device-build-store", "device-inventory"],
    ],
    ["device-delivery-status", ["state-root", "device-delivery"]],
    ["device-delivery-stop", ["state-root", "device-delivery"]],
    ["serve-sim-info", ["serve-sim"]],
  ];

  for (const [command, expected] of cases) {
    const events: string[] = [];
    createExtractedHelperServices(command, {
      factories: runtimeFactories(events),
      printQRCode: () => undefined,
    });
    assert.deepEqual(events, expected, command);
  }
});

test("pair command preserves TTL validation and QR output ordering", async () => {
  const lines: string[] = [];
  const qrCodes: string[] = [];
  const pairInputs: unknown[] = [];
  const fakeServices = services({
    pair: (input: unknown) => {
      pairInputs.push(input);
      return {
        macName: "Test Mac",
        links: {
          universalLink: "https://pair.example/invite",
          customScheme: "swiftsim://pair",
        },
        expiresAt: "2026-08-05T12:00:00.000Z",
      };
    },
    printQRCode: (value: string) => qrCodes.push(value),
  });

  assert.equal(
    await dispatchHelperCliCommand({
      argv: [
        "pair",
        "--qr",
        "--rotate",
        "--ttl-minutes",
        "5",
        "--mac-name",
        "Test Mac",
        "--remote-base-url",
        "https://pair.example",
      ],
      services: fakeServices,
      writeLine: (line) => lines.push(line),
    }),
    true,
  );
  assert.deepEqual(pairInputs, [
    {
      rotate: true,
      qr: true,
      macName: "Test Mac",
      remoteBaseUrl: "https://pair.example",
      ttlMs: 300_000,
    },
  ]);
  assert.deepEqual(lines, [
    "Pair with Test Mac",
    "Expires: 2026-08-05T12:00:00.000Z",
    "Pairing URL: https://pair.example/invite",
  ]);
  assert.deepEqual(qrCodes, ["https://pair.example/invite"]);

  await assert.rejects(
    dispatchHelperCliCommand({
      argv: ["pair", "--rotate", "--ttl-minutes", "5"],
      services: fakeServices,
    }),
    /--ttl-minutes requires --qr/,
  );
  assert.equal(pairInputs.length, 1);
});

test("app, delivery, and inspection commands preserve projections", async () => {
  const lines: string[] = [];
  const fakeServices = services();
  const run = async (argv: string[]) => {
    lines.length = 0;
    assert.equal(
      await dispatchHelperCliCommand({
        argv,
        services: fakeServices,
        writeLine: (line) => lines.push(line),
      }),
      true,
    );
    return JSON.parse(lines.join("\n")) as unknown;
  };

  assert.deepEqual(await run(["list-apps", "--archived"]), {
    apps: [{ id: "app-1", name: "App" }],
  });
  assert.deepEqual(await run(["archive-app", "--app-id", "app-1"]), {
    id: "app-1",
    archived: true,
  });
  assert.deepEqual(await run(["archive-app", "--app-id", "app-1", "--restore"]), {
    id: "app-1",
    archived: false,
  });
  assert.deepEqual(await run(["verify-device-build", "--build-id", "build-1"]), {
    id: "build-1",
    state: "ready",
  });
  assert.deepEqual(await run(["device-delivery-status"]), { running: true });
  assert.deepEqual(await run(["device-delivery-stop"]), { stopped: true });
  assert.deepEqual(await run(["serve-sim-info"]), { available: true });
});

test("helper bootstrap loads only the selected runtime after boundaries", async () => {
  const events: string[] = [];
  assert.equal(
    await runHelperBootstrap({
      argv: ["pair"],
      installBoundaries() {
        events.push("boundaries");
      },
      commandIsExtracted: helperCliCommandIsExtracted,
      async loadExtracted() {
        events.push("load-extracted");
        return async () => {
          events.push("dispatch");
          return true;
        };
      },
      async loadCompatibility() {
        events.push("compatibility");
      },
    }),
    "extracted",
  );
  assert.deepEqual(events, ["boundaries", "load-extracted", "dispatch"]);

  events.length = 0;
  assert.equal(
    await runHelperBootstrap({
      argv: ["serve"],
      installBoundaries() {
        events.push("boundaries");
      },
      commandIsExtracted: helperCliCommandIsExtracted,
      async loadExtracted() {
        events.push("load-extracted");
        return async () => true;
      },
      async loadCompatibility() {
        events.push("compatibility");
      },
    }),
    "compatibility",
  );
  assert.deepEqual(events, ["boundaries", "compatibility"]);
});

test("compiled official helper owns fresh-home state and matches compatibility output", () => {
  const official = fileURLToPath(
    new URL("../mac-helper/bin/swift-sim-helper-entry.js", import.meta.url),
  );
  const compatibility = fileURLToPath(
    new URL("../mac-helper/bin/swift-sim-helper.js", import.meta.url),
  );

  const run = (script: string, argv: string[], prepareLegacyStateRoot: boolean) => {
    const home = mkdtempSync(join(tmpdir(), "swift-sim-helper-cli-equivalence-"));
    try {
      if (prepareLegacyStateRoot) {
        mkdirSync(join(home, ".swift-sim"), { recursive: true, mode: 0o700 });
      }
      const result = spawnSync(process.execPath, [script, ...argv], {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
        timeout: 10_000,
      });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      return JSON.parse(result.stdout) as unknown;
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  };

  for (const argv of [
    ["list-apps"],
    ["device-delivery-status"],
    ["device-delivery-stop"],
  ]) {
    const freshOfficial = run(official, argv, false);
    assert.deepEqual(freshOfficial, run(compatibility, argv, true), argv.join(" "));
    assert.deepEqual(freshOfficial, run(official, argv, true), argv.join(" "));
  }

  const pairing = run(official, ["pair"], false) as {
    macName?: unknown;
    links?: { customScheme?: unknown };
  };
  assert.equal(typeof pairing.macName, "string");
  assert.equal(typeof pairing.links?.customScheme, "string");
});
