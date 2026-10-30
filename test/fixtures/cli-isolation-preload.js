import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { runtimeHealthPayload, HELPER_RUNTIME_ROLE } from "../../mac-helper/src/runtimeHealth.js";

const originalSpawnSync = childProcess.spawnSync;
const result = (stdout, status = 0) => ({ status, stdout, stderr: "", signal: null });

// Setup/doctor tests exercise the real CLI and agent adapters against fixture
// state. They must never probe the operator's helper, Xcode keys or Tailnet.
childProcess.spawnSync = function isolatedCliSpawn(command, args = [], options = {}) {
  const name = String(command);
  const argv = args.map(String);
  if (name === "xcodebuild") return result("Xcode Fixture\nBuild version TEST\n");
  if (name === "security") return result("0 valid identities found\n");
  if (/tailscale/i.test(name)) return result("", 1);
  const helperIndex = argv.findIndex((value) => value.endsWith("/mac-helper/bin/swift-sim-helper.js"));
  if (name === process.execPath && helperIndex >= 0 && argv[helperIndex + 1] === "setup-status") {
    return result(JSON.stringify({ ok: false, tailscale: { online: false }, tailscaleServe: { configured: false } }));
  }
  return originalSpawnSync.call(this, command, args, options);
};
syncBuiltinESMExports();
globalThis.fetch = async (input, _init) => {
  const url = new URL(String(input));
  if (url.hostname === "127.0.0.1" && url.pathname === "/health") return new Response(JSON.stringify(runtimeHealthPayload(HELPER_RUNTIME_ROLE)), { status: 200 });
  throw new Error("Unexpected network access in isolated CLI fixture.");
};
