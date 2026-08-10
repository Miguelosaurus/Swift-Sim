import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root) throw new Error("Expected product worktree path.");
const helperPath = path.join(root, "mac-helper/bin/swift-sim-helper.js");
let text = fs.readFileSync(helperPath, "utf8");

function replaceOnce(oldText, newText, label) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error(`Missing helper anchor: ${label}`);
  if (text.indexOf(oldText, first + oldText.length) >= 0) {
    throw new Error(`Duplicate helper anchor: ${label}`);
  }
  text = text.slice(0, first) + newText + text.slice(first + oldText.length);
}

const importAnchor =
  'import { createHelperControlApplicationService } from "../src/http/helperControlApplicationService.js";\n';
replaceOnce(
  importAnchor,
  importAnchor +
    'import { createHelperServiceLifecycle } from "../src/http/helperServiceLifecycle.js";\n',
  "lifecycle import",
);

replaceOnce(
  `async function serve({ host, port, deviceBuildsOnly = false }) {\n  await recoverInterruptedDeviceBuilds();\n  setImmediate(() => {\n    void scheduleDeliveryReferenceCleanup();\n  });\n  const activeSockets = new Set();\n  const deviceAppService = createDeviceAppApplicationService({\n`,
  `async function serve({ host, port, deviceBuildsOnly = false }) {\n  const lifecycle = createHelperServiceLifecycle({\n    createServer,\n    host,\n    port,\n    deviceBuildsOnly,\n    recoverInterruptedBuilds: recoverInterruptedDeviceBuilds,\n    scheduleDeliveryCleanup: scheduleDeliveryReferenceCleanup,\n    reconcileRequestedBuilds: reconcileRequestedDeviceBuilds,\n    activeBuildTasks: () => [...activeDeviceBuildTasks.values()],\n    cancelBuild: requestDeviceBuildCancellation,\n    listSessions: () => (typeof store.list === "function" ? store.list() : []),\n    stopSession: (sessionID) => stopSession(sessionID),\n  });\n  await lifecycle.prepare();\n\n  const deviceAppService = createDeviceAppApplicationService({\n`,
  "serve lifecycle prelude",
);

const listenerStart = text.indexOf("  const server = createServer(async (req, res) => {\n");
if (listenerStart < 0) throw new Error("Missing helper server listener start.");
const connectionStart = text.indexOf('  server.on("connection", (socket) => {\n', listenerStart);
if (connectionStart < 0) throw new Error("Missing helper connection lifecycle block.");
let listener = text.slice(listenerStart, connectionStart);
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

const runtimeEndMarker =
  "  await new Promise(() => {});\n}\n\nlet deviceReconciliationRunning = false;\n";
const runtimeEnd = text.indexOf(runtimeEndMarker, connectionStart);
if (runtimeEnd < 0) throw new Error("Missing helper lifecycle tail.");
const replacement =
  listener +
  "  await lifecycle.start(requestListener);\n" +
  "  await lifecycle.wait();\n" +
  "}\n\nlet deviceReconciliationRunning = false;\n";
text =
  text.slice(0, listenerStart) +
  replacement +
  text.slice(runtimeEnd + runtimeEndMarker.length);

if (text.includes('  server.on("connection", (socket) => {')) {
  throw new Error("Legacy connection lifecycle block remains.");
}
if (!text.includes("await lifecycle.prepare();") || !text.includes("await lifecycle.start(requestListener);")) {
  throw new Error("Lifecycle delegation was not installed.");
}
fs.writeFileSync(helperPath, text);
