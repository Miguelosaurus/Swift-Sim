import { randomUUID } from "node:crypto";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const childProcess = require("node:child_process");
const fs = require("node:fs");
const originalSpawn = childProcess.spawn;
const originalWriteFileSync = fs.writeFileSync;
const supervisorPath = fileURLToPath(new URL("../bin/swift-sim-owned-worker.js", import.meta.url));
const pendingReadyPaths = new Map();

childProcess.spawn = function ownedSpawn(command, args = [], options = {}) {
  if (!shouldSupervise(command, args, options)) {
    return originalSpawn.call(this, command, args, options);
  }

  const readyPath = join(
    tmpdir(),
    `swift-sim-worker-${process.pid}-${randomUUID()}.ready`
  );
  const payload = Buffer.from(JSON.stringify({
    command: String(command),
    args: Array.isArray(args) ? args.map(String) : [],
  }), "utf8").toString("base64url");
  const child = originalSpawn.call(this, process.execPath, [
    supervisorPath,
    "--ready-path", readyPath,
    "--display-command", String(command),
    "--payload", payload,
  ], options);

  if (Number.isInteger(child.pid) && child.pid > 0) {
    pendingReadyPaths.set(child.pid, readyPath);
    const clear = () => pendingReadyPaths.delete(child.pid);
    child.once("close", clear);
    child.once("error", clear);
  }
  return child;
};

fs.writeFileSync = function ownedWriteFileSync(path, data, options) {
  const result = originalWriteFileSync.call(this, path, data, options);
  if (String(path).endsWith(".worker.json")) {
    try {
      const record = JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));
      const readyPath = pendingReadyPaths.get(Number(record?.pid));
      if (readyPath) {
        originalWriteFileSync.call(fs, readyPath, "ready\n", { mode: 0o600, flag: "wx" });
        pendingReadyPaths.delete(Number(record.pid));
      }
    } catch {
      // The owning caller handles journal write failures. Never start the real
      // command unless the journal was both written and parsed successfully.
    }
  }
  return result;
};

syncBuiltinESMExports();

function shouldSupervise(command, args, options) {
  if (options?.detached !== true) return false;
  const executable = basename(String(command || ""));
  if (executable === "xcodebuild") return true;
  return String(command) === "/bin/sh"
    && Array.isArray(args)
    && args[0] === "-lc";
}
