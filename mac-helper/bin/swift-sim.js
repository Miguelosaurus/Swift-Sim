#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import packageJSON from "../../package.json" with { type: "json" };

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const helperPath = join(rootDirectory, "mac-helper", "bin", "swift-sim-helper.js");
const helperBaseURL = `http://127.0.0.1:${Number(process.env.SWIFT_SIM_PORT || 47217)}`;
const marketplaceRoot = process.env.SWIFT_SIM_MARKETPLACE_ROOT || rootDirectory;
const marketplaceName = "swift-sim";
const pluginName = "swift-sim-companion";

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main() {
  const [command = "help", ...args] = process.argv.slice(2);

  if (["help", "-h", "--help"].includes(command)) return printHelp();
  if (["version", "-v", "--version"].includes(command)) return console.log(packageJSON.version);

  if (command === "setup") return setup(args);
  if (command === "doctor" || command === "status") return doctor(args);
  if (command === "update") return update();

  if (command === "serve") return runHelper(["serve", ...args], { inherit: true });

  const helperCommands = new Set([
    "build-device",
    "list-apps",
    "archive-app",
    "delete-app",
    "verify-device-build",
    "companion-link",
    "device-delivery-status",
    "device-delivery-stop",
    "pair",
    "serve-sim-info",
    "setup-status",
    "start-session",
    "stop-session",
  ]);
  if (helperCommands.has(command)) {
    if (["pair", "start-session"].includes(command)) await ensureHelperRunning();
    return runHelper([command, ...args], { inherit: true });
  }

  throw new Error(`Unknown command: ${command}. Run swift-sim help.`);
}

async function setup(args) {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean" },
      "skip-plugin": { type: "boolean" },
      "skip-service": { type: "boolean" },
    },
  });

  const actions = [];
  if (!values["skip-service"]) {
    actions.push(await ensureHelperRunning());
  }
  if (!values["skip-plugin"]) {
    actions.push(installCodexPlugin());
  }

  const report = await buildDoctorReport();
  const result = { ...report, actions };
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDoctorReport(result);
  console.log("");
  if (result.deviceInstalls.ready) {
    console.log("Swift Sim is ready. Ask Codex: Build this app to my iPhone with Swift Sim.");
  } else {
    console.log("Finish the item marked needs-attention, then run swift-sim doctor.");
  }
  if (!result.simulatorPreview.ready) {
    console.log("Live Simulator preview is optional. Run swift-sim doctor after configuring Tailscale.");
  }
}

async function doctor(args) {
  const { values } = parseArgs({ args, options: { json: { type: "boolean" } } });
  const report = await buildDoctorReport();
  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printDoctorReport(report);
  }
}

async function update() {
  const brew = findCommand("brew");
  if (brew) {
    runCapture(brew, ["upgrade", "swift-sim"], { allowFailure: true });
  }
  const codex = findCodexCommand();
  if (codex) {
    runCapture(codex, ["plugin", "marketplace", "upgrade", marketplaceName], { allowFailure: true });
    runCapture(codex, ["plugin", "add", `${pluginName}@${marketplaceName}`], { allowFailure: true });
  }
  console.log("Swift Sim update check complete.");
}

async function buildDoctorReport() {
  const xcode = runCapture("xcodebuild", ["-version"], { allowFailure: true });
  const identities = runCapture("security", ["find-identity", "-v", "-p", "codesigning"], { allowFailure: true });
  const helper = await helperHealth();
  const setup = runHelperJSON(["setup-status"]);
  const codex = findCodexCommand();
  const pluginList = codex ? runCapture(codex, ["plugin", "list"], { allowFailure: true }) : emptyResult();
  const signingIdentityCount = Number(identities.stdout.match(/(\d+) valid identities found/)?.[1] || 0);
  const pluginInstalled = pluginList.status === 0
    && pluginList.stdout.includes(pluginName)
    && pluginList.stdout.includes("installed, enabled");
  const xcodeReady = xcode.status === 0;

  return {
    version: packageJSON.version,
    deviceInstalls: {
      ready: xcodeReady && helper.ok && pluginInstalled,
      xcode: check(xcodeReady, firstLine(xcode.stdout) || "Xcode is unavailable"),
      signing: check(signingIdentityCount > 0, signingIdentityCount > 0
        ? `${signingIdentityCount} local signing ${signingIdentityCount === 1 ? "identity" : "identities"} found`
        : "Xcode will request or create signing credentials during the first device build", true),
      helper: check(helper.ok, helper.ok ? "Mac helper is running" : "Mac helper is not running"),
      codexPlugin: check(pluginInstalled, pluginInstalled ? "Codex plugin is installed and enabled" : "Codex plugin is not installed"),
    },
    simulatorPreview: {
      optional: true,
      ready: Boolean(setup?.ok),
      tailscale: check(Boolean(setup?.tailscale?.online), setup?.tailscale?.online
        ? "Tailscale is connected"
        : "Tailscale is optional and only required for live Simulator preview"),
      privateServe: check(Boolean(setup?.tailscaleServe?.configured), setup?.tailscaleServe?.configured
        ? "Private Tailscale Serve route is configured"
        : "Run tailscale serve 47217 to enable live Simulator preview"),
    },
  };
}

async function ensureHelperRunning() {
  const wasHealthy = (await helperHealth()).ok;

  const brew = findCommand("brew");
  if (brew && process.env.SWIFT_SIM_MARKETPLACE_ROOT) {
    const service = runCapture(brew, ["services", "start", "swift-sim"], { allowFailure: true });
    if (service.status === 0 && await waitForHelper()) {
      return { id: "helper", state: "configured", detail: "Mac helper starts automatically with Homebrew services" };
    }
  }

  if (wasHealthy) return { id: "helper", state: "unchanged", detail: "Mac helper is already running" };

  const logDirectory = join(homedir(), ".swift-sim");
  mkdirSync(logDirectory, { recursive: true });
  const output = openSync(join(logDirectory, "helper.log"), "a");
  const child = spawn(process.execPath, [helperPath, "serve"], {
    detached: true,
    stdio: ["ignore", output, output],
    env: process.env,
  });
  child.unref();
  if (!await waitForHelper()) throw new Error(`Mac helper did not start. Check ${join(logDirectory, "helper.log")}.`);
  return { id: "helper", state: "started", detail: "Mac helper started for this user session" };
}

function installCodexPlugin() {
  const codex = findCodexCommand();
  if (!codex) {
    return { id: "codex-plugin", state: "needs-attention", detail: "Install the Codex app, then rerun swift-sim setup" };
  }

  const addMarketplace = runCapture(codex, ["plugin", "marketplace", "add", marketplaceRoot], { allowFailure: true });
  if (addMarketplace.status !== 0) {
    runCapture(codex, ["plugin", "marketplace", "upgrade", marketplaceName], { allowFailure: true });
  }
  const install = runCapture(codex, ["plugin", "add", `${pluginName}@${marketplaceName}`], { allowFailure: true });
  if (install.status !== 0) {
    return {
      id: "codex-plugin",
      state: "needs-attention",
      detail: compactError(install) || "Codex could not install the Swift Sim plugin",
    };
  }
  return { id: "codex-plugin", state: "configured", detail: `Codex plugin ${packageJSON.version} installed from the Swift Sim package` };
}

function printDoctorReport(report) {
  console.log(`Swift Sim ${report.version}`);
  console.log("");
  console.log("iPhone app installs (primary)");
  printCheck("Xcode", report.deviceInstalls.xcode);
  printCheck("Signing", report.deviceInstalls.signing);
  printCheck("Mac helper", report.deviceInstalls.helper);
  printCheck("Codex plugin", report.deviceInstalls.codexPlugin);
  console.log("");
  console.log("Live Simulator preview (optional)");
  printCheck("Tailscale", report.simulatorPreview.tailscale);
  printCheck("Private route", report.simulatorPreview.privateServe);
}

function printCheck(label, value) {
  const marker = value.ready ? "ready" : value.informational ? "info" : "needs-attention";
  console.log(`[${marker}] ${label}: ${value.detail}`);
}

function check(ready, detail, informational = false) {
  return { ready, informational, detail };
}

async function helperHealth() {
  try {
    const response = await fetch(`${helperBaseURL}/health`, { signal: AbortSignal.timeout(1200) });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

async function waitForHelper() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await helperHealth()).ok) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function runHelperJSON(args) {
  const result = runCapture(process.execPath, [helperPath, ...args], { allowFailure: true });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function runHelper(args, { inherit = false } = {}) {
  const result = spawnSync(process.execPath, [helperPath, ...args], {
    encoding: "utf8",
    stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  if (result.status !== 0) process.exitCode = result.status || 1;
  return result;
}

function runCapture(command, args, { allowFailure = false } = {}) {
  const result = spawnSync(command, args, { encoding: "utf8", env: process.env });
  const normalized = {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
  if (!allowFailure && normalized.status !== 0) {
    throw new Error(compactError(normalized) || `${command} failed.`);
  }
  return normalized;
}

function findCodexCommand() {
  const explicit = process.env.SWIFT_SIM_CODEX_COMMAND;
  if (explicit && existsSync(explicit)) return explicit;
  const shellCommand = findCommand("codex");
  if (shellCommand) {
    const probe = runCapture(shellCommand, ["--version"], { allowFailure: true });
    if (probe.status === 0) return shellCommand;
  }
  const appCommand = "/Applications/Codex.app/Contents/Resources/codex";
  return existsSync(appCommand) ? appCommand : "";
}

function findCommand(name) {
  const result = spawnSync("/usr/bin/which", [name], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

function compactError(result) {
  return String(result.stderr || result.stdout || "").trim().split(/\r?\n/).slice(-2).join(" ");
}

function firstLine(value) {
  return String(value || "").trim().split(/\r?\n/)[0] || "";
}

function emptyResult() {
  return { status: 1, stdout: "", stderr: "" };
}

function printHelp() {
  console.log(`Swift Sim ${packageJSON.version}

Usage:
  swift-sim setup                 Configure the helper and Codex plugin
  swift-sim doctor [--json]       Check install and optional Simulator setup
  swift-sim update                Update Homebrew and the Codex plugin
  swift-sim build-device ...      Build a signed iPhone install
  swift-sim list-apps [--archived] List managed prototype apps and build history
  swift-sim verify-device-build    Verify an install on a reachable iPhone
  swift-sim archive-app ...        Archive or restore an app from the library
  swift-sim delete-app ...         Delete local app history and artifacts
  swift-sim start-session ...     Open a live Simulator session
  swift-sim pair ...              Pair optional Simulator diagnostics
  swift-sim serve                 Run the local helper in the foreground

iPhone app installs are the primary workflow and do not require Tailscale.
Live Simulator preview is optional and uses private Tailscale access.`);
}
