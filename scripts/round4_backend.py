#!/usr/bin/env python3
from pathlib import Path
import re

def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f"Missing anchor: {label}")
    return text.replace(old, new, 1)

def regex_once(text, pattern, replacement, label):
    next_text, count = re.subn(pattern, lambda _m: replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"Expected one match for {label}, got {count}")
    return next_text

path = Path("mac-helper/src/buildValidation.js")
text = path.read_text()
text = replace_once(text,
    'import { spawn } from "node:child_process";\n',
    'import { spawn, spawnSync } from "node:child_process";\n',
    "validation spawn import")
text = replace_once(text,
    'import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";\n',
    'import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";\n',
    "validation fs import")
text = replace_once(text,
    '''    let settled = false;
    let terminating = false;
    let cancellationTimer;
''',
    '''    let settled = false;
    let terminating = false;
    let cancellationTimer;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
      writeFileSync(workerPath, JSON.stringify({
        pid: child.pid,
        startedAt: requiredProcessStartedAt(child.pid),
        command: "required-validation",
        createdAt: new Date().toISOString(),
      }), { mode: 0o600 });
    }
''',
    "validation worker record")
text = replace_once(text,
    '''    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearInterval(cancellationTimer);
      if (error) reject(error);
      else resolvePromise();
    };
''',
    '''    const finish = (error, preserveWorkerRecord = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearInterval(cancellationTimer);
      if (workerPath && !preserveWorkerRecord) rmSync(workerPath, { force: true });
      if (error) reject(error);
      else resolvePromise();
    };
''',
    "validation finish")
text = replace_once(text,
    '''      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        if (!terminated) {
          error.message += " Its process group could not be confirmed stopped.";
        }
        finish(error);
      });
''',
    '''      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        if (!terminated) {
          error.message += " Its process group could not be confirmed stopped.";
        }
        finish(error, !terminated);
      });
''',
    "validation terminate result")
text = regex_once(text,
    r'''    child\.once\("exit", \(code, signal\) => \{.*?\n    \}\);\n''',
    '''    child.once("exit", (code, signal) => {
      if (terminating) return;
      terminating = true;
      void (async () => {
        const exited = await waitForProcessGroupExit(child.pid, 500);
        if (code === 0 && exited) {
          terminating = false;
          finish();
          return;
        }
        const terminated = exited || await terminateProcessGroup(child.pid, 2_000);
        const error = code === 0
          ? validationError("Required validation exited successfully while descendant processes were still running; device build cancelled.")
          : validationError(
              `Required validation failed with ${signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`}; device build cancelled.`,
              code || 1
            );
        if (!terminated) error.message += " Its process group could not be confirmed stopped.";
        finish(error, !terminated);
      })();
    });
''',
    "validation exit fencing")
text = replace_once(text,
    '''function signalProcessGroup(pid, signal) {
''',
    '''function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
    const startedAt = result.status === 0 ? String(result.stdout || "").trim() : "";
    if (startedAt) return startedAt;
  }
  return "";
}

function signalProcessGroup(pid, signal) {
''',
    "validation identity helper")
path.write_text(text)

path = Path("mac-helper/src/deviceBuilderCore.js")
text = path.read_text()
text = replace_once(text,
    'import { basename, extname, join } from "node:path";\n',
    'import { basename, dirname, extname, join } from "node:path";\n',
    "builder dirname import")
text = replace_once(text,
    '''async function readBuildSettings({ target, scheme, configuration, allowProvisioningUpdates, buildSettingArgs, build }) {
  const settings = {};
''',
    '''async function readBuildSettings({ target, scheme, configuration, allowProvisioningUpdates, buildSettingArgs, build }) {
  const collector = createBuildSettingsCollector();
''',
    "settings collector")
text = replace_once(text,
    '''    onLine: (line) => parseBuildSettingLine(settings, line),
''',
    '''    onLine: (line) => collectBuildSettingLine(collector, line),
''',
    "settings line callback")
text = replace_once(text,
    '''  return settings;
}

function xcodeBuildSettingArgs''',
    '''  return selectApplicationBuildSettings(collector, scheme);
}

function xcodeBuildSettingArgs''',
    "settings return")
text = regex_once(text,
    r'''function parseBuildSettings\(output\) \{.*?\n\}\n\nfunction parseBuildSettingLine\(settings, line\) \{.*?\n\}\n''',
    '''export function parseBuildSettings(output, scheme = "") {
  const collector = createBuildSettingsCollector();
  for (const line of String(output || "").split(/\\r?\\n/)) collectBuildSettingLine(collector, line);
  return selectApplicationBuildSettings(collector, scheme);
}

function createBuildSettingsCollector() {
  return { sections: [], current: null, loose: {} };
}

function collectBuildSettingLine(collector, line) {
  const header = String(line || "").match(/^Build settings for action .* and target (.+):\\s*$/);
  if (header) {
    const section = { target: header[1].trim(), settings: {} };
    collector.sections.push(section);
    collector.current = section;
    return;
  }
  const match = String(line || "").match(/^\\s*([A-Z0-9_]+)\\s*=\\s*(.*)$/);
  if (!match) return;
  const destination = collector.current?.settings || collector.loose;
  destination[match[1]] = match[2].trim();
}

function selectApplicationBuildSettings(collector, scheme = "") {
  const applicationSections = collector.sections.filter(({ settings }) =>
    settings.WRAPPER_EXTENSION === "app"
    && !String(settings.PRODUCT_TYPE || "").includes("app-extension")
  );
  const normalizedScheme = String(scheme || "").trim();
  const exact = applicationSections.find(({ target, settings }) =>
    target === normalizedScheme
    || settings.TARGET_NAME === normalizedScheme
    || settings.PRODUCT_NAME === normalizedScheme
  );
  const selected = exact || (applicationSections.length === 1 ? applicationSections[0] : null);
  if (selected) return selected.settings;
  if (applicationSections.length > 1) {
    throw new DeviceBuildError(`Xcode reported multiple application targets for scheme ${normalizedScheme || "(unknown)"}.`);
  }
  if (Object.keys(collector.loose).length > 0 && collector.loose.WRAPPER_EXTENSION === "app") {
    return collector.loose;
  }
  throw new DeviceBuildError(`Xcode did not report an application target for scheme ${normalizedScheme || "(unknown)"}.`);
}
''',
    "target-aware parser")
text = replace_once(text,
    '''    let cancellationTimer;

    const invokeLine''',
    '''    let cancellationTimer;
    const workerPath = cancelPath ? `${cancelPath}.worker.json` : "";
    if (workerPath) {
      mkdirSync(dirname(workerPath), { recursive: true, mode: 0o700 });
      writeFileSync(workerPath, JSON.stringify({
        pid: child.pid,
        startedAt: requiredProcessStartedAt(child.pid),
        command,
        createdAt: new Date().toISOString(),
      }), { mode: 0o600 });
    }

    const invokeLine''',
    "builder worker record")
text = replace_once(text,
    '''    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancellationTimer);
      resolve(result);
    };
''',
    '''    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(cancellationTimer);
      if (workerPath && !result?.preserveWorkerRecord) rmSync(workerPath, { force: true });
      resolve(result);
    };
''',
    "builder finish")
text = replace_once(text,
    '''      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        finish(resultFactory(terminated));
      });
''',
    '''      void terminateProcessGroup(child.pid, 2_000).then((terminated) => {
        finish({ ...resultFactory(terminated), preserveWorkerRecord: !terminated });
      });
''',
    "builder terminate result")
text = replace_once(text,
    '''        terminateOnce(() => {
          const error = new DeviceBuildError("Device build was cancelled.");
''',
    '''        terminateOnce((_terminated) => {
          const error = new DeviceBuildError("Device build was cancelled.");
''',
    "builder cancellation factory")
text = replace_once(text,
    '''function signalProcessGroup(pid, signal) {
''',
    '''export function requestDeviceBuildCancellation(build, reason = "Device build cancelled.") {
  const cancelPath = build?.control?.cancelPath || "";
  if (!cancelPath) return false;
  mkdirSync(dirname(cancelPath), { recursive: true, mode: 0o700 });
  writeFileSync(cancelPath, JSON.stringify({
    buildId: build.id,
    reason,
    cancelledAt: new Date().toISOString(),
  }), { mode: 0o600 });
  return true;
}

export async function terminateRecordedDeviceBuildWorker(build) {
  const workerPath = build?.control?.cancelPath ? `${build.control.cancelPath}.worker.json` : "";
  if (!workerPath || !existsSync(workerPath)) return true;
  let record;
  try { record = JSON.parse(readFileSync(workerPath, "utf8")); } catch { return false; }
  const pid = Number(record?.pid);
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (record.startedAt && processStartedAt(pid) !== record.startedAt) {
    rmSync(workerPath, { force: true });
    return true;
  }
  const terminated = await terminateProcessGroup(pid, 2_000);
  if (terminated) rmSync(workerPath, { force: true });
  return terminated;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startedAt = processStartedAt(pid);
    if (startedAt) return startedAt;
  }
  return "";
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], { encoding: "utf8" });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function signalProcessGroup(pid, signal) {
''',
    "builder recovery exports")
path.write_text(text)

path = Path("mac-helper/bin/swift-sim-helper.js")
text = path.read_text()
text = replace_once(text,
    '''  publicDeviceBuild,
  runDeviceBuild,
} from "../src/deviceBuilder.js";
''',
    '''  publicDeviceBuild,
  requestDeviceBuildCancellation,
  runDeviceBuild,
  terminateRecordedDeviceBuildWorker,
} from "../src/deviceBuilder.js";
''',
    "helper builder imports")
text = replace_once(text,
    '''const transports = {
''',
    '''const activeDeviceBuildTasks = new Map();
let deliveryReferenceCleanupRunning = false;

const transports = {
''',
    "helper task globals")
text = replace_once(text,
    '''    const deleted = deviceBuildStore.deleteApp(appID, { deleteArtifacts: !values["keep-artifacts"] });
    if (!deleted) throw new Error("Unknown app id.");
''',
    '''    const deleted = deviceBuildStore.deleteApp(appID, { deleteArtifacts: !values["keep-artifacts"] });
    if (!deleted) throw new Error("Unknown app id.");
    await drainDeliveryReferenceCleanupJobs();
''',
    "cli durable cleanup")
text = replace_once(text,
    '''async function serve({ host, port, deviceBuildsOnly = false }) {
  const activeSockets = new Set();
''',
    '''async function serve({ host, port, deviceBuildsOnly = false }) {
  await recoverInterruptedDeviceBuilds();
  await drainDeliveryReferenceCleanupJobs();
  const activeSockets = new Set();
''',
    "serve startup recovery")
text = replace_once(text,
    '''          const appBeforeDeletion = deviceBuildStore.getApp(appID);
          const deleted = deviceBuildStore.deleteApp(appID, {
            deleteArtifacts: url.searchParams.get("keepArtifacts") !== "true",
          });
          if (deleted && appBeforeDeletion) releaseAppDeliveryReferences(appBeforeDeletion);
''',
    '''          const deleted = deviceBuildStore.deleteApp(appID, {
            deleteArtifacts: url.searchParams.get("keepArtifacts") !== "true",
          });
          if (deleted) void drainDeliveryReferenceCleanupJobs();
''',
    "route durable cleanup")
text = replace_once(text,
    '''        runDeviceBuild(build, { save: (next) => deviceBuildStore.save(next) })
          .then(() => {
            build.state = "delivering";
            deviceBuildStore.save(build);
            return prepareDeviceDelivery(build);
          })
          .catch(() => {});
''',
    '''        startManagedDeviceBuild(build);
''',
    "managed route build")
text = replace_once(text,
    '''  let reconciliationTimer;
  if (!deviceBuildsOnly) {
    scheduleReconciliation();
    reconciliationTimer = setInterval(scheduleReconciliation, 15_000);
  }
''',
    '''  let reconciliationTimer;
  let deliveryCleanupTimer;
  if (!deviceBuildsOnly) {
    scheduleReconciliation();
    reconciliationTimer = setInterval(scheduleReconciliation, 15_000);
  }
  deliveryCleanupTimer = setInterval(() => {
    void drainDeliveryReferenceCleanupJobs();
  }, 30_000);
  deliveryCleanupTimer.unref?.();
''',
    "delivery cleanup timer")
text = replace_once(text,
    '''    if (reconciliationTimer) clearInterval(reconciliationTimer);
    clearInterval(keepAlive);
''',
    '''    if (reconciliationTimer) clearInterval(reconciliationTimer);
    if (deliveryCleanupTimer) clearInterval(deliveryCleanupTimer);
    clearInterval(keepAlive);
    for (const { build } of activeDeviceBuildTasks.values()) {
      requestDeviceBuildCancellation(build, "Swift Sim helper is shutting down.");
    }
''',
    "shutdown cancellation")
text = replace_once(text,
    '''    const sessions = typeof store.list === "function" ? store.list() : [];
    void Promise.allSettled(sessions.map((session) => stopSession(session.id))).finally(() => {
      sessionsStopped = true;
      maybeExit();
    });
''',
    '''    const sessions = typeof store.list === "function" ? store.list() : [];
    const buildTasks = [...activeDeviceBuildTasks.values()].map(({ promise }) => promise);
    void Promise.allSettled([
      ...sessions.map((session) => stopSession(session.id)),
      ...buildTasks,
    ]).finally(() => {
      sessionsStopped = true;
      maybeExit();
    });
''',
    "shutdown waits for builds")
text = replace_once(text,
    '    const forceTimer = setTimeout(() => process.exit(0), 5_000);\n',
    '    const forceTimer = setTimeout(() => process.exit(1), 8_000);\n',
    "shutdown force deadline")
text = replace_once(text,
    '''    const requested = deviceBuildStore.list().filter((build) =>
      build.state === "ready"
      && build.installation?.state === "requested"
      && build.app?.bundleIdentifier
    );
''',
    '''    const requested = deviceBuildStore.list().filter((build) =>
      build.state === "ready"
      && installationVerificationIsActive(build.installation)
      && build.app?.bundleIdentifier
    );
''',
    "verification retry filter")
text = replace_once(text,
    '''function verifyDeviceBuild(build) {
''',
    '''function installationVerificationIsActive(installation = {}) {
  const state = installation.state || "unknown";
  if (!["requested", "not-installed", "different-version"].includes(state)) return false;
  const deadline = Date.parse(installation.verificationDeadlineAt || "");
  return Number.isFinite(deadline) && deadline > Date.now();
}

function verifyDeviceBuild(build) {
''',
    "verification retry helper")
text = regex_once(text,
    r'''function releaseAppDeliveryReferences\(app\) \{.*?\n\}\n''',
    '''async function drainDeliveryReferenceCleanupJobs() {
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

function startManagedDeviceBuild(build) {
  const promise = runDeviceBuild(build, { save: (next) => deviceBuildStore.save(next) })
    .then(() => {
      build.state = "delivering";
      deviceBuildStore.save(build);
      return prepareDeviceDelivery(build);
    })
    .catch((error) => {
      if (error?.code === "SWIFT_SIM_BUILD_CANCELLED") {
        build.state = "failed";
        build.logs = Array.isArray(build.logs) ? build.logs : [];
        build.logs.push("Build was interrupted before completion.");
        try { deviceBuildStore.save(build); } catch {}
      }
    })
    .finally(() => {
      activeDeviceBuildTasks.delete(build.id);
    });
  activeDeviceBuildTasks.set(build.id, { build, promise });
  return promise;
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
''',
    "durable cleanup and task helpers")
path.write_text(text)
