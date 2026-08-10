// @ts-check

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
 * @typedef {{ configured: boolean, error?: string, raw: string, mode: string, remoteBaseUrl?: string }} TailscaleServeStatus
 * @typedef {{ ok: boolean, url: string, status?: number, error?: string }} HelperHealth
 * @typedef {{
 *   commandRunner: CommandRunner,
 *   pathExists(path: string): boolean,
 *   homeDirectory(): string,
 *   environmentNames(): string[],
 *   preferredTailscaleMode(): string,
 *   fetchImpl(input: string, init?: RequestInit | undefined): Promise<Response>,
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
      probes.push({
        candidate,
        result,
        ...(parsed ? { parsed } : {}),
        error: result.error || parseError,
      });
    }

    const preferredMode = dependencies.preferredTailscaleMode();
    const selected = /** @type {TailscaleProbe | undefined} */ (
      selectTailscaleProbe(probes, preferredMode)
    );
    const conflict = tailscaleBackendsConflict(probes, selected, preferredMode);
    return { selected, probes, conflict, preferredMode };
  }

  /** @param {{ selected: TailscaleProbe | undefined, probes: TailscaleProbe[], conflict: boolean }} inspection */
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

  /** @param {number} port @param {TailscaleProbe | undefined} selected @returns {Promise<TailscaleServeStatus>} */
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

  /** @param {TailscaleCandidate} candidate @param {string[]} args @returns {Promise<LegacyCommandResult>} */
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
        processGroup: "new",
        acceptedExitCodes: [0],
      },
    });
    return legacyCommandResult(candidate.command, invocationArgs, result);
  }

  /** @returns {TailscaleCandidate[]} */
  function tailscaleCandidates() {
    /** @type {TailscaleCandidate[]} */
    const candidates = [{ mode: "default", command: "tailscale", args: [] }];
    const appCommand = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
    if (dependencies.pathExists(appCommand)) {
      candidates.push({ mode: "app", command: appCommand, args: [] });
    }
    const userspaceSocket = `${dependencies.homeDirectory()}/.tailscale-userspace/tailscaled.sock`;
    if (dependencies.pathExists(userspaceSocket)) {
      candidates.push({
        mode: "userspace",
        command: "tailscale",
        args: [`--socket=${userspaceSocket}`],
      });
    }
    return candidates;
  }

  /** @param {string} host @param {number} port @returns {Promise<HelperHealth>} */
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
      const [candidateUrl] = trimmed.split(/\s+/);
      currentUrl = (candidateUrl || "").replace(/\/$/, "");
      continue;
    }
    if (currentUrl && trimmed.includes(`proxy http://127.0.0.1:${port}`)) return currentUrl;
  }
  return "";
}

/** @param {string} command @param {string[]} args @param {CommandResult} result @returns {LegacyCommandResult} */
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
  if (typeof dependencies?.commandRunner?.run !== "function") {
    throw new TypeError("Setup status service requires commandRunner.");
  }
  if (typeof dependencies.pathExists !== "function") {
    throw new TypeError("Setup status service requires pathExists.");
  }
  if (typeof dependencies.homeDirectory !== "function") {
    throw new TypeError("Setup status service requires homeDirectory.");
  }
  if (typeof dependencies.environmentNames !== "function") {
    throw new TypeError("Setup status service requires environmentNames.");
  }
  if (typeof dependencies.preferredTailscaleMode !== "function") {
    throw new TypeError("Setup status service requires preferredTailscaleMode.");
  }
  if (typeof dependencies.fetchImpl !== "function") {
    throw new TypeError("Setup status service requires fetchImpl.");
  }
  if (typeof dependencies.inspectTransports !== "function") {
    throw new TypeError("Setup status service requires inspectTransports.");
  }
  if (typeof dependencies.deviceDeliveryStatus !== "function") {
    throw new TypeError("Setup status service requires deviceDeliveryStatus.");
  }
  if (typeof dependencies.defaultTransportPreference !== "function") {
    throw new TypeError("Setup status service requires defaultTransportPreference.");
  }
}
