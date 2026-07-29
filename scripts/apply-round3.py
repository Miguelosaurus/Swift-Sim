#!/usr/bin/env python3
from pathlib import Path
import re


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Missing expected block in {path}: {old[:160]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Expected one match in {path}, found {text.count(old)}")
    file.write_text(text.replace(old, new, 1))


def replace_regex(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    text = file.read_text()
    next_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected one regex match in {path}, found {count}: {pattern[:120]!r}")
    file.write_text(next_text)


def append_text(path: str, addition: str) -> None:
    file = Path(path)
    text = file.read_text()
    if addition.strip() in text:
        return
    file.write_text(text.rstrip() + "\n\n" + addition.strip() + "\n")


marker_path = Path("mac-helper/src/deviceBuildStore.js")
if "round3-capability-generations" in marker_path.read_text():
    print("round3 fixes already applied")
    raise SystemExit(0)

# ---------------------------------------------------------------------------
# Durable bearer-capability generations.
# ---------------------------------------------------------------------------
replace_once(
    "mac-helper/src/deviceBuildStore.js",
    'const ACTIVE_BUILD_STATES = new Set([',
    '// round3-capability-generations\nconst MAX_RETAINED_CAPABILITIES = 16;\nconst ACTIVE_BUILD_STATES = new Set(['
)

replace_once(
    "mac-helper/src/deviceBuildStore.js",
    '''      const incoming = normalizeIncomingBuild(structuredClone(build));
      incoming.installation = newerInstallation(existing.installation, incoming.installation);
      incoming.logs = mergeLogs(existing.logs, incoming.logs);

      const pending = existing.pendingRenewal;''',
    '''      const incoming = normalizeIncomingBuild(structuredClone(build));
      incoming.installation = newerInstallation(existing.installation, incoming.installation);
      incoming.logs = mergeLogs(existing.logs, incoming.logs);
      incoming.capabilities = mergeCapabilities(existing.capabilities, incoming.capabilities);

      const pending = existing.pendingRenewal;'''
)

replace_once(
    "mac-helper/src/deviceBuildStore.js",
    '''        if (sameLease && renewalCandidateIsReady(incoming, pending.target)) {
          incoming.token = pending.token;
          incoming.tokenExpiredAt = "";
          incoming.installTTLMinutes = pending.target.ttlMinutes;
          incoming.remoteBaseUrl = incoming.remoteBaseUrl || pending.target.remoteBaseUrl;
          delete incoming.pendingRenewal;''',
    '''        if (sameLease && renewalCandidateIsReady(incoming, pending.target)) {
          const previousCapability = currentCapability(existing);
          if (capabilityIsLive(previousCapability)) {
            incoming.capabilities = mergeCapabilities(incoming.capabilities, [previousCapability]);
          }
          incoming.token = pending.token;
          incoming.tokenExpiredAt = "";
          incoming.installTTLMinutes = pending.target.ttlMinutes;
          incoming.remoteBaseUrl = incoming.remoteBaseUrl || pending.target.remoteBaseUrl;
          delete incoming.pendingRenewal;'''
)

replace_once(
    "mac-helper/src/deviceBuildStore.js",
    '''function preserveSecurityFields(target, source) {
  target.token = source.token;
  target.tokenExpiredAt = source.tokenExpiredAt || "";
  target.expiresAt = source.expiresAt;
  target.remoteBaseUrl = source.remoteBaseUrl;
  target.delivery = structuredClone(source.delivery || null);
  target.installTTLMinutes = source.installTTLMinutes;
}''',
    '''function preserveSecurityFields(target, source) {
  target.token = source.token;
  target.tokenExpiredAt = source.tokenExpiredAt || "";
  target.expiresAt = source.expiresAt;
  target.remoteBaseUrl = source.remoteBaseUrl;
  target.delivery = structuredClone(source.delivery || null);
  target.installTTLMinutes = source.installTTLMinutes;
  target.capabilities = normalizeCapabilities(source.capabilities);
}'''
)

replace_once(
    "mac-helper/src/deviceBuildStore.js",
    '''function recoverStaleRenewals(builds) {
  const now = Date.now();
  let changed = false;
  for (const build of builds.values()) {
    const deadline = Date.parse(build.pendingRenewal?.deadlineAt || "");
    if (!build.pendingRenewal || (Number.isFinite(deadline) && deadline > now)) continue;
    delete build.pendingRenewal;
    touchBuild(build);
    changed = true;
  }
  return changed;
}''',
    '''function recoverStaleRenewals(builds) {
  const now = Date.now();
  let changed = false;
  for (const build of builds.values()) {
    const normalizedCapabilities = normalizeCapabilities(build.capabilities, now);
    if (JSON.stringify(normalizedCapabilities) !== JSON.stringify(build.capabilities || [])) {
      build.capabilities = normalizedCapabilities;
      changed = true;
    }
    const deadline = Date.parse(build.pendingRenewal?.deadlineAt || "");
    if (!build.pendingRenewal || (Number.isFinite(deadline) && deadline > now)) continue;
    delete build.pendingRenewal;
    touchBuild(build);
    changed = true;
  }
  return changed;
}'''
)

replace_once(
    "mac-helper/src/deviceBuildStore.js",
    '''  build.revision = Number(build.revision || 0);
  build.tokenExpiredAt = build.tokenExpiredAt || "";
  return build;
}''',
    '''  build.revision = Number(build.revision || 0);
  build.tokenExpiredAt = build.tokenExpiredAt || "";
  build.capabilities = normalizeCapabilities(build.capabilities);
  return build;
}'''
)

insert_capability_helpers = r'''
function currentCapability(build) {
  return {
    token: build.token || "",
    expiresAt: build.expiresAt || "",
    remoteBaseUrl: build.remoteBaseUrl || "",
    delivery: structuredClone(build.delivery || null),
    installTTLMinutes: build.installTTLMinutes,
    createdAt: build.updatedAt || build.createdAt || new Date().toISOString(),
  };
}

function capabilityIsLive(capability, now = Date.now()) {
  const expiresAt = Date.parse(capability?.expiresAt || "");
  return Boolean(capability?.token) && Number.isFinite(expiresAt) && expiresAt > now;
}

function normalizeCapabilities(capabilities, now = Date.now()) {
  const byToken = new Map();
  for (const capability of Array.isArray(capabilities) ? capabilities : []) {
    const normalized = {
      token: String(capability?.token || ""),
      expiresAt: String(capability?.expiresAt || ""),
      remoteBaseUrl: String(capability?.remoteBaseUrl || ""),
      delivery: capability?.delivery ? structuredClone(capability.delivery) : null,
      installTTLMinutes: normalizeDeviceBuildTTLMinutes(capability?.installTTLMinutes),
      createdAt: String(capability?.createdAt || ""),
    };
    if (!capabilityIsLive(normalized, now)) continue;
    byToken.set(normalized.token, normalized);
  }
  return [...byToken.values()]
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))
    .slice(-MAX_RETAINED_CAPABILITIES);
}

function mergeCapabilities(first, second) {
  return normalizeCapabilities([...(first || []), ...(second || [])]);
}
'''
replace_once(
    "mac-helper/src/deviceBuildStore.js",
    '\nfunction normalizeInstallation(installation = {}) {',
    '\n' + insert_capability_helpers + '\nfunction normalizeInstallation(installation = {}) {'
)

# ---------------------------------------------------------------------------
# Reference-leased tunnel generations.
# ---------------------------------------------------------------------------
replace_once(
    "mac-helper/src/deviceDelivery.js",
    '  async ensure({ ttlMinutes = DEFAULT_DEVICE_BUILD_TTL_MINUTES, cancelPath = "" } = {}) {',
    '  async ensure({ ttlMinutes = DEFAULT_DEVICE_BUILD_TTL_MINUTES, cancelPath = "", referenceID = "" } = {}) {'
)
replace_once(
    "mac-helper/src/deviceDelivery.js",
    '''      const reusable = records
        .map((record) => record.state)
        .filter((state) => deliveryIsReusable(state, ttlMinutes))
        .sort((a, b) => Date.parse(a.expiresAt || "") - Date.parse(b.expiresAt || ""))[0];
      if (reusable) return { ...reusable, reused: true };''',
    '''      const reusableRecord = records
        .filter(({ state }) => deliveryIsReusable(state, ttlMinutes))
        .sort((a, b) => Date.parse(a.state.expiresAt || "") - Date.parse(b.state.expiresAt || ""))[0];
      if (reusableRecord) {
        const referenced = addGenerationReference(reusableRecord.path, reusableRecord.state, referenceID);
        return { ...referenced, reused: true };
      }'''
)
replace_once(
    "mac-helper/src/deviceDelivery.js",
    '''        if (state.status === "ready" && state.publicBaseUrl && deliveryProcessesAreOwned(state)) {
          return { ...state, reused: false };
        }''',
    '''        if (state.status === "ready" && state.publicBaseUrl && deliveryProcessesAreOwned(state)) {
          const referenced = addGenerationReference(generationStatePath, state, referenceID);
          return { ...referenced, reused: false };
        }'''
)
replace_regex(
    "mac-helper/src/deviceDelivery.js",
    r'''  stopGeneration\(generation\) \{.*?\n  \}\n\n  status\(\) \{''',
    '''  stopGeneration(generation, { referenceID = "" } = {}) {
    const release = acquireLifecycleLockSync(this.lifecycleLockPath);
    try {
      const record = deliveryStateRecords(this.statePath)
        .find(({ state }) => state.generation === generation);
      if (!record) return true;
      const references = generationReferences(record.state);
      if (referenceID) {
        const remaining = references.filter((value) => value !== referenceID);
        const nextState = { ...record.state, references: remaining, updatedAt: new Date().toISOString() };
        writeStateFile(record.path, nextState);
        if (remaining.length > 0) return true;
        record.state = nextState;
      } else if (references.length > 0) {
        return false;
      }
      const outcome = terminateOwnedDelivery(record.state);
      if (outcome.allExited) {
        removeGenerationFiles({
          statePath: this.statePath,
          logPath: this.logPath,
          recordPath: record.path,
          state: record.state,
        });
      } else {
        persistShutdownOutcome(record.path, record.state, outcome);
      }
      return outcome.allExited;
    } finally {
      release();
    }
  }

  status() {'''
)

reference_helpers = r'''
function generationReferences(state) {
  return [...new Set((Array.isArray(state?.references) ? state.references : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function addGenerationReference(path, state, referenceID) {
  if (!referenceID) return state;
  const references = generationReferences(state);
  if (!references.includes(referenceID)) references.push(referenceID);
  const next = { ...state, references, updatedAt: new Date().toISOString() };
  writeStateFile(path, next);
  return next;
}
'''
replace_once(
    "mac-helper/src/deviceDelivery.js",
    '\nfunction newestFirst(a, b) {',
    '\n' + reference_helpers + '\nfunction newestFirst(a, b) {'
)

# ---------------------------------------------------------------------------
# Helper routing: capability-aware auth, reference cleanup, resilient timers,
# and bounded shutdown.
# ---------------------------------------------------------------------------
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''        if (req.method === "DELETE" && !action) {
          const deleted = deviceBuildStore.deleteApp(appID, {
            deleteArtifacts: url.searchParams.get("keepArtifacts") !== "true",
          });
          return deleted ? json(res, 200, { deleted: true, appId: appID }) : notFound(res, "Unknown app.");
        }''',
    '''        if (req.method === "DELETE" && !action) {
          const appBeforeDeletion = deviceBuildStore.getApp(appID);
          const deleted = deviceBuildStore.deleteApp(appID, {
            deleteArtifacts: url.searchParams.get("keepArtifacts") !== "true",
          });
          if (deleted && appBeforeDeletion) releaseAppDeliveryReferences(appBeforeDeletion);
          return deleted ? json(res, 200, { deleted: true, appId: appID }) : notFound(res, "Unknown app.");
        }'''
)

replace_regex(
    "mac-helper/bin/swift-sim-helper.js",
    r'''      const deviceBuildMatch = url\.pathname\.match\(\/\^\\/api\\/device-builds.*?\n      \}\n\n      const deviceArtifactMatch''',
    '''      const deviceBuildMatch = url.pathname.match(/^\\/api\\/device-builds\\/([^/]+)(?:\\/(logs|links|install-request|verify))?$/);
      if (deviceBuildMatch) {
        const [, buildId, action] = deviceBuildMatch;
        const build = deviceBuildStore.get(buildId);
        if (!build) return notFound(res, "Unknown device build.");
        const capabilityBuild = buildForCapabilityToken(build, url.searchParams.get("token"));
        const pairedMacTokenMatches = !deviceBuildsOnly && pairingTokenMatches(req, url);
        if (!capabilityBuild && !pairedMacTokenMatches) return unauthorized(res);
        const responseBuild = pairedMacTokenMatches ? build : capabilityBuild;
        if (!pairedMacTokenMatches && deviceBuildExpired(responseBuild)) {
          return badRequest(res, 410, "Device build install page expired. Create a fresh build.");
        }
        if (req.method === "GET" && !action) {
          return json(res, 200, publicDeviceBuild(responseBuild));
        }
        if (req.method === "GET" && action === "logs") {
          return json(res, 200, { buildId, logs: build.logs.slice(-300) });
        }
        if (req.method === "GET" && action === "links") {
          const remoteBaseUrl = responseBuild.remoteBaseUrl || `${url.protocol}//${url.host}`;
          if (pairedMacTokenMatches && !build.remoteBaseUrl) {
            build.remoteBaseUrl = remoteBaseUrl;
            deviceBuildStore.save(build);
          }
          return json(res, 200, deviceBuildLinks(responseBuild, remoteBaseUrl));
        }
        if (req.method === "POST" && action === "install-request") {
          const requestedBuild = deviceBuildStore.markInstallRequested(buildId);
          return json(res, 200, publicDeviceBuild(
            pairedMacTokenMatches ? requestedBuild : projectCapability(requestedBuild, responseBuild)
          ));
        }
        if (req.method === "POST" && action === "verify") {
          const verification = await verifyDeviceBuild(build);
          const verifiedBuild = deviceBuildStore.saveVerification(buildId, verification);
          return json(res, 200, publicDeviceBuild(
            pairedMacTokenMatches ? verifiedBuild : projectCapability(verifiedBuild, responseBuild)
          ));
        }
      }

      const deviceArtifactMatch'''
)

replace_regex(
    "mac-helper/bin/swift-sim-helper.js",
    r'''      const deviceArtifactMatch = url\.pathname\.match\(.*?\n      \}\n\n      const sessionMatch''',
    '''      const deviceArtifactMatch = url.pathname.match(/^\\/api\\/device-builds\\/([^/]+)\\/artifact\\/(ipa|manifest)$/);
      if (deviceArtifactMatch && req.method === "GET") {
        const [, buildId, artifact] = deviceArtifactMatch;
        const build = deviceBuildStore.get(buildId);
        if (!build) return notFound(res, "Unknown device build.");
        const capabilityBuild = buildForCapabilityToken(build, url.searchParams.get("token"));
        if (!capabilityBuild) return unauthorized(res);
        if (deviceBuildExpired(capabilityBuild)) {
          return badRequest(res, 410, "Device build install page expired. Create a fresh build.");
        }
        if (build.state !== "ready") {
          return badRequest(res, 409, "Device build is not ready yet.");
        }
        const remoteBaseUrl = capabilityBuild.remoteBaseUrl || `${url.protocol}//${url.host}`;
        if (artifact === "manifest") {
          return text(res, 200, buildManifest(capabilityBuild, remoteBaseUrl), "text/xml; charset=utf-8");
        }
        return serveFile(res, build.artifacts.ipaPath, {
          contentType: "application/octet-stream",
          filename: `${build.app.name || build.scheme || "App"}.ipa`,
          notFound,
        });
      }

      const sessionMatch'''
)

replace_regex(
    "mac-helper/bin/swift-sim-helper.js",
    r'''      const devicePageMatch = url\.pathname\.match\(.*?\n      \}\n\n      if \(req\.method === "GET" && url\.pathname === "/pair"\)''',
    '''      const devicePageMatch = url.pathname.match(/^\\/d\\/([^/]+)$/);
      if (devicePageMatch && req.method === "GET") {
        const build = deviceBuildStore.get(devicePageMatch[1]);
        if (!build) return notFound(res, "Unknown device build.");
        const capabilityBuild = buildForCapabilityToken(build, url.searchParams.get("token"));
        if (!capabilityBuild) return unauthorized(res);
        if (deviceBuildExpired(capabilityBuild)) {
          return badRequest(res, 410, "Device build install page expired. Create a fresh build.");
        }
        const responseBuild = capabilityBuild.remoteBaseUrl
          ? capabilityBuild
          : { ...capabilityBuild, remoteBaseUrl: `${url.protocol}//${url.host}` };
        return text(res, 200, deviceBuildFallbackHtml(responseBuild), "text/html; charset=utf-8", {
          "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        });
      }

      if (req.method === "GET" && url.pathname === "/pair")'''
)

replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    'async function prepareDeviceDelivery(build, { markBuildFailed = true } = {}) {\n  let startedGeneration = "";\n  let reusedGeneration = true;',
    'async function prepareDeviceDelivery(build, { markBuildFailed = true } = {}) {\n  let startedGeneration = "";\n  let deliveryReferenceID = "";'
)
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''    const delivery = await deviceDelivery.ensure({
      ttlMinutes,
      cancelPath: build.control?.cancelPath || "",
    });
    startedGeneration = delivery.generation || "";
    reusedGeneration = delivery.reused === true;''',
    '''    deliveryReferenceID = build.pendingRenewal?.id
      ? `renewal:${build.pendingRenewal.id}`
      : build.delivery?.referenceID || `build:${build.id}`;
    const delivery = await deviceDelivery.ensure({
      ttlMinutes,
      cancelPath: build.control?.cancelPath || "",
      referenceID: deliveryReferenceID,
    });
    startedGeneration = delivery.generation || "";'''
)
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''    build.delivery = {
      mode: "quick-tunnel",
      provider: delivery.provider,
      expiresAt: delivery.expiresAt,
    };''',
    '''    build.delivery = {
      mode: "quick-tunnel",
      provider: delivery.provider,
      expiresAt: delivery.expiresAt,
      generation: delivery.generation || "",
      referenceID: deliveryReferenceID,
    };'''
)
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''  } catch (error) {
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") {
      if (startedGeneration && !reusedGeneration) {
        try { deviceDelivery.stopGeneration(startedGeneration); } catch {}
      }
      throw error;
    }
    if (markBuildFailed) build.state = "failed";
    build.logs.push(error instanceof Error ? error.message : String(error));
    deviceBuildStore.save(build);
    throw error;
  }''',
    '''  } catch (error) {
    if (startedGeneration && deliveryReferenceID) {
      try { deviceDelivery.stopGeneration(startedGeneration, { referenceID: deliveryReferenceID }); } catch {}
    }
    if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") throw error;
    if (markBuildFailed) build.state = "failed";
    build.logs.push(error instanceof Error ? error.message : String(error));
    try { deviceBuildStore.save(build); } catch {}
    throw error;
  }'''
)

replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''  const server = createServer(async (req, res) => {
    try {''',
    '''  const activeSockets = new Set();
  const server = createServer(async (req, res) => {
    try {'''
)
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''  });

  await new Promise((resolve, reject) => {''',
    '''  });
  server.on("connection", (socket) => {
    activeSockets.add(socket);
    socket.once("close", () => activeSockets.delete(socket));
  });

  await new Promise((resolve, reject) => {'''
)

replace_regex(
    "mac-helper/bin/swift-sim-helper.js",
    r'''  let reconciliationTimer;.*?  await new Promise\(\(\) => \{\}\);''',
    '''  const scheduleReconciliation = () => {
    void reconcileRequestedDeviceBuilds().catch((error) => {
      console.error(`Device installation reconciliation failed: ${error instanceof Error ? error.message : String(error)}`);
    });
  };
  let reconciliationTimer;
  if (!deviceBuildsOnly) {
    scheduleReconciliation();
    reconciliationTimer = setInterval(scheduleReconciliation, 15_000);
  }

  const keepAlive = setInterval(() => {}, 60 * 60 * 1000);
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (reconciliationTimer) clearInterval(reconciliationTimer);
    clearInterval(keepAlive);
    server.closeIdleConnections?.();
    let serverClosed = false;
    let sessionsStopped = false;
    const maybeExit = () => {
      if (serverClosed && sessionsStopped) process.exit(0);
    };
    server.close(() => {
      serverClosed = true;
      maybeExit();
    });
    const sessions = typeof store.list === "function" ? store.list() : [];
    void Promise.allSettled(sessions.map((session) => stopSession(session.id))).finally(() => {
      sessionsStopped = true;
      maybeExit();
    });
    const closeTimer = setTimeout(() => {
      for (const socket of activeSockets) socket.destroy();
      server.closeAllConnections?.();
    }, 1_000);
    closeTimer.unref?.();
    const forceTimer = setTimeout(() => process.exit(0), 5_000);
    forceTimer.unref?.();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await new Promise(() => {});'''
)

replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''    for (const build of requested) {
      const verification = await verifyDeviceBuild(build);
      if (verification.state === "verified") {
        deviceBuildStore.saveVerification(build.id, verification);
      }
    }''',
    '''    for (const build of requested) {
      try {
        const verification = await verifyDeviceBuild(build);
        deviceBuildStore.saveVerification(build.id, verification);
      } catch (error) {
        deviceBuildStore.saveVerification(build.id, {
          state: "unknown",
          verifiedAt: new Date().toISOString(),
          devices: [],
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }'''
)

helper_functions = r'''
function buildForCapabilityToken(build, token) {
  if (!token) return null;
  if (secretsMatch(build.token, token)) return build;
  const capability = (Array.isArray(build.capabilities) ? build.capabilities : [])
    .find((candidate) => secretsMatch(candidate?.token, token));
  return capability ? projectCapability(build, capability) : null;
}

function projectCapability(build, capability) {
  return {
    ...build,
    token: capability.token,
    expiresAt: capability.expiresAt,
    remoteBaseUrl: capability.remoteBaseUrl || "",
    delivery: capability.delivery ? structuredClone(capability.delivery) : null,
    installTTLMinutes: capability.installTTLMinutes || build.installTTLMinutes,
  };
}

function secretsMatch(expectedValue, actualValue) {
  if (!expectedValue || !actualValue) return false;
  const expected = Buffer.from(String(expectedValue));
  const actual = Buffer.from(String(actualValue));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function releaseAppDeliveryReferences(app) {
  for (const build of app.builds || []) {
    const deliveries = [build.delivery, ...(build.capabilities || []).map((capability) => capability.delivery)];
    for (const delivery of deliveries) {
      if (!delivery?.generation || !delivery?.referenceID) continue;
      try {
        deviceDelivery.stopGeneration(delivery.generation, { referenceID: delivery.referenceID });
      } catch {}
    }
  }
}
'''
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '\nfunction ensureToken(session, token) {',
    '\n' + helper_functions + '\nfunction ensureToken(session, token) {'
)
replace_once(
    "mac-helper/bin/swift-sim-helper.js",
    '''function tokenMatches(session, token) {
  if (!token || !session.token) return false;
  const expected = Buffer.from(String(session.token));
  const actual = Buffer.from(String(token));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}''',
    '''function tokenMatches(session, token) {
  return secretsMatch(session?.token, token);
}'''
)

# ---------------------------------------------------------------------------
# Process runner: one terminal transition, callback failure fencing, and
# streaming build-settings parsing.
# ---------------------------------------------------------------------------
replace_once(
    "mac-helper/src/deviceBuilderCore.js",
    '''  const result = await runBuffered("xcodebuild", [
    ...targetArgs(target),
    "-scheme", required(scheme, "scheme"),
    "-configuration", configuration || "Release",
    ...buildSettingArgs,
    "-destination", "generic/platform=iOS",
    ...(allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
    "-showBuildSettings",
  ], { cancelPath: build?.control?.cancelPath || "" });
  if (result.cancellationError) throw result.cancellationError;
  if (result.code !== 0) {
    throw new DeviceBuildError(result.error || result.stderr || result.stdout || "Unable to read Xcode build settings.");
  }
  return parseBuildSettings(result.stdout);''',
    '''  const settings = {};
  const result = await runBuffered("xcodebuild", [
    ...targetArgs(target),
    "-scheme", required(scheme, "scheme"),
    "-configuration", configuration || "Release",
    ...buildSettingArgs,
    "-destination", "generic/platform=iOS",
    ...(allowProvisioningUpdates ? ["-allowProvisioningUpdates"] : []),
    "-showBuildSettings",
  ], {
    cancelPath: build?.control?.cancelPath || "",
    onLine: (line) => parseBuildSettingLine(settings, line),
  });
  if (result.cancellationError) throw result.cancellationError;
  if (result.code !== 0) {
    throw new DeviceBuildError(result.error || result.stderr || result.stdout || "Unable to read Xcode build settings.");
  }
  return settings;'''
)
replace_once(
    "mac-helper/src/deviceBuilderCore.js",
    '''function parseBuildSettings(output) {
  const settings = {};
  for (const line of output.split(/\\r?\\n/)) {
    const match = line.match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)$/);
    if (match) settings[match[1]] = match[2].trim();
  }
  return settings;
}''',
    '''function parseBuildSettings(output) {
  const settings = {};
  for (const line of output.split(/\\r?\\n/)) parseBuildSettingLine(settings, line);
  return settings;
}

function parseBuildSettingLine(settings, line) {
  const match = String(line || "").match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)$/);
  if (match) settings[match[1]] = match[2].trim();
}'''
)
replace_regex(
    "mac-helper/src/deviceBuilderCore.js",
    r'''export function runBuffered\(command, args, \{.*?\n\}\n\nasync function terminateProcessGroup''',
    '''export function runBuffered(command, args, {
  onLine,
  timeoutMs = 120_000,
  env = process.env,
  cancelPath = "",
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      env,
      detached: true,
    });
    let stdout = "";
    let stderr = "";
    let stdoutPending = "";
    let stderrPending = "";
    let settled = false;
    let terminating = false;
    let cancellationTimer;

    const invokeLine = (line) => {
      if (!line.trim() || !onLine) return null;
      try {
        onLine(line);
        return null;
      } catch (error) {
        return error;
      }
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancellationTimer);
      resolve(result);
    };

    const terminateOnce = (resultFactory) => {
      if (settled || terminating) return;
      terminating = true;
      clearInterval(cancellationTimer);
      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        finish(resultFactory(terminated));
      });
    };

    const outputCallbackFailed = (error) => {
      terminateOnce((terminated) => ({
        code: null,
        stdout,
        stderr,
        error: `Output handler failed: ${error instanceof Error ? error.message : String(error)}${terminated ? "" : "; process group could not be confirmed stopped"}`,
      }));
    };

    const flushLines = (chunk, isError) => {
      const value = chunk.toString("utf8");
      const combined = (isError ? stderrPending : stdoutPending) + value;
      const lines = combined.split(/\\r?\\n/);
      const pending = lines.pop() || "";
      if (isError) stderrPending = pending;
      else stdoutPending = pending;
      for (const line of lines) {
        const error = invokeLine(line);
        if (error) {
          outputCallbackFailed(error);
          return;
        }
      }
    };

    if (cancelPath) {
      cancellationTimer = setInterval(() => {
        if (!existsSync(cancelPath) || settled || terminating) return;
        terminateOnce(() => {
          const error = new DeviceBuildError("Device build was cancelled.");
          error.code = "SWIFT_SIM_BUILD_CANCELLED";
          return { code: null, stdout, stderr, error: error.message, cancellationError: error };
        });
      }, 100);
      cancellationTimer.unref?.();
    }

    const timer = setTimeout(() => {
      if (settled || terminating) return;
      terminateOnce((terminated) => ({
        code: null,
        stdout,
        stderr,
        error: terminated
          ? `${command} timed out`
          : `${command} timed out and its process group could not be confirmed stopped`,
      }));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (settled || terminating) return;
      stdout = appendBoundedOutput(stdout, chunk.toString("utf8"));
      flushLines(chunk, false);
    });
    child.stderr.on("data", (chunk) => {
      if (settled || terminating) return;
      stderr = appendBoundedOutput(stderr, chunk.toString("utf8"));
      flushLines(chunk, true);
    });
    child.on("error", (error) => {
      if (terminating) return;
      finish({ code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      if (terminating || settled) return;
      const pendingError = invokeLine(stdoutPending) || invokeLine(stderrPending);
      if (pendingError) {
        outputCallbackFailed(pendingError);
        return;
      }
      finish({ code, stdout, stderr, error: code === 0 ? "" : (stderr || stdout) });
    });
  });
}

async function terminateProcessGroup'''
)

# ---------------------------------------------------------------------------
# iPhone client: Mac-bound mutations and per-app rollback generations.
# ---------------------------------------------------------------------------
replace_once(
    "Companion/SwiftSimCompanion/SessionStore.swift",
    '    private var managedAppsRevision: UInt64 = 0\n',
    '    private var managedAppsRevision: UInt64 = 0\n    private var managedAppOperationRevisions: [String: UInt64] = [:]\n'
)
replace_regex(
    "Companion/SwiftSimCompanion/SessionStore.swift",
    r'''    func archiveManagedApp\(_ app: ManagedApp, archived: Bool\) \{.*?\n    \}\n\n    func deleteManagedApp\(_ app: ManagedApp\) \{.*?\n    \}''',
    '''    func archiveManagedApp(_ app: ManagedApp, archived: Bool) {
        guard let index = managedApps.firstIndex(where: { $0.id == app.id }) else { return }
        managedAppsRevision &+= 1
        let operationRevision = nextManagedAppOperationRevision(app.id)
        let expectedMac = pairedMac
        let expectedPairingRevision = pairingRevision
        managedApps[index] = managedApps[index].settingArchived(archived)
        selectedManagedAppID = nil
        sortAndSaveManagedApps()
        libraryActionMessage = nil
        Task {
            guard await syncArchiveToMac(
                appID: app.id,
                archived: archived,
                expectedMac: expectedMac,
                expectedPairingRevision: expectedPairingRevision
            ) == false else { return }
            guard Self.appOperationIsCurrent(
                currentRevision: managedAppOperationRevisions[app.id],
                expectedRevision: operationRevision
            ) else { return }
            if let index = managedApps.firstIndex(where: { $0.id == app.id }) {
                managedApps[index] = app
            } else {
                managedApps.append(app)
            }
            sortAndSaveManagedApps()
            libraryActionMessage = "Could not update your Mac. The app was restored here."
        }
    }

    func deleteManagedApp(_ app: ManagedApp) {
        managedAppsRevision &+= 1
        let operationRevision = nextManagedAppOperationRevision(app.id)
        let expectedMac = pairedMac
        let expectedPairingRevision = pairingRevision
        managedApps.removeAll { $0.id == app.id }
        if selectedManagedAppID == app.id {
            selectedManagedAppID = nil
        }
        saveManagedApps()
        libraryActionMessage = nil
        Task {
            guard await syncDeleteToMac(
                appID: app.id,
                expectedMac: expectedMac,
                expectedPairingRevision: expectedPairingRevision
            ) == false else { return }
            guard Self.appOperationIsCurrent(
                currentRevision: managedAppOperationRevisions[app.id],
                expectedRevision: operationRevision
            ) else { return }
            if !managedApps.contains(where: { $0.id == app.id }) {
                managedApps.append(app)
                sortAndSaveManagedApps()
            }
            libraryActionMessage = "Could not delete this history from your Mac. It was restored here."
        }
    }'''
)

replace_regex(
    "Companion/SwiftSimCompanion/SessionStore.swift",
    r'''    private func syncArchiveToMac\(appID: String, archived: Bool\) async -> Bool \{.*?\n    \}\n\n    private func syncDeleteToMac\(appID: String\) async -> Bool \{.*?\n    \}''',
    '''    private func syncArchiveToMac(
        appID: String,
        archived: Bool,
        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedMac,
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        var request = URLRequest(url: expectedMac.appArchiveURL(appID))
        request.httpMethod = "POST"
        request.timeoutInterval = 10
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = try? JSONEncoder().encode(["archived": archived])
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    private func syncDeleteToMac(
        appID: String,
        expectedMac: PairedMac?,
        expectedPairingRevision: UInt64
    ) async -> Bool {
        guard !appID.hasPrefix("local:"), !appID.hasPrefix("pending:") else { return true }
        guard let expectedMac,
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        var request = URLRequest(url: expectedMac.appURL(appID))
        request.httpMethod = "DELETE"
        request.timeoutInterval = 10
        guard let (_, response) = try? await URLSession.shared.data(for: request),
              Self.pairingResponseIsCurrent(
                current: pairedMac,
                expected: expectedMac,
                currentRevision: pairingRevision,
                expectedRevision: expectedPairingRevision
              ) else { return false }
        let status = (response as? HTTPURLResponse)?.statusCode
        return status == 200 || status == 404
    }'''
)

client_helpers = r'''
    private func nextManagedAppOperationRevision(_ appID: String) -> UInt64 {
        let next = (managedAppOperationRevisions[appID] ?? 0) &+ 1
        managedAppOperationRevisions[appID] = next
        return next
    }

    static func appOperationIsCurrent(currentRevision: UInt64?, expectedRevision: UInt64) -> Bool {
        currentRevision == expectedRevision
    }
'''
replace_once(
    "Companion/SwiftSimCompanion/SessionStore.swift",
    '\n    private static func parseDate(_ value: String) -> Date? {',
    '\n' + client_helpers + '\n    private static func parseDate(_ value: String) -> Date? {'
)

# ---------------------------------------------------------------------------
# Pairing staging keeps both old and new transaction pointers until resolution.
# ---------------------------------------------------------------------------
replace_once(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    '''    private static let pendingAccountKey = "pairedMacPendingCredentialAccount"
    private static let pendingPairingIDKey = "pairedMacPendingPairingID"''',
    '''    private static let pendingAccountKey = "pairedMacPendingCredentialAccount"
    private static let pendingPairingIDKey = "pairedMacPendingPairingID"
    private static let previousPendingAccountKey = "pairedMacPreviousPendingCredentialAccount"
    private static let previousPendingPairingIDKey = "pairedMacPreviousPendingPairingID"'''
)
replace_regex(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    r'''    static func stagePairing\(token: String, pairingID: String\) -> Bool \{.*?\n    \}\n\n    static func cancelStagedPairing''',
    '''    static func stagePairing(token: String, pairingID: String) -> Bool {
        guard !token.isEmpty else { return false }
        let stagedAccount = stagingAccount(for: pairingID)
        let defaults = UserDefaults.standard
        let previousPending = defaults.string(forKey: pendingAccountKey)
        let previousPairingID = defaults.string(forKey: pendingPairingIDKey)

        if let previousPending {
            defaults.set(previousPending, forKey: previousPendingAccountKey)
        } else {
            defaults.removeObject(forKey: previousPendingAccountKey)
        }
        if let previousPairingID {
            defaults.set(previousPairingID, forKey: previousPendingPairingIDKey)
        } else {
            defaults.removeObject(forKey: previousPendingPairingIDKey)
        }
        defaults.set(stagedAccount, forKey: pendingAccountKey)
        defaults.set(pairingID, forKey: pendingPairingIDKey)
        defaults.synchronize()
        guard storeToken(token, account: stagedAccount) else {
            deleteToken(account: stagedAccount)
            restorePreviousPendingTransaction()
            return false
        }
        if let previousPending, previousPending != stagedAccount {
            deleteToken(account: previousPending)
        }
        clearPreviousPendingTransaction()
        return true
    }

    static func cancelStagedPairing'''
)
replace_regex(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    r'''    static func cancelStagedPairing\(pairingID: String\) \{.*?\n    \}\n\n    static func tokenForDecoding''',
    '''    static func cancelStagedPairing(pairingID: String) {
        let defaults = UserDefaults.standard
        guard defaults.string(forKey: pendingPairingIDKey) == pairingID,
              let stagedAccount = defaults.string(forKey: pendingAccountKey) else { return }
        if defaults.string(forKey: committedAccountKey) != stagedAccount {
            deleteToken(account: stagedAccount)
        }
        restorePreviousPendingTransaction()
    }

    static func tokenForDecoding'''
)
replace_once(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    '''        if pendingAccount != nil {
            defaults.removeObject(forKey: pendingAccountKey)
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
    }''',
    '''        if pendingAccount != nil {
            defaults.removeObject(forKey: pendingAccountKey)
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
        if let previous = defaults.string(forKey: previousPendingAccountKey), previous != currentAccount {
            deleteToken(account: previous)
        }
        clearPreviousPendingTransaction()
    }'''
)
replace_once(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    '''        deleteToken(account: pendingAccount)
        defaults.removeObject(forKey: pendingAccountKey)
        defaults.removeObject(forKey: pendingPairingIDKey)
    }''',
    '''        deleteToken(account: pendingAccount)
        if let previous = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previous)
        }
        defaults.removeObject(forKey: pendingAccountKey)
        defaults.removeObject(forKey: pendingPairingIDKey)
        clearPreviousPendingTransaction()
    }'''
)
replace_once(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    '''        if let pendingAccount = defaults.string(forKey: pendingAccountKey) {
            deleteToken(account: pendingAccount)
        }
        deleteToken(account: legacyAccount)''',
    '''        if let pendingAccount = defaults.string(forKey: pendingAccountKey) {
            deleteToken(account: pendingAccount)
        }
        if let previousPendingAccount = defaults.string(forKey: previousPendingAccountKey) {
            deleteToken(account: previousPendingAccount)
        }
        deleteToken(account: legacyAccount)'''
)
replace_once(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    '''        if defaults.object(forKey: pendingPairingIDKey) != nil {
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
    }''',
    '''        if defaults.object(forKey: pendingPairingIDKey) != nil {
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
        clearPreviousPendingTransaction()
    }'''
)

pairing_helpers = r'''
    private static func restorePreviousPendingTransaction() {
        let defaults = UserDefaults.standard
        if let previousAccount = defaults.string(forKey: previousPendingAccountKey) {
            defaults.set(previousAccount, forKey: pendingAccountKey)
        } else {
            defaults.removeObject(forKey: pendingAccountKey)
        }
        if let previousPairingID = defaults.string(forKey: previousPendingPairingIDKey) {
            defaults.set(previousPairingID, forKey: pendingPairingIDKey)
        } else {
            defaults.removeObject(forKey: pendingPairingIDKey)
        }
        clearPreviousPendingTransaction()
    }

    private static func clearPreviousPendingTransaction() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: previousPendingAccountKey)
        defaults.removeObject(forKey: previousPendingPairingIDKey)
    }
'''
replace_once(
    "Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift",
    '\n    private static func marker(for account: String) -> String {',
    '\n' + pairing_helpers + '\n    private static func marker(for account: String) -> String {'
)

# ---------------------------------------------------------------------------
# Regression tests.
# ---------------------------------------------------------------------------
append_text(
    "test/deviceBuildStore.test.js",
    r'''
test("renewal retains the previous bearer capability until its own expiry", () => withStore((store) => {
  const build = completeBuild(store, "Example", "com.example.app", "TEAM123", "1.0", "1");
  build.remoteBaseUrl = "https://old-link.example.com";
  build.expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
  build.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: new Date(Date.now() + 40 * 60_000).toISOString(),
    generation: "old-generation",
    referenceID: `build:${build.id}`,
  };
  store.save(build);
  const oldToken = build.token;
  const renewed = store.renewInstallLink(build.id, { ttlMinutes: 60 });
  renewed.remoteBaseUrl = "https://new-link.example.com";
  renewed.expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
  renewed.delivery = {
    mode: "quick-tunnel",
    provider: "cloudflare-quick-tunnel",
    expiresAt: new Date(Date.now() + 70 * 60_000).toISOString(),
    generation: "new-generation",
    referenceID: `renewal:${renewed.pendingRenewal.id}`,
  };
  store.save(renewed);
  const committed = store.get(build.id);
  const oldCapability = committed.capabilities.find((capability) => capability.token === oldToken);
  assert.ok(oldCapability);
  assert.equal(oldCapability.remoteBaseUrl, "https://old-link.example.com");
  assert.equal(oldCapability.delivery.generation, "old-generation");
  assert.notEqual(committed.token, oldToken);
}));
'''
)

append_text(
    "test/deviceDelivery.test.js",
    r'''
test("releasing one reference cannot stop a generation still used by another capability", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-delivery-reference-test-"));
  try {
    const statePath = join(directory, "device-delivery.json");
    const generation = "shared-generation";
    const generationPath = deliveryGenerationStatePath(statePath, generation);
    writeFileSync(generationPath, JSON.stringify({
      generation,
      status: "ready",
      publicBaseUrl: "https://shared.trycloudflare.com",
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      references: ["build:first", "build:second"],
    }));
    const adapter = new DeviceDeliveryAdapter({ statePath, logPath: join(directory, "delivery.log") });
    assert.equal(adapter.stopGeneration(generation, { referenceID: "build:first" }), true);
    const preserved = JSON.parse(readFileSync(generationPath, "utf8"));
    assert.deepEqual(preserved.references, ["build:second"]);
    assert.equal(existsSync(generationPath), true);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
)

append_text(
    "test/deviceBuilderTimeout.test.js",
    r'''
test("an output callback failure terminates the detached process group", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-callback-failure-test-"));
  const pidPath = join(directory, "callback-descendant.pid");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      console.log("trigger");
      setInterval(() => {}, 1000);
    `;
    const result = await runBuffered(process.execPath, ["-e", fixture], {
      timeoutMs: 8_000,
      onLine: () => { throw new Error("state write failed"); },
    });
    assert.match(result.error, /Output handler failed: state write failed/);
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
'''
)

append_text(
    "Companion/SwiftSimCompanionTests/InstallationStateTests.swift",
    r'''
extension InstallationStateTests {
    @MainActor
    func testManagedAppOperationRevisionIsScopedPerApp() {
        XCTAssertTrue(SessionStore.appOperationIsCurrent(currentRevision: 2, expectedRevision: 2))
        XCTAssertFalse(SessionStore.appOperationIsCurrent(currentRevision: 1, expectedRevision: 2))
        XCTAssertFalse(SessionStore.appOperationIsCurrent(currentRevision: nil, expectedRevision: 1))
    }

    @MainActor
    func testCancellingSecondStagedPairingRestoresFirstTransaction() throws {
        let defaults = UserDefaults.standard
        let firstID = "https://first-pending-\(UUID().uuidString).example"
        let secondID = "https://second-pending-\(UUID().uuidString).example"
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "first-\(UUID().uuidString)", pairingID: firstID))
        let firstAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        XCTAssertTrue(PairingCredentialVault.stagePairing(token: "second-\(UUID().uuidString)", pairingID: secondID))
        let secondAccount = try XCTUnwrap(defaults.string(forKey: "pairedMacPendingCredentialAccount"))
        PairingCredentialVault.cancelStagedPairing(pairingID: secondID)
        defer {
            PairingCredentialVault.cancelStagedPairing(pairingID: firstID)
            deleteTestToken(account: firstAccount)
            deleteTestToken(account: secondAccount)
            defaults.removeObject(forKey: "pairedMacPreviousPendingCredentialAccount")
            defaults.removeObject(forKey: "pairedMacPreviousPendingPairingID")
        }
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingCredentialAccount"), firstAccount)
        XCTAssertEqual(defaults.string(forKey: "pairedMacPendingPairingID"), firstID)
        XCTAssertEqual(testTokenStatus(account: firstAccount), errSecSuccess)
        XCTAssertEqual(testTokenStatus(account: secondAccount), errSecItemNotFound)
    }
}
'''
)

print("round3 fixes applied")
