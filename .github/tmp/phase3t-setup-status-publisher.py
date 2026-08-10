from __future__ import annotations

import os
import subprocess
from pathlib import Path

BASE = os.environ["BASE"]
SOURCE_BRANCH = os.environ["SOURCE_BRANCH"]
PRODUCT_BRANCH = os.environ["PRODUCT_BRANCH"]
SOURCE_VERIFY_RUN = os.environ["SOURCE_VERIFY_RUN"]
REPO = "Miguelosaurus/Swift-Sim"
WORKTREE = "/tmp/phase3t-product"


def run(command: list[str], *, cwd: str | None = None, capture: bool = False) -> str:
    result = subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def output(command: list[str], *, cwd: str | None = None) -> str:
    return run(command, cwd=cwd, capture=True).strip()


def remote_sha(branch: str) -> str:
    line = output(["git", "ls-remote", "origin", f"refs/heads/{branch}"])
    return line.split()[0] if line else ""


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


run_state = output(["gh", "api", f"repos/{REPO}/actions/runs/{SOURCE_VERIFY_RUN}", "--jq", ".status + \":\" + (.conclusion // \\"\\")"])
if run_state != "completed:success":
    raise SystemExit(f"Phase 3S source Verify is not green: {run_state}")
if remote_sha(SOURCE_BRANCH) != BASE or remote_sha(PRODUCT_BRANCH) != BASE:
    raise SystemExit("Phase 3T source/product ref moved before construction")

run(["git", "worktree", "add", WORKTREE, BASE])
run(["npm", "ci"], cwd=WORKTREE)
root = Path(WORKTREE)

service = r'''// @ts-check

import { selectTailscaleProbe, tailscaleBackendsConflict } from "../tailscaleBackends.js";

/** @typedef {import("../contracts/command.js").CommandResult} CommandResult */
/** @typedef {import("../infrastructure/ports.js").CommandRunner} CommandRunner */
/** @typedef {{ mode: string, command: string, args: string[] }} TailscaleCandidate */
/** @typedef {{ code: number | null, stdout: string, stderr: string, error: string }} LegacyCommandResult */
/** @typedef {{
 *   Self?: { Online?: boolean, DNSName?: string, HostName?: string, TailscaleIPs?: string[], ID?: string },
 *   BackendState?: string,
 *   TailscaleIPs?: string[],
 *   CurrentTailnet?: { Name?: string },
 * }} TailscaleStatusPayload
 * @typedef {{
 *   candidate: TailscaleCandidate,
 *   result: LegacyCommandResult,
 *   parsed?: TailscaleStatusPayload,
 *   error: string,
 * }} TailscaleProbe
 * @typedef {{
 *   commandRunner: CommandRunner,
 *   pathExists(path: string): boolean,
 *   homeDirectory(): string,
 *   environmentNames(): string[],
 *   preferredTailscaleMode(): string,
 *   fetchImpl(input: string, init?: RequestInit): Promise<Response>,
 *   inspectTransports(): Promise<Record<string, { available?: boolean }>>,
 *   deviceDeliveryStatus(): unknown,
 *   defaultTransportPreference(): string,
 * }} SetupStatusDependencies
 */

const TAILSCALE_TIMEOUT_MS = 2_500;
const HELPER_HEALTH_TIMEOUT_MS = 1_200;
const COMMAND_OUTPUT_LIMIT_BYTES = 1_048_576;

/** @param {SetupStatusDependencies} dependencies */
export function createSetupStatusService(dependencies) {
  validateDependencies(dependencies);

  return Object.freeze({ setupStatus });

  /** @param {{ host: string, port: number }} input */
  async function setupStatus({ host, port }) {
    const [tailscaleInspection, helperHealth, transportInfo] = await Promise.all([
      inspectTailscaleBackends(),
      readHelperHealth(host, port),
      dependencies.inspectTransports(),
    ]);
    const tailscale = publicTailscaleStatus(tailscaleInspection);
    const serveStatus = await readTailscaleServeStatus(port, tailscaleInspection.selected);
    const defaultRemoteBaseUrl = tailscale.dnsName
      ? `https://${tailscale.dnsName.replace(/\.$/, "")}`
      : "";
    const remoteBaseUrl = serveStatus.remoteBaseUrl || defaultRemoteBaseUrl;
    /** @type {string[]} */
    const nextSteps = [];

    if (tailscale.conflict) {
      nextSteps.push(
        "Swift Sim found multiple Tailscale backends for different Mac identities. Keep one Tailscale connection, or set SWIFT_SIM_TAILSCALE_MODE explicitly before pairing.",
      );
    } else if (!tailscale.available) {
      nextSteps.push("Install Tailscale on the Mac and sign in to the same Tailnet as the iPhone.");
    } else if (!tailscale.online) {
      nextSteps.push("Open Tailscale on the Mac and connect it.");
    }

    if (!helperHealth.ok) {
      nextSteps.push("Run swift-sim setup to start the Mac helper.");
    }

    if (!tailscale.conflict && tailscale.online && !serveStatus.configured) {
      nextSteps.push(`Expose the helper privately: ${tailscaleServeCommand(tailscale.mode, port)}`);
    }

    if (!tailscale.conflict && remoteBaseUrl && helperHealth.ok && serveStatus.configured) {
      nextSteps.push("Generate an iPhone pairing link: swift-sim pair");
    }

    return {
      ok: !tailscale.conflict && tailscale.online && helperHealth.ok && serveStatus.configured,
      helper: helperHealth,
      tailscale,
      tailscaleServe: serveStatus,
      phoneConnection: {
        pairingCableRequired: false,
        installCableRequired: false,
        sameWifiRequired: false,
        sameTailnetRequired: true,
        internetRequired: true,
        macAwakeRequired: true,
        firstXcodeTrustMayRequireCable: true,
        detail:
          "For first-time pairing, install Tailscale on both devices, sign in to the same Tailnet, and keep the Mac awake with internet access. The devices may use different Wi-Fi networks or cellular. No cable is needed for Swift Sim pairing; connect one only if Xcode separately asks to trust or register this iPhone for its first signed device build.",
      },
      deviceDelivery: dependencies.deviceDeliveryStatus(),
      deviceBuildReady: helperHealth.ok,
      transport: {
        default: dependencies.defaultTransportPreference(),
        activeForPhone: preferredPhoneTransport(transportInfo),
        transports: transportInfo,
      },
      suggestedRemoteBaseUrl: remoteBaseUrl,
      nextSteps,
    };
  }

  async function inspectTailscaleBackends() {
    /** @type {TailscaleProbe[]} */
    const probes = [];
    for (const candidate of tailscaleCandidates()) {
      const result = await runTailscaleCandidate(candidate, ["status", "--json"]);
      /** @type {TailscaleStatusPayload | undefined} */
      let parsed;
      let parseError = "";
      if (!result.error) {
        try {
          parsed = /** @type {TailscaleStatusPayload} */ (JSON.parse(result.stdout));
        } catch (error) {
          parseError = error instanceof Error ? error.message : String(error);
        }
      }
      probes.push({ candidate, result, parsed, error: result.error || parseError });
    }

    const preferredMode = dependencies.preferredTailscaleMode();
    const selected = selectTailscaleProbe(probes, preferredMode);
    const conflict = tailscaleBackendsConflict(probes, selected, preferredMode);
    return { selected, probes, conflict, preferredMode };
  }

  /** @param {{ selected?: TailscaleProbe, probes: TailscaleProbe[], conflict: boolean }} inspection */
  function publicTailscaleStatus(inspection) {
    const selected = inspection.selected;
    const parsed = selected?.parsed;
    return {
      available: Boolean(selected),
      online: Boolean(parsed?.Self?.Online),
      backendState: parsed?.BackendState || "",
      dnsName: parsed?.Self?.DNSName || "",
      hostName: parsed?.Self?.HostName || "",
      ips: parsed?.Self?.TailscaleIPs || parsed?.TailscaleIPs || [],
      tailnet: parsed?.CurrentTailnet?.Name || "",
      mode: selected?.candidate.mode || "",
      conflict: inspection.conflict,
      backends: inspection.probes.map((probe) => ({
        mode: probe.candidate.mode,
        available: Boolean(probe.parsed),
        online: Boolean(probe.parsed?.Self?.Online),
        dnsName: probe.parsed?.Self?.DNSName || "",
        error: probe.error || "",
      })),
    };
  }

  /** @param {number} port @param {TailscaleProbe | undefined} selected */
  async function readTailscaleServeStatus(port, selected) {
    if (!selected) {
      return {
        configured: false,
        error: "No working Tailscale backend was found.",
        raw: "",
        mode: "",
      };
    }
    const result = await runTailscaleCandidate(selected.candidate, ["serve", "status"]);
    const mode = selected.candidate.mode;
    if (result.error) {
      return { configured: false, error: result.error, raw: "", mode };
    }
    return {
      configured: result.stdout.includes(String(port)),
      remoteBaseUrl: parseServeRemoteBaseUrl(result.stdout, port),
      raw: result.stdout.trim(),
      mode,
    };
  }

  /** @param {TailscaleCandidate} candidate @param {string[]} args */
  async function runTailscaleCandidate(candidate, args) {
    const invocationArgs = [...candidate.args, ...args];
    const result = await dependencies.commandRunner.run({
      executable: candidate.command,
      args: invocationArgs,
      environment: {
        inherit: dependencies.environmentNames(),
        overrides: {},
        unset: [],
      },
      policy: {
        timeoutMs: TAILSCALE_TIMEOUT_MS,
        outputLimitBytes: COMMAND_OUTPUT_LIMIT_BYTES,
        processGroup: "inherit",
        acceptedExitCodes: [0],
      },
    });
    return legacyCommandResult(candidate.command, invocationArgs, result);
  }

  function tailscaleCandidates() {
    /** @type {TailscaleCandidate[]} */
    const candidates = [{ mode: "default", command: "tailscale", args: [] }];
    const appCommand = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (dependencies.pathExists(appCommand)) {
      candidates.push({ mode: "app", command: appCommand, args: [] });
    }
    const userspaceSocket = `${dependencies.homeDirectory()}/.tailscale-userspace/tailscaled.sock`;
    if (dependencies.pathExists(userspaceSocket)) {
      candidates.push({ mode: "userspace", command: "tailscale", args: [`--socket=${userspaceSocket}`] });
    }
    return candidates;
  }

  /** @param {string} host @param {number} port */
  async function readHelperHealth(host, port) {
    const url = `http://${host}:${port}`;
    try {
      const response = await fetchWithTimeout(`${url}/health`, HELPER_HEALTH_TIMEOUT_MS);
      return { ok: response.ok, url, status: response.status };
    } catch (error) {
      return { ok: false, url, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /** @param {string} url @param {number} timeoutMs */
  async function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await dependencies.fetchImpl(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** @param {Record<string, { available?: boolean }>} info */
function preferredPhoneTransport(info) {
  return info["native-companion"]?.available ? "native-companion" : "serve-sim";
}

/** @param {string} mode @param {number} port */
function tailscaleServeCommand(mode, port) {
  if (mode === "userspace") {
    return `tailscale --socket ~/.tailscale-userspace/tailscaled.sock serve ${port}`;
  }
  return `tailscale serve ${port}`;
}

/** @param {string} output @param {number} port */
function parseServeRemoteBaseUrl(output, port) {
  let currentUrl = "";
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("https://")) {
      currentUrl = trimmed.split(/\s+/)[0].replace(/\/$/, "");
      continue;
    }
    if (currentUrl && trimmed.includes(`proxy http://127.0.0.1:${port}`)) return currentUrl;
  }
  return "";
}

/** @param {string} command @param {string[]} args @param {CommandResult} result */
function legacyCommandResult(command, args, result) {
  const code = result.code ?? null;
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  if (!result.error) return { code, stdout, stderr, error: "" };
  if (result.timedOut) {
    return { code, stdout, stderr, error: `${command} ${args.join(" ")} timed out` };
  }
  if (code !== null && code !== 0) {
    return {
      code,
      stdout,
      stderr,
      error: stderr || stdout || `${command} exited with code ${code}`,
    };
  }
  return { code, stdout, stderr, error: String(result.error) };
}

/** @param {SetupStatusDependencies} dependencies */
function validateDependencies(dependencies) {
  if (!dependencies || typeof dependencies !== "object") {
    throw new TypeError("Setup status service requires explicit dependencies.");
  }
  if (!dependencies.commandRunner || typeof dependencies.commandRunner.run !== "function") {
    throw new TypeError("Setup status service requires commandRunner.");
  }
  const required = [
    "pathExists",
    "homeDirectory",
    "environmentNames",
    "preferredTailscaleMode",
    "fetchImpl",
    "inspectTransports",
    "deviceDeliveryStatus",
    "defaultTransportPreference",
  ];
  for (const name of required) {
    if (typeof dependencies[name] !== "function") {
      throw new TypeError(`Setup status service requires ${name}.`);
    }
  }
}
'''
(root / "mac-helper/src/commands/setupStatusService.js").write_text(service)

helper_path = root / "mac-helper/bin/swift-sim-helper.js"
helper = helper_path.read_text()
helper = replace_once(helper, 'import { spawn } from "node:child_process";\n', '', "helper spawn import")
helper = replace_once(
    helper,
    'import {\n  selectTailscaleProbe,\n  tailscaleBackendsConflict,\n} from "../src/tailscaleBackends.js";\n',
    '',
    "helper tailscale import",
)
helper = replace_once(
    helper,
    'import { createSessionRuntimeController } from "../src/sessionRuntimeController.js";\n',
    'import { createSessionRuntimeController } from "../src/sessionRuntimeController.js";\nimport { createSetupStatusService } from "../src/commands/setupStatusService.js";\n',
    "setup status import",
)
helper = replace_once(
    helper,
    'let sessionRuntime;\nlet compatibilityRuntimeInitialized = false;\n',
    'let sessionRuntime;\nlet setupStatusRuntime;\nlet compatibilityRuntimeInitialized = false;\n',
    "setup status runtime declaration",
)
helper = replace_once(
    helper,
    '''  sessionRuntime = createSessionRuntimeController({\n    store,\n    transports,\n    adapter,\n    defaultTransportPreference,\n  });\n  deliveryReferenceCleanupRunning = false;\n''',
    '''  sessionRuntime = createSessionRuntimeController({\n    store,\n    transports,\n    adapter,\n    defaultTransportPreference,\n  });\n  setupStatusRuntime = createSetupStatusService({\n    commandRunner: runtime.commandRunner,\n    pathExists: existsSync,\n    homeDirectory: homedir,\n    environmentNames: () => Object.keys(process.env),\n    preferredTailscaleMode: () => process.env.SWIFT_SIM_TAILSCALE_MODE || "",\n    fetchImpl: (input, init) => fetch(input, init),\n    inspectTransports,\n    deviceDeliveryStatus: () => deviceDelivery.status(),\n    defaultTransportPreference,\n  });\n  deliveryReferenceCleanupRunning = false;\n''',
    "setup status runtime composition",
)
helper = replace_once(helper, '      setupStatus,\n', '      setupStatus: (values) => setupStatusRuntime.setupStatus(values),\n', "setup status command wiring")
setup_start = helper.find("async function setupStatus({ host, port }) {\n")
inspect_start = helper.find("async function inspectTransports() {\n", setup_start)
if setup_start < 0 or inspect_start < 0:
    raise SystemExit("setupStatus extraction sentinels missing")
helper = helper[:setup_start] + helper[inspect_start:]
residual_start = helper.find("function preferredPhoneTransport(info) {\n")
build_start = helper.find("async function createDeviceBuild(values) {\n", residual_start)
if residual_start < 0 or build_start < 0:
    raise SystemExit("setup-status residual extraction sentinels missing")
helper = helper[:residual_start] + helper[build_start:]
helper_path.write_text(helper)

runtime_path = root / "mac-helper/src/infrastructure/compatibilityHelperRuntime.js"
runtime = runtime_path.read_text()
runtime = replace_once(
    runtime,
    '// @ts-check\n\n',
    '// @ts-check\n\nimport { spawn, spawnSync } from "node:child_process";\n',
    "command runtime imports",
)
runtime = replace_once(
    runtime,
    'import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";\n',
    'import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";\nimport { NodeCommandRunner } from "./nodeCommandRunner.js";\n',
    "NodeCommandRunner import",
)
runtime = replace_once(
    runtime,
    ' *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,\n',
    ' *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,\n *   createCommandRunner(): NodeCommandRunner,\n',
    "command runner factory type",
)
runtime = replace_once(
    runtime,
    ' *   adapter: ServeSimAdapter,\n',
    ' *   adapter: ServeSimAdapter,\n *   commandRunner: NodeCommandRunner,\n',
    "command runner runtime type",
)
runtime = replace_once(
    runtime,
    '    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),\n',
    '    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),\n    createCommandRunner: () => new NodeCommandRunner({ spawn, spawnSync }),\n',
    "command runner default factory",
)
runtime = replace_once(
    runtime,
    '  const pairingStore = resolved.createPairingStore();\n  const adapter = resolved.createServeSimAdapter();\n  return {\n',
    '  const pairingStore = resolved.createPairingStore();\n  const adapter = resolved.createServeSimAdapter();\n  const commandRunner = resolved.createCommandRunner();\n  return {\n',
    "command runner construction",
)
runtime = replace_once(
    runtime,
    '    adapter,\n    activeDeviceBuildTasks: new Map(),\n',
    '    adapter,\n    commandRunner,\n    activeDeviceBuildTasks: new Map(),\n',
    "command runner runtime field",
)
runtime = replace_once(
    runtime,
    '    "createServeSimAdapter",\n    "createSessionStore",\n',
    '    "createServeSimAdapter",\n    "createCommandRunner",\n    "createSessionStore",\n',
    "command runner required factory",
)
runtime_path.write_text(runtime)

runtime_test_path = root / "test/compatibilityHelperRuntime.test.js"
runtime_test = runtime_test_path.read_text()
runtime_test = replace_once(
    runtime_test,
    '    "createDeviceInventory",\n  ].map',
    '    "createDeviceInventory",\n    "createCommandRunner",\n  ].map',
    "runtime test value factory",
)
runtime_test = replace_once(
    runtime_test,
    '  assert.strictEqual(runtime.adapter, adapter);\n',
    '  assert.strictEqual(runtime.adapter, adapter);\n  assert.strictEqual(runtime.commandRunner, values.createCommandRunner);\n',
    "runtime test command runner assertion",
)
runtime_test = replace_once(
    runtime_test,
    '    "createServeSimAdapter",\n    "createSessionStore",\n',
    '    "createServeSimAdapter",\n    "createCommandRunner",\n    "createSessionStore",\n',
    "runtime test construction order",
)
runtime_test = replace_once(
    runtime_test,
    '    createNativeCompanionTransport: factory,\n  };\n',
    '    createNativeCompanionTransport: factory,\n    createCommandRunner: factory,\n  };\n',
    "runtime test fresh factory",
)
runtime_test_path.write_text(runtime_test)

setup_test = r'''import assert from "node:assert/strict";
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

function dependencies(overrides = {}) {
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
  const { deps } = dependencies({ fetchImpl: undefined });
  assert.throws(() => createSetupStatusService(deps), /requires fetchImpl/);
});

test("setup status preserves healthy projection, command policy, and pairing guidance", async () => {
  const { deps, requests } = dependencies();
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });

  assert.equal(result.ok, true);
  assert.equal(result.helper.ok, true);
  assert.equal(result.helper.url, "http://127.0.0.1:47217");
  assert.equal(result.tailscale.mode, "default");
  assert.equal(result.tailscale.online, true);
  assert.equal(result.tailscale.dnsName, "mac.tail.ts.net.");
  assert.equal(result.tailscaleServe.configured, true);
  assert.equal(result.suggestedRemoteBaseUrl, "https://mac.tail.ts.net");
  assert.deepEqual(result.deviceDelivery, { running: false });
  assert.deepEqual(result.transport, {
    default: "auto",
    activeForPhone: "native-companion",
    transports: {
      "native-companion": { available: true },
      "serve-sim": { available: true },
    },
  });
  assert.deepEqual(result.nextSteps, ["Generate an iPhone pairing link: swift-sim pair"]);
  assert.equal(result.phoneConnection.sameTailnetRequired, true);
  assert.equal(result.phoneConnection.pairingCableRequired, false);

  assert.equal(requests.length, 2);
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
      processGroup: "inherit",
      acceptedExitCodes: [0],
    });
  }
});

test("setup status preserves Tailscale backend conflict detection and backend diagnostics", async () => {
  const app = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  const socket = "/Users/test/.tailscale-userspace/tailscaled.sock";
  const { deps } = dependencies({
    pathExists: (path) => path === app || path === socket,
    commandRunner: {
      async run(request) {
        if (request.args.includes("serve")) {
          return { code: 0, stdout: "", stderr: "" };
        }
        const mode = request.executable === app
          ? "app"
          : request.args[0]?.startsWith("--socket=")
            ? "userspace"
            : "default";
        return {
          code: 0,
          stdout: onlineStatus({ id: `id-${mode}`, dnsName: `${mode}.tail.ts.net.` }),
          stderr: "",
        };
      },
    },
  });
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });
  assert.equal(result.ok, false);
  assert.equal(result.tailscale.conflict, true);
  assert.deepEqual(result.tailscale.backends.map((backend) => backend.mode), [
    "default",
    "app",
    "userspace",
  ]);
  assert.match(result.nextSteps[0], /multiple Tailscale backends/);
});

test("preferred userspace mode preserves socket invocation and userspace serve guidance", async () => {
  const socket = "/Users/test/.tailscale-userspace/tailscaled.sock";
  const calls = [];
  const { deps } = dependencies({
    preferredTailscaleMode: () => "userspace",
    pathExists: (path) => path === socket,
    commandRunner: {
      async run(request) {
        calls.push(request.args);
        if (request.args.includes("--json")) {
          return { code: 0, stdout: onlineStatus({ id: "userspace" }), stderr: "" };
        }
        return { code: 0, stdout: "not configured", stderr: "" };
      },
    },
  });
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 49999 });
  assert.equal(result.tailscale.mode, "userspace");
  assert.equal(result.tailscale.conflict, false);
  assert.equal(result.tailscaleServe.configured, false);
  assert.ok(calls.some((args) => args[0] === `--socket=${socket}`));
  assert.ok(result.nextSteps.includes("Expose the helper privately: tailscale --socket ~/.tailscale-userspace/tailscaled.sock serve 49999"));
});

test("Tailscale timeout diagnostics retain the legacy command-and-args wording", async () => {
  const { deps } = dependencies({
    commandRunner: {
      async run() {
        return {
          code: null,
          stdout: "",
          stderr: "",
          error: "tailscale timed out",
          timedOut: true,
        };
      },
    },
  });
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.1", port: 47217 });
  assert.equal(result.tailscale.available, false);
  assert.equal(result.tailscale.backends[0].error, "tailscale status --json timed out");
  assert.equal(result.tailscaleServe.error, "No working Tailscale backend was found.");
});

test("helper health uses the exact requested endpoint and preserves failure guidance", async () => {
  const seen = [];
  const { deps } = dependencies({
    fetchImpl: async (url) => {
      seen.push(String(url));
      throw new Error("connection refused");
    },
  });
  const result = await createSetupStatusService(deps).setupStatus({ host: "127.0.0.2", port: 48000 });
  assert.deepEqual(seen, ["http://127.0.0.2:48000/health"]);
  assert.equal(result.helper.ok, false);
  assert.equal(result.helper.url, "http://127.0.0.2:48000");
  assert.ok(result.nextSteps.includes("Run swift-sim setup to start the Mac helper."));
});
'''
(root / "test/setupStatusService.test.js").write_text(setup_test)

run([
    "npx",
    "prettier",
    "--write",
    "mac-helper/src/commands/setupStatusService.js",
    "mac-helper/src/infrastructure/compatibilityHelperRuntime.js",
], cwd=WORKTREE)
run(["git", "diff", "--check"], cwd=WORKTREE)
run(["git", "config", "user.name", "github-actions[bot]"], cwd=WORKTREE)
run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=WORKTREE)
files = [
    "mac-helper/bin/swift-sim-helper.js",
    "mac-helper/src/commands/setupStatusService.js",
    "mac-helper/src/infrastructure/compatibilityHelperRuntime.js",
    "test/compatibilityHelperRuntime.test.js",
    "test/setupStatusService.test.js",
]
run(["git", "add", *files], cwd=WORKTREE)
actual = output(["git", "diff", "--cached", "--name-only", BASE], cwd=WORKTREE).splitlines()
if sorted(actual) != sorted(files):
    raise SystemExit(f"unexpected Phase 3T file set: {actual}")
run(["git", "diff", "--cached", "--check"], cwd=WORKTREE)
helper_after = (root / "mac-helper/bin/swift-sim-helper.js").read_text()
for forbidden in (
    'from "node:child_process"',
    "async function setupStatus(",
    "async function inspectTailscaleBackends(",
    "async function runCommand(",
    "async function fetchWithTimeout(",
):
    if forbidden in helper_after:
        raise SystemExit(f"helper still owns setup-status runtime: {forbidden}")
if "createSetupStatusService" not in helper_after or "setupStatusRuntime.setupStatus" not in helper_after:
    raise SystemExit("helper setup-status wiring is incomplete")

run(["git", "commit", "-m", "Phase 3T: extract setup status runtime"], cwd=WORKTREE)
candidate = output(["git", "rev-parse", "HEAD"], cwd=WORKTREE)
if output(["git", "rev-parse", "HEAD^"], cwd=WORKTREE) != BASE:
    raise SystemExit("Phase 3T candidate is not one commit on exact base")

run([
    "node",
    "--test",
    "--test-concurrency=1",
    "test/setupStatusService.test.js",
    "test/compatibilityHelperRuntime.test.js",
    "test/cliHealthFetchBoundary.test.js",
    "test/confirmationRuntimePreload.test.js",
], cwd=WORKTREE)
run(["npm", "run", "check"], cwd=WORKTREE)
run(["git", "diff", "--check"], cwd=WORKTREE)
if output(["git", "status", "--porcelain"], cwd=WORKTREE):
    raise SystemExit("Phase 3T candidate worktree is dirty after validation")

run_state = output(["gh", "api", f"repos/{REPO}/actions/runs/{SOURCE_VERIFY_RUN}", "--jq", ".status + \":\" + (.conclusion // \\"\\")"])
if run_state != "completed:success":
    raise SystemExit(f"Phase 3S source Verify moved out of green state: {run_state}")
if remote_sha(SOURCE_BRANCH) != BASE or remote_sha(PRODUCT_BRANCH) != BASE:
    raise SystemExit("Phase 3T source/product ref moved before publication")
run(["git", "push", "origin", f"HEAD:refs/heads/{PRODUCT_BRANCH}"], cwd=WORKTREE)
print(f"Published Phase 3T candidate {candidate}")
