#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { pathToFileURL, URL } from "node:url";
import { ServeSimError } from "../src/serveSimAdapter.js";
import {
  buildCapabilityExpiresAt,
  deviceDeliveryRequestAllowed,
} from "../src/deviceDelivery.js";
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
import { createHelperControlApplicationService } from "../src/http/helperControlApplicationService.js";
import { handleHelperControlRoutes } from "../src/http/helperControlRoutes.js";
import { createPairingPageApplicationService } from "../src/http/pairingPageApplicationService.js";
import { renderPairingPage } from "../src/http/pairingPageRenderer.js";
import {
  appleAppSiteAssociation,
  renderDeviceBuildFallbackPage,
  renderSessionFallbackPage,
} from "../src/http/helperPresentation.js";
import { handlePairingPageRoutes } from "../src/http/pairingPageRoutes.js";
import { createSessionHttpApplicationService } from "../src/http/sessionHttpApplicationService.js";
import { handleSessionRoutes } from "../src/http/sessionRoutes.js";
import { createCompatibilityHelperRuntime } from "../src/infrastructure/compatibilityHelperRuntime.js";
import { prepareDeviceBuildShadowCompatibility } from "../src/persistence/deviceBuildShadowCompatibility.js";
import { runExtractedHelperCommand } from "../src/helperCliRuntime.js";
import { dispatchCompatibilityCommand } from "../src/commands/compatibilityCommands.js";
import { createSessionRuntimeController } from "../src/sessionRuntimeController.js";
import { createDeviceBuildRuntimeController } from "../src/deviceBuildRuntimeController.js";
import { createDeviceBuildArtifactRetentionCompatibility } from "../src/deviceBuildArtifactRetentionCompatibility.js";
import { createSetupStatusService } from "../src/commands/setupStatusService.js";
import { NodeCommandRunner } from "../src/infrastructure/nodeCommandRunner.js";

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
let transports;
let sessionRuntime;
let deviceBuildRuntime;
let setupStatusRuntime;
let clock;
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
  transports = runtime.transports;
  clock = runtime.clock;
  sessionRuntime = createSessionRuntimeController({
    store,
    transports,
    adapter,
    defaultTransportPreference,
    idGenerator: runtime.idGenerator,
    clock: runtime.clock,
  });
  const deviceBuildArtifactRetention = createDeviceBuildArtifactRetentionCompatibility({
    deviceBuildStore,
    clock: runtime.clock,
  });
  deviceBuildRuntime = createDeviceBuildRuntimeController({
    store: deviceBuildStore,
    artifactRetention: deviceBuildArtifactRetention,
    reportRetentionError: (message) => console.error(message),
    delivery: deviceDelivery,
    pathExists: existsSync,
    clock: runtime.clock,
    capabilityExpiresAt: buildCapabilityExpiresAt,
    runBuild: runDeviceBuild,
    requestCancellation: requestDeviceBuildCancellation,
    terminateRecordedWorker: terminateRecordedDeviceBuildWorker,
    signals: {
      once: (signal, listener) => process.once(signal, listener),
      off: (signal, listener) => process.off(signal, listener),
    },
  });
  const commandRunner = new NodeCommandRunner({ spawn, spawnSync });
  setupStatusRuntime = createSetupStatusService({
    commandRunner,
    pathExists: existsSync,
    homeDirectory: homedir,
    environmentNames: () => Object.keys(process.env),
    preferredTailscaleMode: () => process.env.SWIFT_SIM_TAILSCALE_MODE || "",
    fetchImpl: (input, init) => fetch(input, init),
    inspectTransports,
    deviceDeliveryStatus: () => deviceDelivery.status(),
    defaultTransportPreference,
  });
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
      setupStatus: (values) => setupStatusRuntime.setupStatus(values),
      async buildDevice(values) {
        const build = await deviceBuildRuntime.createBuild(values);
        await deviceBuildRuntime.runCliBuild(build);
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
    nowMs: () => clock.now().getTime(),
    nowIso: () => clock.now().toISOString(),
  });
  /** @type {{ shadowObserver: { observe(input: unknown): unknown } | null, close(): void }} */
  let deviceBuildShadow = {
    shadowObserver: null,
    close() {},
  };
  const lifecycle = createHelperServiceLifecycle({
    createServer,
    host,
    port,
    deviceBuildsOnly,
    recoverInterruptedBuilds: () => deviceBuildRuntime.recoverInterruptedBuilds(),
    scheduleDeliveryCleanup: () => deviceBuildRuntime.scheduleDeliveryCleanup(),
    reconcileRequestedBuilds: () => deviceInstallationReconciler.runOnce(),
    activeBuildTasks: () => deviceBuildRuntime.activeTasks(),
    cancelBuild: (build, reason) => deviceBuildRuntime.cancelBuild(build, reason),
    listSessions: () => (typeof store.list === "function" ? store.list() : []),
    stopSession: (sessionID) => sessionRuntime.stopSession(sessionID),
    closeResources: () => deviceBuildShadow.close(),
  });
  await lifecycle.prepare();
  deviceBuildShadow = await prepareDeviceBuildShadowCompatibility({
    deviceBuildStore,
    spawnSync,
    clock,
    reportError: (message) => console.error(message),
  });
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
    startBuild: (build) => deviceBuildRuntime.startBuild(build),
    deleteApp: (appID, options) => deviceBuildStore.deleteApp(appID, options),
    drainDeliveryReferences: () => deviceBuildRuntime.drainDeliveryReferences(),
  });
  const deviceBuildCommandService = createDeviceBuildCommandApplicationService({
    pairingTokenMatches,
    createBuild: (values) => deviceBuildRuntime.createBuild(values),
    startBuild: (build) => deviceBuildRuntime.startBuild(build),
    getBuild: (buildID) => deviceBuildStore.get(buildID),
    pathExists: existsSync,
    renewInstallLink: (buildID, options) => deviceBuildStore.renewInstallLink(buildID, options),
    trackTask: (key, build, operation) => deviceBuildRuntime.trackTask(key, build, operation),
    prepareDelivery: (build, options) => deviceBuildRuntime.prepareDelivery(build, options),
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
    renderInstallPage: (build) => renderDeviceBuildFallbackPage({
      build,
      links: deviceBuildLinks(build, build.remoteBaseUrl),
    }),
    now: () => clock.now().getTime(),
    shadowObserver: deviceBuildShadow.shadowObserver || undefined,
  });
  const helperControlService = createHelperControlApplicationService({
    pairingTokenMatches,
    association: () => appleAppSiteAssociation(
      process.env.SWIFT_SIM_IOS_APP_ID || "TEAMID.dev.local.SwiftSimCompanion",
    ),
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
    sessionPage: (session) => renderSessionFallbackPage(
      buildCompanionLinks(session, session.remoteBaseUrl),
    ),
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
  try {
    await lifecycle.start(requestListener);
  } catch (error) {
    try {
      deviceBuildShadow.close();
    } catch {
      console.error("Helper resource close failed.");
    }
    throw error;
  }
  await lifecycle.wait();
}

function verifyDeviceBuild(build) {
  return deviceInventory.verifyApp(build.app.bundleIdentifier, {
    version: build.app.version,
    build: build.app.build,
  });
}

async function inspectTransports() {
  return Object.fromEntries(await Promise.all(
    Object.entries(transports).map(async ([id, transport]) => [id, await transport.inspect()])
  ));
}

function defaultTransportPreference() {
  return process.env.SWIFT_SIM_TRANSPORT || "auto";
}

function secretsMatch(expectedValue, actualValue) {
  if (!expectedValue || !actualValue) return false;
  const expected = Buffer.from(String(expectedValue));
  const actual = Buffer.from(String(actualValue));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
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