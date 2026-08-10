import assert from "node:assert/strict";
import test from "node:test";
import { createSetupStatusService } from "../mac-helper/src/commands/setupStatusService.js";

function onlineStatus({ id = "node-1", dnsName = "mac.tail.ts.net." } = {}) {
  return JSON.stringify({
    Self: {
      Online: true,
      DNSName: dnsName,
      HostName: "Test Mac",
      TailscaleIPs: ["100.64.0.2"],
      ID: id,
    },
    BackendState: "Running",
    CurrentTailnet: { Name: "example.ts.net" },
  });
}

function harness(overrides = {}) {
  const requests = [];
  const deps = {
    commandRunner: {
      async run(request) {
        requests.push(request);
        if (request.args.includes("status") && request.args.includes("--json")) {
          return { code: 0, stdout: onlineStatus(), stderr: "" };
        }
        return {
          code: 0,
          stdout: "https://mac.tail.ts.net/\n|-- / proxy http://127.0.0.1:47217\n",
          stderr: "",
        };
      },
      runSync() {
        throw new Error("not used");
      },
    },
    pathExists: () => false,
    homeDirectory: () => "/Users/test",
    environmentNames: () => ["PATH", "HOME"],
    preferredTailscaleMode: () => "",
    fetchImpl: async () => new Response("ok", { status: 200 }),
    inspectTransports: async () => ({
      "native-companion": { available: true },
      "serve-sim": { available: true },
    }),
    deviceDeliveryStatus: () => ({ running: false }),
    defaultTransportPreference: () => "auto",
    ...overrides,
  };
  return { deps, requests };
}

test("setup status service validates its explicit infrastructure boundary", () => {
  assert.throws(() => createSetupStatusService({}), /requires commandRunner/);
  const { deps } = harness({ fetchImpl: undefined });
  assert.throws(() => createSetupStatusService(deps), /requires fetchImpl/);
});

test("healthy setup status preserves projection and uses hardened owned command policy", async () => {
  const { deps, requests } = harness();
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });

  assert.equal(result.ok, true);
  assert.deepEqual(result.helper, { ok: true, url: "http://127.0.0.1:47217", status: 200 });
  assert.equal(result.tailscale.mode, "default");
  assert.equal(result.tailscale.online, true);
  assert.equal(result.tailscaleServe.configured, true);
  assert.equal(result.suggestedRemoteBaseUrl, "https://mac.tail.ts.net");
  assert.deepEqual(result.nextSteps, ["Generate an iPhone pairing link: swift-sim pair"]);
  assert.equal(result.phoneConnection.sameTailnetRequired, true);
  assert.equal(result.phoneConnection.pairingCableRequired, false);
  assert.equal(result.transport.activeForPhone, "native-companion");

  assert.deepEqual(requests.map((request) => [request.executable, request.args]), [
    ["tailscale", ["status", "--json"]],
    ["tailscale", ["serve", "status"]],
  ]);
  for (const request of requests) {
    assert.deepEqual(request.environment, {
      inherit: ["PATH", "HOME"],
      overrides: {},
      unset: [],
    });
    assert.deepEqual(request.policy, {
      timeoutMs: 2500,
      outputLimitBytes: 1_048_576,
      processGroup: "new",
      acceptedExitCodes: [0],
    });
  }
});

test("backend conflicts remain fail-closed while exposing backend diagnostics", async () => {
  const app = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const socket = "/Users/test/.tailscale-userspace/tailscaled.sock";
  const { deps } = harness({
    pathExists: (path) => path === app || path === socket,
    commandRunner: {
      async run(request) {
        if (request.args.includes("serve")) return { code: 0, stdout: "", stderr: "" };
        const mode = request.executable === app
          ? "app"
          : request.args[0]?.startsWith("--socket=")
            ? "userspace"
            : "default";
        return {
          code: 0,
          stdout: onlineStatus({ id: mode === "userspace" ? "node-2" : "node-1", dnsName: `${mode}.tail.ts.net.` }),
          stderr: "",
        };
      },
      runSync() { throw new Error("not used"); },
    },
  });

  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });
  assert.equal(result.ok, false);
  assert.equal(result.tailscale.conflict, true);
  assert.deepEqual(result.tailscale.backends.map((backend) => backend.mode), ["default", "app", "userspace"]);
  assert.match(result.nextSteps[0], /multiple Tailscale backends/);
  assert.equal(result.nextSteps.some((step) => step.startsWith("Expose the helper privately:")), false);
});

test("preferred userspace backend keeps legacy serve guidance and command errors", async () => {
  const socket = "/Users/test/.tailscale-userspace/tailscaled.sock";
  const { deps, requests } = harness({
    pathExists: (path) => path === socket,
    preferredTailscaleMode: () => "userspace",
    commandRunner: {
      async run(request) {
        requests.push(request);
        if (request.args.includes("--json")) {
          if (request.args[0]?.startsWith("--socket=")) {
            return { code: 0, stdout: onlineStatus({ id: "user-node" }), stderr: "" };
          }
          return { code: 1, stdout: "", stderr: "not logged in", error: "tailscale exited with code 1" };
        }
        return { code: null, stdout: "", stderr: "", error: "tailscale timed out", timedOut: true };
      },
      runSync() { throw new Error("not used"); },
    },
  });

  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });
  assert.equal(result.tailscale.mode, "userspace");
  assert.equal(result.tailscale.conflict, false);
  assert.equal(result.tailscaleServe.error, `tailscale --socket=${socket} serve status timed out`);
  assert.ok(result.nextSteps.includes("Expose the helper privately: tailscale --socket ~/.tailscale-userspace/tailscaled.sock serve 47217"));
  assert.equal(requests.at(-1).policy.processGroup, "new");
});

test("helper-health failure preserves setup remediation and serve-sim fallback", async () => {
  const { deps } = harness({
    fetchImpl: async () => { throw new Error("helper unavailable"); },
    inspectTransports: async () => ({
      "native-companion": { available: false },
      "serve-sim": { available: true },
    }),
  });
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });
  assert.equal(result.ok, false);
  assert.equal(result.helper.error, "helper unavailable");
  assert.equal(result.transport.activeForPhone, "serve-sim");
  assert.ok(result.nextSteps.includes("Run swift-sim setup to start the Mac helper."));
});
