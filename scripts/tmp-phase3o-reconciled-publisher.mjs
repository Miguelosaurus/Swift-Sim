import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Expected product worktree path.");

function patchFile(relativePath, edits) {
  const filePath = path.join(root, relativePath);
  let text = fs.readFileSync(filePath, "utf8");
  for (const { oldText, newText, label } of edits) {
    const first = text.indexOf(oldText);
    if (first < 0) throw new Error(`Missing ${relativePath} anchor: ${label}`);
    if (text.indexOf(oldText, first + oldText.length) >= 0) {
      throw new Error(`Duplicate ${relativePath} anchor: ${label}`);
    }
    text = text.slice(0, first) + newText + text.slice(first + oldText.length);
  }
  fs.writeFileSync(filePath, text);
}

const helperPath = path.join(root, "mac-helper/bin/swift-sim-helper.js");
let helper = fs.readFileSync(helperPath, "utf8");

function replaceHelper(oldText, newText, label) {
  const first = helper.indexOf(oldText);
  if (first < 0) throw new Error(`Missing helper anchor: ${label}`);
  if (helper.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Duplicate helper anchor: ${label}`);
  }
  helper = helper.slice(0, first) + newText + helper.slice(first + oldText.length);
}

const importAnchor =
  'import { createHelperControlApplicationService } from "../src/http/helperControlApplicationService.js";\n';
replaceHelper(
  importAnchor,
  importAnchor +
    'import { createHelperServiceLifecycle } from "../src/http/helperServiceLifecycle.js";\n',
  "lifecycle import",
);

replaceHelper(
  `async function serve({ host, port, deviceBuildsOnly = false }) {\n  await recoverInterruptedDeviceBuilds();\n  setImmediate(() => {\n    void scheduleDeliveryReferenceCleanup();\n  });\n  const activeSockets = new Set();\n  const deviceAppService = createDeviceAppApplicationService({\n`,
  `async function serve({ host, port, deviceBuildsOnly = false }) {\n  const deviceInstallationReconciler = createDeviceInstallationReconciliationCoordinator({\n    listBuilds: () => deviceBuildStore.list(),\n    verifyBuild: (build) => verifyDeviceBuild(build),\n    saveVerification: (buildID, verification) => deviceBuildStore.saveVerification(buildID, verification),\n    nowMs: () => Date.now(),\n    nowIso: () => new Date().toISOString(),\n  });\n  const lifecycle = createHelperServiceLifecycle({\n    createServer,\n    host,\n    port,\n    deviceBuildsOnly,\n    recoverInterruptedBuilds: recoverInterruptedDeviceBuilds,\n    scheduleDeliveryCleanup: scheduleDeliveryReferenceCleanup,\n    reconcileRequestedBuilds: () => deviceInstallationReconciler.runOnce(),\n    activeBuildTasks: () => [...activeDeviceBuildTasks.values()],\n    cancelBuild: requestDeviceBuildCancellation,\n    listSessions: () => (typeof store.list === "function" ? store.list() : []),\n    stopSession: (sessionID) => stopSession(sessionID),\n  });\n  await lifecycle.prepare();\n\n  const deviceAppService = createDeviceAppApplicationService({\n`,
  "serve lifecycle prelude",
);

const listenerStart = helper.indexOf("  const server = createServer(async (req, res) => {\n");
if (listenerStart < 0) throw new Error("Missing helper server listener start.");
const connectionStart = helper.indexOf('  server.on("connection", (socket) => {\n', listenerStart);
if (connectionStart < 0) throw new Error("Missing helper connection lifecycle block.");
let listener = helper.slice(listenerStart, connectionStart);
listener = listener.replace(
  "  const server = createServer(async (req, res) => {\n",
  "  const requestListener = async (req, res) => {\n",
);
const listenerClose = listener.lastIndexOf("  });\n");
if (listenerClose < 0) throw new Error("Missing helper request listener close.");
listener =
  listener.slice(0, listenerClose) +
  "  };\n" +
  listener.slice(listenerClose + "  });\n".length);

const runtimeEndMarker = "  await new Promise(() => {});\n}\n\nfunction verifyDeviceBuild(build) {\n";
const runtimeEnd = helper.indexOf(runtimeEndMarker, connectionStart);
if (runtimeEnd < 0) throw new Error("Missing helper lifecycle tail.");
const replacement =
  listener +
  "  await lifecycle.start(requestListener);\n" +
  "  await lifecycle.wait();\n" +
  "}\n\nfunction verifyDeviceBuild(build) {\n";
helper =
  helper.slice(0, listenerStart) +
  replacement +
  helper.slice(runtimeEnd + runtimeEndMarker.length);

if (helper.includes('  server.on("connection", (socket) => {')) {
  throw new Error("Legacy connection lifecycle block remains.");
}
if (helper.includes("const scheduleReconciliation = () =>")) {
  throw new Error("Legacy reconciliation scheduling block remains.");
}
if (!helper.includes("reconcileRequestedBuilds: () => deviceInstallationReconciler.runOnce()")) {
  throw new Error("Reconciliation coordinator was not injected into lifecycle.");
}
if (!helper.includes("await lifecycle.prepare();") || !helper.includes("await lifecycle.start(requestListener);")) {
  throw new Error("Lifecycle delegation was not installed.");
}
fs.writeFileSync(helperPath, helper);

patchFile("test/deliveryCleanupScheduler.test.js", [
  {
    oldText: 'import { readFileSync } from "node:fs";\n',
    newText: "",
    label: "obsolete source-reader import",
  },
  {
    oldText: `\ntest("helper maintenance routes startup and interval cleanup through the safe scheduler", () => {\n  const source = readFileSync("mac-helper/bin/swift-sim-helper.js", "utf8");\n  assert.match(source, /setImmediate\\(\\(\\) => \\{\\n\\s+void scheduleDeliveryReferenceCleanup\\(\\);/);\n  assert.match(source, /deliveryCleanupTimer = setInterval\\(\\(\\) => \\{\\n\\s+void scheduleDeliveryReferenceCleanup\\(\\);/);\n});\n`,
    newText: "\n",
    label: "obsolete helper maintenance source assertion",
  },
]);

patchFile("test/mainPostMergeIntegration.test.js", [
  {
    oldText: `\ntest("delivery reference cleanup no longer blocks helper startup", () => {\n  const source = readFileSync("mac-helper/bin/swift-sim-helper.js", "utf8");\n  const serveStart = source.indexOf("async function serve(");\n  const createServer = source.indexOf("const server = createServer", serveStart);\n  const startup = source.slice(serveStart, createServer);\n  assert.doesNotMatch(startup, /await drainDeliveryReferenceCleanupJobs\\(\\)/);\n  assert.match(startup, /setImmediate\\(\\(\\) =>/);\n});\n`,
    newText: "\n",
    label: "obsolete startup source assertion",
  },
]);

const policyPath = path.join(root, "scripts/architecture/baseline-policy.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const sourceTextPath = "test/deliveryCleanupScheduler.test.js";
if (policy.baseline?.sourceTextImplementationTests?.[sourceTextPath] !== 1) {
  throw new Error("Historical delivery-cleanup source-text baseline changed unexpectedly.");
}
if (policy.caps?.sourceTextImplementationTests?.[sourceTextPath] !== 1) {
  throw new Error("Expected live delivery-cleanup source-text cap of 1.");
}
delete policy.caps.sourceTextImplementationTests[sourceTextPath];
if (policy.baseline.sourceTextImplementationTests[sourceTextPath] !== 1) {
  throw new Error("Historical source-text baseline must remain immutable.");
}
if (sourceTextPath in policy.caps.sourceTextImplementationTests) {
  throw new Error("Obsolete delivery-cleanup source-text cap remains.");
}
fs.writeFileSync(policyPath, `${JSON.stringify(policy, null, 2)}\n`);
