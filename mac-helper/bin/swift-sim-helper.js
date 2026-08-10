#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL, URL } from "node:url";
import { ServeSimError } from "../src/serveSimAdapter.js";
import { runDeliveryCleanupSafely } from "../src/deliveryCleanupScheduler.js";
import {
  buildCapabilityExpiresAt,
  deviceDeliveryRequestAllowed,
} from "../src/deviceDelivery.js";
import {
  normalizeDeviceBuildTTLMinutes,
} from "../src/deviceBuildDefaults.js";
import {
  buildManifest,
  deviceBuildLinks,
  publicDeviceApp,
  publicDeviceBuild,
  requestDeviceBuildCancellation,
  runDeviceBuild,
  terminateRecordedDeviceBuildWorker,
} from "../src/deviceBuilder.js";
import {
  badRequest,
  notFound,
  readJson,
} from "../src/http.js";
import { buildCompanionLinks, buildPairingLinks, publicSession } from "../src/links.js";
import {
  selectTailscaleProbe,
  tailscaleBackendsConflict,
} from "../src/tailscaleBackends.js";
import { externalRequestBase } from "../src/requestOrigin.js";
import { claimDeviceVerification } from "../src/deviceVerificationGate.js";
import { createDeviceInstallationReconciliationCoordinator } from "../src/http/deviceInstallationReconciliationCoordinator.js";
import { createHelperServiceLifecycle } from "../src/http/helperServiceLifecycle.js";
import { createDeviceAppApplicationService } from "../src/http/deviceAppApplicationService.js";
import { handleDeviceAppRoutes } from "../src/http/deviceAppRoutes.js";
import { createDeviceBuildCommandApplicationService } from "../src/http/deviceBuildCommandApplicationService.js";
import { handleDeviceBuildCommandRoutes } from "../src/http/deviceBuildCommandRoutes.js";
import { createDeviceBuildCapabilityApplicationService } from "../src/http/deviceBuildCapabilityApplicationService.js";
import { handleDeviceBuildCapabilityRoutes } from "../src/http/deviceBuildCapabilityRoutes.js";
import { trackDeviceBuildTask as trackRegisteredDeviceBuildTask } from "../src/deviceBuildTaskTracker.js";
import { createHelperControlApplicationService } from "../src/http/helperControlApplicationService.js";
import { handleHelperControlRoutes } from "../src/http/helperControlRoutes.js";
import { createPairingPageApplicationService } from "../src/http/pairingPageApplicationService.js";
import { renderPairingPage } from "../src/http/pairingPageRenderer.js";
import { handlePairingPageRoutes } from "../src/http/pairingPageRoutes.js";
import { createSessionHttpApplicationService } from "../src/http/sessionHttpApplicationService.js";
import { handleSessionRoutes } from "../src/http/sessionRoutes.js";
import { createCompatibilityHelperRuntime } from "../src/infrastructure/compatibilityHelperRuntime.js";
import { runExtractedHelperCommand } from "../src/helperCliRuntime.js";
import { dispatchCompatibilityCommand } from "../src/commands/compatibilityCommands.js";
import { createSessionRuntimeController } from "../src/sessionRuntimeController.js";

const DEFAULT_PORT = Number(process.env.SWIFT_SIM_PORT || 47217);
const DEFAULT_HOST = process.env.SWIFT_SIM_HOST || "127.0.0.1";

let store;
let deviceBuildStore;
let deviceDelivery;
let pairingStore;
let pairingInviteStore;
let simulatorProfiles;
let deviceInventory;
let adapter;
let activeDeviceBuildTasks;
let deliveryReferenceCleanupRunning;
let transports;
let sessionRuntime;
let compatibilityRuntimeInitialized = false;

export async function runCompatibilityHelper(argv = process.argv.slice(2)) {
  if (await runExtractedHelperCommand(argv)) return;
  initializeCompatibilityRuntime();
  await main(argv);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCompatibilityHelper().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function initializeCompatibilityRuntime() {
  if (compatibilityRuntimeInitialized) return;
  const runtime = createCompatibilityHelperRuntime();
  store = runtime.store;
  deviceBuildStore = runtime.deviceBuildStore;
  deviceDelivery = runtime.deviceDelivery;
  pairingStore = runtime.pairingStore;
  pairingInviteStore = runtime.pairingInviteStore;
  simulatorProfiles = runtime.simulatorProfiles;
  deviceInventory = runtime.deviceInventory;
  adapter = runtime.adapter;
  activeDeviceBuildTasks = runtime.activeDeviceBuildTasks;
  transports = runtime.transports;
  sessionRuntime = createSessionRuntimeController({
    store,
    transports,
    adapter,
    defaultTransportPreference,
    idGenerator: runtime.idGenerator,
  });
  deliveryReferenceCleanupRunning = false;
  compatibilityRuntimeInitialized = true;
}

async function main(argv) {
  const handled = await dispatchCompatibilityCommand({
    argv,
    defaultHost: DEFAULT_HOST,
    defaultPort: DEFAULT_PORT,
    services: {
      serve,
      startSession: (values) => sessionRuntime.startOrReuseSession(values, { includeCodexMetadata: true }),
      companionLink({ sessionId, token, remoteBaseUrl }) {
        const session = store.get(sessionId);
        if (!session) throw new Error("Unknown session id.");
        ensureToken(session, token);
        return buildCompanionLinks(session, remoteBaseUrl);
      },
      setupStatus,
      async buildDevice(values) {
        const build = await createDeviceBuild(values);
        await runCLIDeviceBuild(build);
        return publicDeviceBuild(build);
      },
      async stopSession({ sessionId, token }) {
        const session = store.get(sessionId);
        if (!session) throw new Error("Unknown session id.");
        ensureToken(session, token);
        await sessionRuntime.stopSession(session.id);
        return { stopped: true, sessionId: session.id };
      },
    },
  });
  if (!handled) {
    const [command = "serve"] = argv;
    throw new Error(`Unknown command: ${command}`);
  }
}

async function serve({ host, port, deviceBuildsOnly = false }) {
  const deviceInstallationReconciler = createDeviceInstallationReconciliationCoordinator({
    listBuilds: () => deviceBuildStore.list(),
    verifyBuild: (build) => verifyDeviceBuild(build),
    saveVerification: (buildID, verification) => deviceBuildStore.saveVerification(buildID, verification),
    nowMs: () => Date.now(),
    nowIso: () => new Date().toISOString(),
  });
  const lifecycle = createHelperServiceLifecycle({
    createServer,
    host,
    port,
    deviceBuildsOnly,
    recoverInterruptedBuilds: recoverInterruptedDeviceBuilds,
    scheduleDeliveryCleanup: scheduleDeliveryReferenceCleanup,
    reconcileRequestedBuilds: () => deviceInstallationReconciler.runOnce(),
    activeBuildTasks: () => [...activeDeviceBuildTasks.values()],
    cancelBuild: requestDeviceBuildCancellation,
    listSessions: () => (typeof store.list === "function" ? store.list() : []),
    stopSession: (sessionID) => sessionRuntime.stopSession(sessionID),
  });
  await lifecycle.prepare();
  const deviceAppService = createDeviceAppApplicationService({
    pairingTokenMatches,
    listBuilds: () => deviceBuildStore.list(),
    projectBuild: publicDeviceBuild,
    listApps: (options) => deviceBuildStore.listApps(options),
    projectApp: publicDeviceApp,
    getApp: (appID) => deviceBuildStore.getApp(appID),
    setAppArchived: (appID, archived) => deviceBuildStore.setAppArchived(appID, archived),
    findRebuild: (options) => deviceBuildStore.findRebuild(options),
    latestReusableBuildForApp: (appID) => deviceBuildStore.latestReusableBuildForApp(appID),
    pathExists: existsSync,
    createRebuild: (source, options) => deviceBuildStore.createRebuild(source, options),
    startBuild: startManagedDeviceBuild,
    deleteApp: (appID, options) => deviceBuildStore.deleteApp(appID, options),
    drainDeliveryReferences: drainDeliveryReferenceCleanupJobs,
  });
  const deviceBuildCommandService = createDeviceBuildCommandApplicationService({
    pairingTokenMatches,
    createBuild: createDeviceBuild,
    startBuild: startManagedDeviceBuild,
    getBuild: (buildID) => deviceBuildStore.get(buildID),
    pathExists: existsSync,
    renewInstallLink: (buildID, options) => deviceBuildStore.renewInstallLink(buildID, options),
    trackTask: trackDeviceBuildTask,
    prepareDelivery: prepareDeviceDelivery,
    saveBuild: (build) => deviceBuildStore.save(build),
    projectBuild: publicDeviceBuild,
  });
  const deviceBuildCapabilityService = createDeviceBuildCapabilityApplicationService({
    pairedMacEnabled: !deviceBuildsOnly,
    pairingTokenMatches,
    getBuild: (buildID) => deviceBuildStore.get(buildID),
    saveBuild: (build) => deviceBuildStore.save(build),
    markInstallRequested: (buildID) => deviceBuildStore.markInstallRequested(buildID),
    saveVerification: (buildID, verification) => deviceBuildStore.saveVerification(buildID, verification),
    verifyBuild: verifyDeviceBuild,
    claimVerification: claimDeviceVerification,
    projectBuild: publicDeviceBuild,
    buildLinks: deviceBuildLinks,
    buildManifest,
    renderInstallPage: deviceBuildFallbackHtml,
    now: () => Date.now(),
  });
  const helperControlService = createHelperControlApplicationService({
    pairingTokenMatches,
    association: appleAppSiteAssociation,
    inspectServeSim: () => adapter.inspect(),
    defaultTransport: defaultTransportPreference,
    inspectTransports,
    pairingTokenMatchesQuery: (token) => pairingStore.tokenMatches(token),
    pairingStatus: () => pairingStore.status(),
    currentPairing: () => pairingStore.current(),
    claimToken: bearerToken,
    claimInvite: (invite, clientNonce, pairing) => pairingInviteStore.claim(invite, clientNonce, pairing),
    rotatePairing: () => pairingStore.rotate(),
    pairingLinks: buildPairingLinks,
  });
  const pairingPageService = createPairingPageApplicationService({
    currentPairing: () => pairingStore.current(),
    inspectInvite: (invite, pairing) => pairingInviteStore.inspect(invite, pairing),
    tokenMatches: (token) => pairingStore.tokenMatches(token),
    requestBase: externalRequestBase,
    renderPage: renderPairingPage,
  });
  const sessionRouteService = createSessionHttpApplicationService({
    pairingTokenMatches,
    getSession: (sessionId) => store.get(sessionId),
    tokenMatches,
    projectSession: publicSession,
    startSession: ({ remoteBaseUrl, ...values }) => sessionRuntime.startOrReuseSession({
      ...values,
      "remote-base-url": remoteBaseUrl,
    }),
    stopSession: (sessionID) => sessionRuntime.stopSession(sessionID),
    sessionLinks: (session) => buildCompanionLinks(session, session.remoteBaseUrl),
    streamSession: (res, session) => sessionRuntime.proxyStream(res, session),
    frameMask: (session) => simulatorProfiles.readMask(session.simulatorUDID),
    typeText: (session, text) => sessionRuntime.typeIntoSimulator(session, text),
    sendKey: (session, key) => sessionRuntime.sendNamedKey(session, key),
    tap: (session, x, y) => sessionRuntime.tapSimulator(session, x, y),
    gesture: (session, event) => sessionRuntime.sendGesture(session, event),
    multitouch: (session, event) => sessionRuntime.sendMultiTouch(session, event),
    control: (session, control) => sessionRuntime.sendControl(session, control),
    sessionPage: sessionFallbackHtml,
  });
  const requestListener = async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${req.headers.host}`);

      if (deviceBuildsOnly && !deviceDeliveryRequestAllowed(req.method, url.pathname)) {
        return notFound(res, "Not found.");
      }

      if (await handleHelperControlRoutes({ req, res, url, service: helperControlService })) return;

      if (await handleSessionRoutes({ req, res, url, service: sessionRouteService })) return;
      if (await handleDeviceAppRoutes({ req, res, url, service: deviceAppService })) return;
      if (await handleDeviceBuildCommandRoutes({ req, res, url, service: deviceBuildCommandService })) return;
      if (await handleDeviceBuildCapabilityRoutes({ req, res, url, service: deviceBuildCapabilityService })) return;

      if (await handlePairingPageRoutes({ req, res, url, service: pairingPageService })) return;

      return notFound(res, "Not found.");
    } catch (error) {
      const status = error instanceof ServeSimError ? 502 : 400;
      return badRequest(res, status, error instanceof Error ? error.message : String(error));
    }
  };
  await lifecycle.start(requestListener);
  await lifecycle.wait();
}

function verifyDeviceBuild(build) {
  return deviceInventory.verifyApp(build.app.bundleIdentifier, {
    version: build.app.version,
    build: build.app.build,
  });
}

async function setupStatus({ host, port }) {
  const [tailscaleInspection, helperHealth, transportInfo] = await Promise.all([
    inspectTailscaleBackends(),
    readHelperHealth(host, port),
    inspectTransports(),
  ]);
  const tailscale = publicTailscaleStatus(tailscaleInspection);
  const serveStatus = await readTailscaleServeStatus(port, tailscaleInspection.selected);
  const defaultRemoteBaseUrl = tailscale.dnsName ? `https://${tailscale.dnsName.replace(/\.$/, "")}` : "";
  const remoteBaseUrl = serveStatus.remoteBaseUrl || defaultRemoteBaseUrl;
  const nextSteps = [];

  if (tailscale.conflict) {
    nextSteps.push("Swift Sim found multiple Tailscale backends for different Mac identities. Keep one Tailscale connection, or set SWIFT_SIM_TAILSCALE_MODE explicitly before pairing.");
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
      detail: "For first-time pairing, install Tailscale on both devices, sign in to the same Tailnet, and keep the Mac awake with internet access. The devices may use different Wi-Fi networks or cellular. No cable is needed for Swift Sim pairing; connect one only if Xcode separately asks to trust or register this iPhone for its first signed device build.",
    },
    deviceDelivery: deviceDelivery.status(),
    deviceBuildReady: helperHealth.ok,
    transport: {
      default: defaultTransportPreference(),
      activeForPhone: preferredPhoneTransport(transportInfo),
      transports: transportInfo,
    },
    suggestedRemoteBaseUrl: remoteBaseUrl,
    nextSteps,
  };
}

async function inspectTransports() {
  return Object.fromEntries(await Promise.all(
    Object.entries(transports).map(async ([id, transport]) => [id, await transport.inspect()])
  ));
}

function defaultTransportPreference() {
  return process.env.SWIFT_SIM_TRANSPORT || "auto";
}

function preferredPhoneTransport(info) {
  if (info["native-companion"]?.available) {
    return "native-companion";
  }
  return "serve-sim";
}

async function inspectTailscaleBackends() {
  const probes = [];
  for (const candidate of tailscaleCandidates()) {
    const result = await runTailscaleCandidate(candidate, ["status", "--json"]);
    let parsed;
    let parseError = "";
    if (!result.error) {
      try {
        parsed = JSON.parse(result.stdout);
      } catch (error) {
        parseError = error instanceof Error ? error.message : String(error);
      }
    }
    probes.push({
      candidate,
      result,
      parsed,
      error: result.error || parseError,
    });
  }

  const preferredMode = process.env.SWIFT_SIM_TAILSCALE_MODE || "";
  const selected = selectTailscaleProbe(probes, preferredMode);
  const conflict = tailscaleBackendsConflict(probes, selected, preferredMode);

  return {
    selected,
    probes,
    conflict,
    preferredMode,
  };
}

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
    return {
      configured: false,
      error: result.error,
      raw: "",
      mode,
    };
  }
  return {
    configured: result.stdout.includes(String(port)),
    remoteBaseUrl: parseServeRemoteBaseUrl(result.stdout, port),
    raw: result.stdout.trim(),
    mode,
  };
}

function runTailscaleCandidate(candidate, args) {
  return runCommand(candidate.command, [...candidate.args, ...args], { timeoutMs: 2500 });
}

function tailscaleCandidates() {
  const candidates = [{ mode: "default", command: "tailscale", args: [] }];
  const appCommand = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  if (existsSync(appCommand)) {
    candidates.push({ mode: "app", command: appCommand, args: [] });
  }
  const userspaceSocket = `${homedir()}/.tailscale-userspace/tailscaled.sock`;
  if (existsSync(userspaceSocket)) {
    candidates.push({ mode: "userspace", command: "tailscale", args: [`--socket=${userspaceSocket}`] });
  }
  return candidates;
}

function tailscaleServeCommand(mode, port) {
  if (mode === "userspace") {
    return `tailscale --socket ~/.tailscale-userspace/tailscaled.sock serve ${port}`;
  }
  return `tailscale serve ${port}`;
}

function parseServeRemoteBaseUrl(output, port) {
  let currentUrl = "";
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("https://")) {
      currentUrl = trimmed.split(/\s+/)[0].replace(/\/$/, "");
      continue;
    }
    if (currentUrl && trimmed.includes(`proxy http://127.0.0.1:${port}`)) {
      return currentUrl;
    }
  }
  return "";
}

async function readHelperHealth(host, port) {
  try {
    const response = await fetchWithTimeout(`http://${host}:${port}/health`, 1200);
    return {
      ok: response.ok,
      url: `http://${host}:${port}`,
      status: response.status,
    };
  } catch (error) {
    return {
      ok: false,
      url: `http://${host}:${port}`,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function runCommand(command, args, { timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      resolve({ code: null, stdout, stderr, error: `${command} ${args.join(" ")} timed out` });
    }, timeoutMs);

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr, error: error.message });
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        code,
        stdout,
        stderr,
        error: code === 0 ? "" : (stderr || stdout || `${command} exited with code ${code}`),
      });
    });
  });
}

async function fetchWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function createDeviceBuild(values) {
  const remoteBaseUrl = values["remote-base-url"] || "";
  const delivery = values.delivery || (remoteBaseUrl ? "custom" : "quick-tunnel");
  if (!["custom", "quick-tunnel"].includes(delivery)) {
    throw new Error("Device delivery must be custom or quick-tunnel.");
  }
  if (delivery === "custom" && !remoteBaseUrl) {
    throw new Error("Custom device delivery requires --remote-base-url.");
  }
  const build = deviceBuildStore.create({
    project: values.project || "",
    workspace: values.workspace || "",
    scheme: required(values.scheme, "scheme"),
    configuration: values.configuration || "Release",
    remoteBaseUrl,
    delivery,
    exportMethod: values["export-method"] || "development",
    ttlMinutes: values["ttl-minutes"],
    preserveData: !values["replace-app-data"],
  });
  build.buildSettings = Array.isArray(values["build-setting"])
    ? values["build-setting"]
    : [];
  build.allowProvisioningUpdates = Boolean(values["allow-provisioning-updates"]);
  deviceBuildStore.save(build);
  return build;
}

async function prepareDeviceDelivery(build, { markBuildFailed = true } = {}) {
  let startedGeneration = "";
  let deliveryReferenceID = "";
  try {
    ensureBuildNotCancelled(build);
    const ttlMinutes = normalizeDeviceBuildTTLMinutes(build.installTTLMinutes);
    if (build.remoteBaseUrl || build.delivery?.mode === "custom") {
      build.expiresAt = buildCapabilityExpiresAt({ ttlMinutes });
      build.delivery = {
        mode: "custom",
        provider: "user-configured",
        expiresAt: build.expiresAt,
      };
      build.state = "ready";
      ensureBuildNotCancelled(build);
      deviceBuildStore.save(build);
      return build;
    }

    deliveryReferenceID = build.pendingRenewal?.id
      ? `renewal:${build.pendingRenewal.id}`
      : build.delivery?.referenceID || `build:${build.id}`;
    const delivery = await deviceDelivery.ensure({
      ttlMinutes,
      cancelPath: build.control?.cancelPath || "",
      referenceID: deliveryReferenceID,
    });
    startedGeneration = delivery.generation || "";
    ensureBuildNotCancelled(build);
    build.expiresAt = buildCapabilityExpiresAt({
      ttlMinutes,
      deliveryExpiresAt: delivery.expiresAt,
    });
    build.remoteBaseUrl = delivery.publicBaseUrl;
    build.delivery = {
      mode: "quick-tunnel",
      provider: delivery.provider,
      expiresAt: delivery.expiresAt,
      generation: delivery.generation || "",
      referenceID: deliveryReferenceID,
    };
    build.state = "ready";
    build.logs.push("Temporary HTTPS install link is ready. Tailscale is not required.");
    deviceBuildStore.save(build);
    return build;
  } catch (error) {
    if (startedGeneration && deliveryReferenceID) {
      try { deviceDelivery.stopGeneration(startedGeneration, { referenceID: deliveryReferenceID }); } catch {}
    }
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    if (markBuildFailed) build.state = "failed";
    build.logs.push(error instanceof Error ? error.message : String(error));
    try { deviceBuildStore.save(build); } catch {}
    throw error;
  }
}

function ensureBuildNotCancelled(build) {
  if (!build.control?.cancelPath || !existsSync(build.control.cancelPath)) return;
  const error = new Error("Device build was cancelled while delivery was starting.");
  error.code = "SWIFT_SIM_BUILD_CANCELLED";
  throw error;
}

function required(value, name) {
  if (!value || typeof value !== "string") {
    throw new Error(`Missing required ${name}.`);
  }
  return value;
}

function secretsMatch(expectedValue, actualValue) {
  if (!expectedValue || !actualValue) return false;
  const expected = Buffer.from(String(expectedValue));
  const actual = Buffer.from(String(actualValue));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function drainDeliveryReferenceCleanupJobs() {
  if (deliveryReferenceCleanupRunning) return;
  deliveryReferenceCleanupRunning = true;
  try {
    for (const job of deviceBuildStore.listDeliveryReferenceCleanupJobs()) {
      const dueAt = Date.parse(job.nextAttemptAt || job.createdAt || "");
      if (Number.isFinite(dueAt) && dueAt > Date.now()) continue;
      try {
        const released = deviceDelivery.stopGeneration(job.generation, { referenceID: job.referenceID });
        if (!released) throw new Error("Delivery generation is still referenced or could not be stopped.");
        deviceBuildStore.completeDeliveryReferenceCleanupJob(job.id);
      } catch (error) {
        deviceBuildStore.failDeliveryReferenceCleanupJob(job.id, error);
      }
    }
  } finally {
    deliveryReferenceCleanupRunning = false;
  }
}

function scheduleDeliveryReferenceCleanup() {
  return runDeliveryCleanupSafely(() => drainDeliveryReferenceCleanupJobs());
}

async function runCLIDeviceBuild(build) {
  const interrupt = () => requestDeviceBuildCancellation(build, "Swift Sim device build was interrupted.");
  process.once("SIGTERM", interrupt);
  process.once("SIGINT", interrupt);
  try {
    await runDeviceBuild(build, {
      save: (next) => deviceBuildStore.save(next),
      nextBuildNumber: (app, current) => deviceBuildStore.nextBuildNumber(app, current),
    });
    build.state = "delivering";
    build.logs.push("Creating temporary install link.");
    deviceBuildStore.save(build);
    await prepareDeviceDelivery(build);
    build.logs.push("Install link is ready.");
    deviceBuildStore.save(build);
  } finally {
    process.off("SIGTERM", interrupt);
    process.off("SIGINT", interrupt);
  }
}

function trackDeviceBuildTask(key, build, operation) {
  return trackRegisteredDeviceBuildTask(activeDeviceBuildTasks, key, build, operation);
}

function startManagedDeviceBuild(build) {
  return trackDeviceBuildTask(`build:${build.id}`, build, () =>
    runDeviceBuild(build, {
      save: (next) => deviceBuildStore.save(next),
      nextBuildNumber: (app, current) => deviceBuildStore.nextBuildNumber(app, current),
    })
      .then(() => {
        build.state = "delivering";
        build.logs.push("Creating temporary install link.");
        deviceBuildStore.save(build);
        return prepareDeviceDelivery(build).then((readyBuild) => {
          readyBuild.logs.push("Install link is ready.");
          deviceBuildStore.save(readyBuild);
          return readyBuild;
        });
      })
      .catch((error) => {
        if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") {
          build.state = "failed";
          build.logs = Array.isArray(build.logs) ? build.logs : [];
          build.logs.push("Build was interrupted before completion.");
          try { deviceBuildStore.save(build); } catch {}
        }
      })
  );
}

async function recoverInterruptedDeviceBuilds() {
  const activeStates = new Set(["validating", "preparing", "archiving", "building", "exporting", "delivering"]);
  for (const build of deviceBuildStore.list().filter((candidate) => activeStates.has(candidate.state))) {
    requestDeviceBuildCancellation(build, "Recovering an interrupted Swift Sim helper run.");
    const terminated = await terminateRecordedDeviceBuildWorker(build);
    for (const delivery of deviceDelivery.statuses()) {
      for (const referenceID of delivery.references || []) {
        if (referenceID === `build:${build.id}`
            || referenceID === `renewal:${build.pendingRenewal?.id || ""}`) {
          try { deviceDelivery.stopGeneration(delivery.generation, { referenceID }); } catch {}
        }
      }
    }
    build.state = "failed";
    build.logs = Array.isArray(build.logs) ? build.logs : [];
    build.logs.push(terminated
      ? "A previous helper run ended during this build. Start a new build to continue."
      : "A previous helper run ended during this build, and its worker could not be safely confirmed stopped.");
    try { deviceBuildStore.save(build); } catch {}
  }
}

function ensureToken(session, token) {
  if (!tokenMatches(session, token)) throw new Error("Invalid session token.");
}

function pairingTokenMatches(req, url) {
  return pairingStore.tokenMatches(bearerToken(req) || url.searchParams.get("token"));
}

function bearerToken(req) {
  const header = req.headers.authorization || "";
  return header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";
}

function tokenMatches(session, token) {
  return secretsMatch(session?.token, token);
}

function sessionFallbackHtml(session) {
  const links = buildCompanionLinks(session, session.remoteBaseUrl);
  const customSchemeScript = JSON.stringify(links.customScheme);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Swift Sim Session</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #fbfcff; color: #0f1115; }
    main { width: min(480px, calc(100vw - 36px)); padding: 28px; border-radius: 34px; background: rgba(255,255,255,.82); box-shadow: 0 24px 70px rgba(31,44,64,.12); border: 1px solid rgba(20,30,45,.08); }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #65707c; font-size: 15px; font-weight: 700; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: #34c759; display: inline-block; }
    h1 { margin: 12px 0 8px; font-size: 34px; line-height: 1.04; }
    p { color: #626b76; font-size: 17px; line-height: 1.4; }
    a.button { display: block; margin-top: 18px; padding: 16px 18px; border-radius: 999px; color: white; background: #1683ff; text-align: center; text-decoration: none; font-weight: 800; }
    code { display: block; margin-top: 16px; padding: 14px; border-radius: 18px; background: rgba(128,128,128,.12); color: #5b6570; word-break: break-all; font-size: 13px; }
  </style>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { window.location.href = ${customSchemeScript}; }, 250);
    });
  </script>
</head>
<body>
  <main>
    <div class="status"><span class="dot"></span>Opening Swift Sim</div>
    <h1>Swift Sim</h1>
    <p>This page opens the live Simulator in the Swift Sim app.</p>
    <a class="button" href="${escapeHtml(links.customScheme)}">Open in Swift Sim</a>
    <p>If that button does not switch apps, paste this link into Swift Sim:</p>
    <code>${escapeHtml(links.customScheme)}</code>
  </main>
</body>
</html>`;
}

function deviceBuildFallbackHtml(build) {
  const links = deviceBuildLinks(build, build.remoteBaseUrl);
  const installURL = links.installURL || "#";
  const customSchemeScript = JSON.stringify(links.customScheme);
  const warnings = (build.signing.warnings || [])
    .map((warning) => `<li>${escapeHtml(warning)}</li>`)
    .join("");
  const stateLine = build.state === "ready"
    ? "Ready to install on this iPhone"
    : build.state === "failed"
      ? "Build failed"
      : "Build is still running";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Install ${escapeHtml(build.app.name || build.scheme || "iOS App")}</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: -apple-system, BlinkMacSystemFont, sans-serif; background: #f7fbff; color: #101318; }
    main { width: min(520px, calc(100vw - 34px)); padding: 28px; border-radius: 34px; background: rgba(255,255,255,.86); box-shadow: 0 24px 70px rgba(31,44,64,.13); border: 1px solid rgba(20,30,45,.08); }
    .status { display: inline-flex; align-items: center; gap: 8px; color: #65707c; font-size: 15px; font-weight: 750; }
    .dot { width: 9px; height: 9px; border-radius: 50%; background: ${build.state === "ready" ? "#34c759" : build.state === "failed" ? "#ff3b30" : "#ffcc00"}; display: inline-block; }
    h1 { margin: 14px 0 8px; font-size: 34px; line-height: 1.04; letter-spacing: 0; }
    p { color: #626b76; font-size: 17px; line-height: 1.4; }
    .meta { margin: 16px 0 0; padding: 14px; border-radius: 18px; background: rgba(118,142,170,.1); color: #4c5864; font-size: 14px; }
    a.button { display: block; margin-top: 18px; padding: 16px 18px; border-radius: 999px; color: white; background: ${build.state === "ready" ? "#1683ff" : "#8f98a3"}; text-align: center; text-decoration: none; font-weight: 850; pointer-events: ${build.state === "ready" ? "auto" : "none"}; }
    a.secondary { display: block; margin-top: 16px; color: #66717d; text-align: center; text-decoration: none; font-size: 14px; font-weight: 700; }
    .fallback { margin-top: 10px; color: #7a838d; text-align: center; font-size: 13px; }
    ul { margin: 12px 0 0; padding-left: 20px; color: #6b7280; font-size: 14px; line-height: 1.35; }
    code { word-break: break-all; }
  </style>
  <script>
    window.addEventListener("load", () => {
      setTimeout(() => { window.location.href = ${customSchemeScript}; }, 250);
    });
  </script>
</head>
<body>
  <main>
    <div class="status"><span class="dot"></span>Opening Swift Sim</div>
    <h1>${escapeHtml(build.app.name || build.scheme || "iOS App")}</h1>
    <p>Swift Sim saves this version, then opens the iOS install prompt. Updates normally keep your login and app data.</p>
    <div class="meta">
      <strong>App ID: ${escapeHtml(build.app.bundleIdentifier || "Not available")}</strong><br>
      Link expires ${escapeHtml(new Date(build.expiresAt).toLocaleString())}
    </div>
    ${warnings ? `<ul>${warnings}</ul>` : ""}
    <a class="button" href="${escapeHtml(links.customScheme)}">Open in Swift Sim</a>
    <a class="secondary" href="${escapeHtml(installURL)}">Install directly</a>
    <div class="fallback">Installing directly will not save this version in Swift Sim.</div>
  </main>
</body>
</html>`;
}

function appleAppSiteAssociation() {
  const appId = process.env.SWIFT_SIM_IOS_APP_ID || "TEAMID.dev.local.SwiftSimCompanion";
  return {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: [appId],
          components: [
            {
              "/": "/s/*",
              comment: "Open Swift Sim companion sessions.",
            },
            {
              "/": "/pair",
              comment: "Pair Swift Sim companion with this Mac helper.",
            },
            {
              "/": "/d/*",
              comment: "Open Swift Sim device build installs.",
            },
          ],
        },
      ],
    },
  };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}
