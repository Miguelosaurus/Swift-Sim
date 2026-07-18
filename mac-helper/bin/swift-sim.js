#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import packageJSON from "../../package.json" with { type: "json" };
import {
  classifyLiveChange,
  ensureLiveEngineInstalled,
  inspectLiveReload,
  routeLiveChange,
  startLiveReload,
} from "../src/liveReload.js";

const rootDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const helperPath = join(rootDirectory, "mac-helper", "bin", "swift-sim-helper.js");
const helperBaseURL = `http://127.0.0.1:${Number(process.env.SWIFT_SIM_PORT || 47217)}`;
const marketplaceRoot = process.env.SWIFT_SIM_MARKETPLACE_ROOT || rootDirectory;
const marketplaceName = "swift-sim";
const pluginName = "swift-sim-companion";
const skillName = "remote-simulator-companion";
const packagedSkillDirectory = join(marketplaceRoot, "plugins", pluginName, "skills", skillName);

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
  if (command === "live-status") return liveStatus(args);
  if (command === "live-start") return liveStart(args);
  if (command === "classify-change") return classifyChange(args);
  if (command === "route-change") return routeChange(args);

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

async function liveStatus(args) {
  const { values } = parseArgs({ args, options: liveOptions() });
  console.log(JSON.stringify(await inspectLiveReload({
    project: values.project,
    host: values.host,
  }), null, 2));
}

async function liveStart(args) {
  const { values } = parseArgs({ args, options: liveOptions() });
  const result = await startLiveReload({
    project: values.project,
    host: values.host,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.started) process.exitCode = 1;
}

function classifyChange(args) {
  const { values } = parseArgs({
    args,
    options: {
      before: { type: "string" },
      after: { type: "string" },
    },
  });
  console.log(JSON.stringify(classifyLiveChange({
    beforePath: values.before,
    afterPath: values.after,
  }), null, 2));
}

async function routeChange(args) {
  const { values } = parseArgs({
    args,
    options: {
      ...liveOptions(),
      before: { type: "string" },
      after: { type: "string" },
    },
  });
  console.log(JSON.stringify(await routeLiveChange({
    beforePath: values.before,
    afterPath: values.after,
    project: values.project,
    host: values.host,
  }), null, 2));
}

function liveOptions() {
  return {
    project: { type: "string" },
    host: { type: "string" },
  };
}

async function setup(args) {
  const { values } = parseArgs({
    args,
    options: {
      json: { type: "boolean" },
      "skip-plugin": { type: "boolean" },
      "skip-agents": { type: "boolean" },
      "skip-service": { type: "boolean" },
    },
  });

  const actions = [];
  if (!values["skip-service"]) {
    actions.push(await ensureHelperRunning());
  }
  if (!values["skip-plugin"] && !values["skip-agents"]) {
    actions.push(...installAgentIntegrations());
  }
  actions.push(await ensureLiveEngineInstalled());

  const report = await buildDoctorReport();
  const result = { ...report, actions };
  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  printDoctorReport(result);
  console.log("");
  if (result.deviceInstalls.ready) {
    console.log("Swift Sim is ready. Ask your coding agent: Build this app to my iPhone with Swift Sim.");
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
  if (!brew) {
    throw new Error("Homebrew is required to update Swift Sim. Install Homebrew, then try again.");
  }
  const upgrade = runCapture(brew, ["upgrade", "swift-sim"], { allowFailure: true });
  if (upgrade.status !== 0) {
    throw new Error(compactError(upgrade) || "Homebrew could not update Swift Sim. Your existing version is still installed.");
  }
  const updatedCommand = findCommand("swift-sim");
  let actions;
  if (updatedCommand) {
    const refreshed = runCapture(updatedCommand, ["setup", "--skip-service", "--json"], { allowFailure: true });
    if (refreshed.status !== 0) {
      throw new Error(compactError(refreshed) || "Swift Sim updated, but its coding-agent integrations could not be refreshed.");
    }
    try {
      actions = JSON.parse(refreshed.stdout).actions || [];
    } catch {
      throw new Error("Swift Sim updated, but the refreshed setup report could not be read. Run swift-sim doctor.");
    }
  } else {
    actions = installAgentIntegrations();
  }
  for (const action of actions) {
    console.log(`[${action.state}] ${action.label}: ${action.detail}`);
  }
  const failed = actions.filter((action) => action.state === "needs-attention");
  if (failed.length > 0) {
    throw new Error("Swift Sim updated, but one or more coding-agent integrations could not be refreshed. Run swift-sim doctor.");
  }
  console.log("Swift Sim and detected agent integrations are up to date.");
}

async function buildDoctorReport() {
  const xcode = runCapture("xcodebuild", ["-version"], { allowFailure: true });
  const identities = runCapture("security", ["find-identity", "-v", "-p", "codesigning"], { allowFailure: true });
  const helper = await helperHealth();
  const setup = runHelperJSON(["setup-status"]);
  const codex = findCodexCommand();
  const pluginList = codex ? runCapture(codex, ["plugin", "list"], { allowFailure: true }) : emptyResult();
  const claude = findClaudeCommand();
  const claudePluginList = claude ? runCapture(claude, ["plugin", "list", "--json"], { allowFailure: true }) : emptyResult();
  const signingIdentityCount = Number(identities.stdout.match(/(\d+) valid identities found/)?.[1] || 0);
  const codexVersion = codexPluginVersion(pluginList.stdout);
  const codexReady = pluginList.status === 0
    && pluginList.stdout.includes(pluginName)
    && pluginList.stdout.includes("installed, enabled")
    && versionMatchesPackage(codexVersion);
  const cursorDetected = isCursorInstalled();
  const cursorReady = cursorDetected && installedCursorSkillVersion() === packageJSON.version;
  const claudeEntry = claudePluginEntry(claudePluginList.stdout);
  const claudeReady = claudePluginList.status === 0
    && outputContainsEnabledPlugin(claudePluginList.stdout)
    && versionMatchesPackage(claudeEntry?.version);
  const openCodeDetected = isOpenCodeInstalled();
  const openCodeReady = openCodeDetected && installedOpenCodeSkillVersion() === packageJSON.version;
  const agents = {
    codex: agentCheck(Boolean(codex), codexReady, codexReady
      ? `Swift Sim plugin ${packageJSON.version} is installed`
      : Boolean(codex) && codexVersion
        ? `Swift Sim plugin ${codexVersion} does not match ${packageJSON.version}; run swift-sim setup`
        : Boolean(codex) ? "Swift Sim plugin is not installed" : "Codex is not installed"),
    cursor: agentCheck(cursorDetected, cursorReady, cursorReady
      ? `Swift Sim skill ${packageJSON.version} is installed`
      : cursorDetected ? "Swift Sim skill is not installed" : "Cursor is not installed"),
    claude: agentCheck(Boolean(claude), claudeReady, claudeReady
      ? `Swift Sim plugin ${packageJSON.version} is installed`
      : Boolean(claude) && claudeEntry?.version
        ? `Swift Sim plugin ${claudeEntry.version} does not match ${packageJSON.version}; run swift-sim setup`
        : Boolean(claude) ? "Swift Sim plugin is not installed" : "Claude Code is not installed"),
    opencode: agentCheck(openCodeDetected, openCodeReady, openCodeReady
      ? `Swift Sim skill ${packageJSON.version} is installed`
      : openCodeDetected ? "Swift Sim skill is not installed" : "OpenCode is not installed"),
  };
  const readyAgentNames = Object.entries(agents).filter(([, value]) => value.ready).map(([name]) => displayAgentName(name));
  const agentIntegrationsReady = readyAgentNames.length > 0;
  const xcodeReady = xcode.status === 0;
  const liveReload = await inspectLiveReload();

  return {
    version: packageJSON.version,
    deviceInstalls: {
      ready: xcodeReady && helper.ok && agentIntegrationsReady,
      xcode: check(xcodeReady, firstLine(xcode.stdout) || "Xcode is unavailable"),
      signing: check(signingIdentityCount > 0, signingIdentityCount > 0
        ? `${signingIdentityCount} local signing ${signingIdentityCount === 1 ? "identity" : "identities"} found`
        : "Xcode will request or create signing credentials during the first device build", true),
      helper: check(helper.ok, helper.ok ? "Mac helper is running" : "Mac helper is not running"),
      agentIntegrations: check(agentIntegrationsReady, agentIntegrationsReady
        ? `Ready in ${readyAgentNames.join(", ")}`
        : "Install Codex, Cursor, Claude Code, or OpenCode, then rerun swift-sim setup"),
      agents,
      codexPlugin: check(codexReady, codexReady ? "Codex plugin is installed and enabled" : "Codex plugin is not installed"),
    },
    remoteHotReload: {
      optional: true,
      ready: liveReload.engine.installed && Boolean(liveReload.host),
      engine: check(liveReload.engine.installed, liveReload.engine.installed
        ? `Swift Sim live engine ${liveReload.engine.version} is installed`
        : "Run swift-sim setup to install the private live engine"),
      tailscale: check(Boolean(liveReload.host), liveReload.host
        ? `Private device route is available at ${liveReload.host}`
        : "Connect this Mac and the iPhone to Tailscale for remote hot reload"),
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

function installAgentIntegrations() {
  return [installCodexPlugin(), installCursorSkill(), installClaudePlugin(), installOpenCodeSkill()];
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
    return agentAction("codex", "Codex", "not-detected", "Codex is not installed; skipped");
  }

  const marketplaceList = runCapture(codex, ["plugin", "marketplace", "list"], { allowFailure: true });
  const configuredRoot = marketplaceSourceRoot(marketplaceList.stdout, marketplaceName);
  const marketplaceChanged = configuredRoot && canonicalPath(configuredRoot) !== canonicalPath(marketplaceRoot);
  if (marketplaceChanged) {
    runCapture(codex, ["plugin", "remove", `${pluginName}@${marketplaceName}`], { allowFailure: true });
    runCapture(codex, ["plugin", "marketplace", "remove", marketplaceName], { allowFailure: true });
  }

  const addMarketplace = runCapture(codex, ["plugin", "marketplace", "add", marketplaceRoot], { allowFailure: true });
  if (addMarketplace.status !== 0) {
    runCapture(codex, ["plugin", "marketplace", "upgrade", marketplaceName], { allowFailure: true });
  }
  const install = runCapture(codex, ["plugin", "add", `${pluginName}@${marketplaceName}`], { allowFailure: true });
  if (install.status !== 0) {
    return {
      id: "codex",
      label: "Codex",
      state: "needs-attention",
      detail: compactError(install) || "Codex could not install the Swift Sim plugin",
    };
  }
  return {
    id: "codex",
    label: "Codex",
    state: "configured",
    detail: `Codex plugin ${packageJSON.version} installed from the Swift Sim package${marketplaceChanged ? "; stale marketplace path replaced" : ""}`,
  };
}

function installCursorSkill() {
  if (!isCursorInstalled()) {
    return agentAction("cursor", "Cursor", "not-detected", "Cursor is not installed; skipped");
  }
  if (!existsSync(packagedSkillDirectory)) {
    return agentAction("cursor", "Cursor", "needs-attention", "Packaged Swift Sim skill is missing");
  }

  const destination = cursorSkillDirectory();
  try {
    mkdirSync(dirname(destination), { recursive: true });
    rmSync(destination, { recursive: true, force: true });
    cpSync(packagedSkillDirectory, destination, { recursive: true });
    writeFileSync(join(destination, ".swift-sim-version"), `${packageJSON.version}\n`);
    return agentAction("cursor", "Cursor", "configured", `Swift Sim skill ${packageJSON.version} installed for Cursor`);
  } catch (error) {
    return agentAction("cursor", "Cursor", "needs-attention", error instanceof Error ? error.message : String(error));
  }
}

function installClaudePlugin() {
  const claude = findClaudeCommand();
  if (!claude) {
    return agentAction("claude", "Claude Code", "not-detected", "Claude Code is not installed; skipped");
  }

  const marketplaces = runCapture(claude, ["plugin", "marketplace", "list", "--json"], { allowFailure: true });
  const configuredRoot = claudeMarketplaceSource(marketplaces.stdout, marketplaceName);
  if (configuredRoot && canonicalPath(configuredRoot) !== canonicalPath(marketplaceRoot)) {
    runCapture(claude, ["plugin", "marketplace", "remove", marketplaceName, "--scope", "user"], { allowFailure: true });
  }

  const currentRoot = configuredRoot && canonicalPath(configuredRoot) === canonicalPath(marketplaceRoot);
  const marketplace = currentRoot
    ? runCapture(claude, ["plugin", "marketplace", "update", marketplaceName], { allowFailure: true })
    : runCapture(claude, ["plugin", "marketplace", "add", marketplaceRoot, "--scope", "user"], { allowFailure: true });
  if (marketplace.status !== 0) {
    return agentAction("claude", "Claude Code", "needs-attention", compactError(marketplace) || "Claude Code could not register the Swift Sim marketplace");
  }

  const installed = runCapture(claude, ["plugin", "list", "--json"], { allowFailure: true });
  const plugin = outputContainsPlugin(installed.stdout)
    ? runCapture(claude, ["plugin", "update", `${pluginName}@${marketplaceName}`, "--scope", "user"], { allowFailure: true })
    : runCapture(claude, ["plugin", "install", `${pluginName}@${marketplaceName}`, "--scope", "user"], { allowFailure: true });
  if (plugin.status !== 0) {
    return agentAction("claude", "Claude Code", "needs-attention", compactError(plugin) || "Claude Code could not install the Swift Sim plugin");
  }
  const enable = runCapture(claude, ["plugin", "enable", `${pluginName}@${marketplaceName}`, "--scope", "user"], { allowFailure: true });
  if (enable.status !== 0) {
    return agentAction("claude", "Claude Code", "needs-attention", compactError(enable) || "Claude Code could not enable the Swift Sim plugin");
  }
  return agentAction("claude", "Claude Code", "configured", `Swift Sim plugin ${packageJSON.version} installed for Claude Code`);
}

function installOpenCodeSkill() {
  if (!isOpenCodeInstalled()) {
    return agentAction("opencode", "OpenCode", "not-detected", "OpenCode is not installed; skipped");
  }
  if (!existsSync(packagedSkillDirectory)) {
    return agentAction("opencode", "OpenCode", "needs-attention", "Packaged Swift Sim skill is missing");
  }

  const destination = openCodeSkillDirectory();
  try {
    mkdirSync(dirname(destination), { recursive: true });
    rmSync(destination, { recursive: true, force: true });
    cpSync(packagedSkillDirectory, destination, { recursive: true });
    writeFileSync(join(destination, ".swift-sim-version"), `${packageJSON.version}\n`);
    return agentAction("opencode", "OpenCode", "configured", `Swift Sim skill ${packageJSON.version} installed for OpenCode`);
  } catch (error) {
    return agentAction("opencode", "OpenCode", "needs-attention", error instanceof Error ? error.message : String(error));
  }
}

function agentAction(id, label, state, detail) {
  return { id, label, state, detail };
}

function cursorSkillDirectory() {
  if (process.env.SWIFT_SIM_CURSOR_SKILL_HOME) {
    return join(process.env.SWIFT_SIM_CURSOR_SKILL_HOME, skillName);
  }
  return join(homedir(), ".cursor", "skills", skillName);
}

function openCodeSkillDirectory() {
  const configRoot = process.env.SWIFT_SIM_OPENCODE_CONFIG_HOME
    || join(homedir(), ".config", "opencode");
  return join(configRoot, "skills", skillName);
}

function installedCursorSkillVersion() {
  try {
    return readFileSync(join(cursorSkillDirectory(), ".swift-sim-version"), "utf8").trim();
  } catch {
    return "";
  }
}

function installedOpenCodeSkillVersion() {
  try {
    return readFileSync(join(openCodeSkillDirectory(), ".swift-sim-version"), "utf8").trim();
  } catch {
    return "";
  }
}

function isCursorInstalled() {
  if (process.env.SWIFT_SIM_DISABLE_CURSOR === "1") return false;
  const explicit = process.env.SWIFT_SIM_CURSOR_COMMAND;
  if (explicit) return existsSync(explicit);
  return Boolean(findCommand("cursor") || findCommand("agent") || existsSync("/Applications/Cursor.app"));
}

function isOpenCodeInstalled() {
  if (process.env.SWIFT_SIM_DISABLE_OPENCODE === "1") return false;
  const explicit = process.env.SWIFT_SIM_OPENCODE_COMMAND;
  if (explicit) return existsSync(explicit);
  return Boolean(findCommand("opencode"));
}

function findClaudeCommand() {
  if (process.env.SWIFT_SIM_DISABLE_CLAUDE === "1") return "";
  const explicit = process.env.SWIFT_SIM_CLAUDE_COMMAND;
  if (explicit && existsSync(explicit)) return explicit;
  return findCommand("claude");
}

function outputContainsPlugin(output) {
  return Boolean(claudePluginEntry(output));
}

function outputContainsEnabledPlugin(output) {
  const entry = claudePluginEntry(output);
  if (!entry) return false;
  if (entry.enabled === false) return false;
  return String(entry.status || "").toLowerCase() !== "disabled";
}

function codexPluginVersion(output) {
  const line = String(output || "").split(/\r?\n/).find((value) => value.includes(pluginName));
  if (!line) return "";
  return line.match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/)?.[1] || "";
}

function versionMatchesPackage(version) {
  return String(version || "").split("+")[0] === packageJSON.version;
}

function claudePluginEntry(output) {
  try {
    const parsed = JSON.parse(output);
    return findObject(parsed, (item) => {
      const identifier = String(item.id || item.name || item.plugin || "");
      const source = String(item.marketplace || item.source || "");
      return identifier.includes(pluginName) && (identifier.includes(marketplaceName) || source.includes(marketplaceName));
    });
  } catch {
    return null;
  }
}

function findObject(value, predicate) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const match = findObject(item, predicate);
      if (match) return match;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  if (predicate(value)) return value;
  for (const nested of Object.values(value)) {
    const match = findObject(nested, predicate);
    if (match) return match;
  }
  return null;
}

function claudeMarketplaceSource(output, name) {
  try {
    const parsed = JSON.parse(output);
    const entries = Array.isArray(parsed) ? parsed : parsed.marketplaces || [];
    const entry = entries.find((item) => item?.name === name);
    return entry?.path || entry?.source?.path || "";
  } catch {
    return "";
  }
}

function marketplaceSourceRoot(output, name) {
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.trim().match(/^(\S+)\s+(.+)$/);
    if (match?.[1] === name) return match[2].trim();
  }
  return "";
}

function canonicalPath(path) {
  if (!path) return "";
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function printDoctorReport(report) {
  console.log(`Swift Sim ${report.version}`);
  console.log("");
  console.log("iPhone app installs (primary)");
  printCheck("Xcode", report.deviceInstalls.xcode);
  printCheck("Signing", report.deviceInstalls.signing);
  printCheck("Mac helper", report.deviceInstalls.helper);
  printCheck("Coding agent", report.deviceInstalls.agentIntegrations);
  for (const [name, agent] of Object.entries(report.deviceInstalls.agents || {})) {
    if (agent.detected) printCheck(`  ${displayAgentName(name)}`, agent);
  }
  console.log("");
  console.log("Remote iPhone hot reload (optional, Debug only)");
  printCheck("Patch engine", report.remoteHotReload.engine);
  printCheck("Private route", report.remoteHotReload.tailscale);
  console.log("");
  console.log("Live Simulator preview (optional)");
  printCheck("Tailscale", report.simulatorPreview.tailscale);
  printCheck("Private route", report.simulatorPreview.privateServe);
}

function displayAgentName(name) {
  if (name === "codex") return "Codex";
  if (name === "cursor") return "Cursor";
  if (name === "claude") return "Claude Code";
  if (name === "opencode") return "OpenCode";
  return name;
}

function printCheck(label, value) {
  const marker = value.ready ? "ready" : value.informational ? "info" : "needs-attention";
  console.log(`[${marker}] ${label}: ${value.detail}`);
}

function check(ready, detail, informational = false) {
  return { ready, informational, detail };
}

function agentCheck(detected, ready, detail) {
  return { detected, ready, informational: !detected, detail };
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
  if (process.env.SWIFT_SIM_DISABLE_CODEX === "1") return "";
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
  swift-sim setup                 Configure the helper and detected coding agents
  swift-sim doctor [--json]       Check install and optional Simulator setup
  swift-sim update                Update Homebrew and detected agent integrations
  swift-sim build-device ...      Build a signed iPhone install
  swift-sim live-status ...       Check remote on-device hot reload readiness
  swift-sim live-start ...        Launch the debug-only live patch engine
  swift-sim classify-change ...   Decide whether a Swift edit can hot reload
  swift-sim route-change ...      Choose hot reload or a new signed build
  swift-sim list-apps [--archived] List managed prototype apps and build history
  swift-sim verify-device-build    Verify an install on a reachable iPhone
  swift-sim archive-app ...        Archive or restore an app from the library
  swift-sim delete-app ...         Delete local app history and artifacts
  swift-sim start-session ...     Open a live Simulator session
  swift-sim pair ...              Pair optional Simulator diagnostics
  swift-sim serve                 Run the local helper in the foreground

iPhone app installs are the universal workflow and do not require Tailscale.
Remote hot reload is optional, debug-only, and falls back to a signed update link.
Live Simulator preview is optional and uses private Tailscale access.`);
}
