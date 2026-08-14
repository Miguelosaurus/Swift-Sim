import childProcess from "node:child_process";
import { appendFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";

const originalSpawnSync = childProcess.spawnSync;
const helperPathSuffix = "/mac-helper/bin/swift-sim-helper.js";

childProcess.spawnSync = function patchedSpawnSync(command, args = [], options = {}) {
  const argv = Array.isArray(args) ? args.map(String) : [];
  const helperIndex = argv.findIndex((value) => value.endsWith(helperPathSuffix));
  if (String(command) === process.execPath && helperIndex >= 0) {
    const helperArgs = argv.slice(helperIndex + 1);
    if (helperArgs[0] === "setup-status") {
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify({
          ok: true,
          suggestedRemoteBaseUrl: "https://fixture-mac.example.test",
          tailscale: { hostName: "fixture-mac" },
        }),
        stderr: "",
        pid: 1,
        output: [null, "", ""],
      };
    }
    if (helperArgs[0] === "pair") {
      if (process.env.SWIFT_SIM_PAIR_CALLS) {
        appendFileSync(process.env.SWIFT_SIM_PAIR_CALLS, `${JSON.stringify(helperArgs)}\n`);
      }
      return {
        status: 0,
        signal: null,
        stdout: "",
        stderr: "",
        pid: 1,
        output: [null, "", ""],
      };
    }
  }
  return originalSpawnSync.call(this, command, args, options);
};

syncBuiltinESMExports();

globalThis.fetch = async () => ({ ok: true, status: 200 });
