import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../mac-helper/bin/swift-sim.js", import.meta.url);
const packageJSON = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

test("swift-sim exposes the packaged version and install-first help", () => {
  const version = spawnSync(process.execPath, [cli.pathname, "version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), packageJSON.version);

  const help = spawnSync(process.execPath, [cli.pathname, "help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /iPhone app installs are the universal workflow/);
  assert.match(help.stdout, /Live Simulator preview is optional/);
  assert.match(help.stdout, /Remote hot reload is optional, debug-only/);
  assert.match(help.stdout, /route-change/);
  assert.match(help.stdout, /detected coding agents/);
});

test("bundled marketplaces point at one shared Swift Sim plugin", () => {
  const codex = readJSON("../.agents/plugins/marketplace.json");
  const cursor = readJSON("../.cursor-plugin/marketplace.json");
  const claude = readJSON("../.claude-plugin/marketplace.json");

  assert.equal(codex.name, "swift-sim");
  assert.equal(cursor.name, "swift-sim");
  assert.equal(claude.name, "swift-sim");
  assert.equal(codex.plugins[0].name, "swift-sim-companion");
  assert.equal(cursor.plugins[0].name, "swift-sim-companion");
  assert.equal(claude.plugins[0].name, "swift-sim-companion");
  assert.equal(codex.plugins[0].source.path, "./plugins/swift-sim-companion");
  assert.equal(cursor.plugins[0].source, "./plugins/swift-sim-companion");
  assert.equal(claude.plugins[0].source, "./plugins/swift-sim-companion");
});

test("Codex, Cursor, Claude, and OpenCode use the same packaged skill", () => {
  const codex = readJSON("../plugins/swift-sim-companion/.codex-plugin/plugin.json");
  const cursor = readJSON("../plugins/swift-sim-companion/.cursor-plugin/plugin.json");
  const claude = readJSON("../plugins/swift-sim-companion/.claude-plugin/plugin.json");
  const packageVersion = packageJSON.version;

  assert.equal(codex.name, "swift-sim-companion");
  assert.equal(cursor.name, codex.name);
  assert.equal(claude.name, codex.name);
  assert.equal(codex.skills, "./skills/");
  assert.equal(cursor.skills, "./skills/");
  assert.equal(claude.skills, "./skills/");
  assert.equal(cursor.version, packageVersion);
  assert.equal(claude.version, packageVersion);
  assert.equal(codex.version.split("+")[0], packageVersion);
  assert.equal(codex.interface.displayName, "Swift Sim");
  assert.equal(codex.interface.logo, "./assets/icon.png");
});

test("Homebrew packages every agent marketplace", () => {
  const formula = readFileSync(new URL("../packaging/homebrew/swift-sim.rb.template", import.meta.url), "utf8");
  assert.match(formula, /"\.agents", "\.claude-plugin", "\.cursor-plugin"/);
});

test("release versions and public plugin metadata stay synchronized", () => {
  const project = readFileSync(new URL("../Companion/SwiftSimCompanion.xcodeproj/project.pbxproj", import.meta.url), "utf8");
  const codex = readJSON("../plugins/swift-sim-companion/.codex-plugin/plugin.json");
  const cursor = readJSON("../plugins/swift-sim-companion/.cursor-plugin/plugin.json");
  const claude = readJSON("../plugins/swift-sim-companion/.claude-plugin/plugin.json");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

  assert.match(project, new RegExp(`MARKETING_VERSION = ${packageJSON.version.replaceAll(".", "\\.")};`));
  assert.equal(cursor.version, packageJSON.version);
  assert.equal(claude.version, packageJSON.version);
  assert.equal(codex.version.split("+")[0], packageJSON.version);
  assert.match(codex.homepage, /^https:\/\//);
  assert.match(codex.interface.privacyPolicyURL, /^https:\/\//);
  assert.equal(existsSync(new URL(`../plugins/swift-sim-companion/${codex.interface.logo}`, import.meta.url)), true);
  assert.doesNotMatch(JSON.stringify(codex), /local@example\.com/);
  assert.match(readme, /https:\/\/testflight\.apple\.com\/join\/HMUUFYNK/);
});

test("shared skill supports every mobile-capable local agent", () => {
  const skill = readFileSync(new URL("../plugins/swift-sim-companion/skills/remote-simulator-companion/SKILL.md", import.meta.url), "utf8");
  const references = readFileSync(new URL("../plugins/swift-sim-companion/skills/remote-simulator-companion/references/setup-and-updates.md", import.meta.url), "utf8")
    + readFileSync(new URL("../plugins/swift-sim-companion/skills/remote-simulator-companion/references/simulator-preview.md", import.meta.url), "utf8");
  assert.match(skill, /Codex, Cursor, Claude Code, or OpenCode/);
  assert.match(skill, /OpenCode/);
  assert.match(references, /Cursor/);
  assert.match(references, /Claude Code/);
  assert.match(references, /OpenCode/);
  assert.doesNotMatch(skill, /Codex remains the only coding agent/);
});

test("setup installs the bundled Codex marketplace and plugin", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-codex-"));
  const fakeCodex = new URL("./fixtures/fake-codex", import.meta.url).pathname;
  chmodSync(fakeCodex, 0o755);
  try {
    const setup = spawnSync(process.execPath, [cli.pathname, "setup", "--skip-service", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...isolatedCliEnvironment(directory),
        FAKE_CODEX_STATE: join(directory, "state"),
        SWIFT_SIM_CODEX_COMMAND: fakeCodex,
        SWIFT_SIM_DISABLE_CURSOR: "1",
        SWIFT_SIM_DISABLE_CLAUDE: "1",
        SWIFT_SIM_DISABLE_OPENCODE: "1",
        SWIFT_SIM_MARKETPLACE_ROOT: new URL("../", import.meta.url).pathname,
      },
    });
    assert.equal(setup.status, 0, setup.stderr);
    const report = JSON.parse(setup.stdout);
    assert.equal(report.deviceInstalls.agents.codex.ready, true);
    assert.equal(report.actions.find((action) => action.id === "codex")?.state, "configured");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("doctor reports stale Codex and Claude integrations", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-stale-agents-"));
  const fakeCodex = new URL("./fixtures/fake-codex", import.meta.url).pathname;
  const fakeClaude = new URL("./fixtures/fake-claude", import.meta.url).pathname;
  chmodSync(fakeCodex, 0o755);
  chmodSync(fakeClaude, 0o755);
  try {
    const codexState = join(directory, "codex");
    const claudeState = join(directory, "claude");
    writeFileSync(`${codexState}.plugin`, "ready\n");
    writeFileSync(`${claudeState}.plugin`, "ready\n");

    const doctor = spawnSync(process.execPath, [cli.pathname, "doctor", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...isolatedCliEnvironment(directory),
        FAKE_CODEX_STATE: codexState,
        FAKE_CLAUDE_STATE: claudeState,
        FAKE_CODEX_PLUGIN_VERSION: "0.1.0",
        FAKE_CLAUDE_PLUGIN_VERSION: "0.1.0",
        SWIFT_SIM_CODEX_COMMAND: fakeCodex,
        SWIFT_SIM_CLAUDE_COMMAND: fakeClaude,
        SWIFT_SIM_DISABLE_CURSOR: "1",
        SWIFT_SIM_DISABLE_OPENCODE: "1",
      },
    });
    assert.equal(doctor.status, 0, doctor.stderr);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.deviceInstalls.agents.codex.ready, false);
    assert.match(report.deviceInstalls.agents.codex.detail, /does not match/);
    assert.equal(report.deviceInstalls.agents.claude.ready, false);
    assert.match(report.deviceInstalls.agents.claude.detail, /does not match/);
    assert.equal(report.storage.artifacts.available, true);
    assert.equal(report.storage.artifacts.informational, true);
    assert.equal(report.storage.artifacts.cleanupEnabled, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setup installs the bundled Cursor skill", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cursor-"));
  try {
    const setup = spawnSync(process.execPath, [cli.pathname, "setup", "--skip-service", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...isolatedCliEnvironment(directory),
        SWIFT_SIM_CURSOR_COMMAND: "/usr/bin/true",
        SWIFT_SIM_CURSOR_SKILL_HOME: directory,
        SWIFT_SIM_DISABLE_CODEX: "1",
        SWIFT_SIM_DISABLE_CLAUDE: "1",
        SWIFT_SIM_DISABLE_OPENCODE: "1",
        SWIFT_SIM_MARKETPLACE_ROOT: new URL("../", import.meta.url).pathname,
      },
    });
    assert.equal(setup.status, 0, setup.stderr);
    const report = JSON.parse(setup.stdout);
    assert.equal(report.deviceInstalls.agents.cursor.ready, true);
    assert.equal(report.actions.find((action) => action.id === "cursor")?.state, "configured");
    assert.equal(
      readFileSync(join(directory, "remote-simulator-companion", ".swift-sim-version"), "utf8").trim(),
      packageJSON.version
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setup installs the bundled Claude Code marketplace and plugin", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-claude-"));
  const fakeClaude = new URL("./fixtures/fake-claude", import.meta.url).pathname;
  chmodSync(fakeClaude, 0o755);
  try {
    const setup = spawnSync(process.execPath, [cli.pathname, "setup", "--skip-service", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...isolatedCliEnvironment(directory),
        FAKE_CLAUDE_STATE: join(directory, "state"),
        SWIFT_SIM_CLAUDE_COMMAND: fakeClaude,
        SWIFT_SIM_DISABLE_CODEX: "1",
        SWIFT_SIM_DISABLE_CURSOR: "1",
        SWIFT_SIM_DISABLE_OPENCODE: "1",
        SWIFT_SIM_MARKETPLACE_ROOT: new URL("../", import.meta.url).pathname,
      },
    });
    assert.equal(setup.status, 0, setup.stderr);
    const report = JSON.parse(setup.stdout);
    assert.equal(report.deviceInstalls.agents.claude.ready, true);
    assert.equal(report.actions.find((action) => action.id === "claude")?.state, "configured");
    assert.equal(report.actions.find((action) => action.id === "codex")?.state, "not-detected");
    assert.equal(report.actions.find((action) => action.id === "cursor")?.state, "not-detected");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("setup installs the bundled OpenCode skill", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-opencode-"));
  try {
    const setup = spawnSync(process.execPath, [cli.pathname, "setup", "--skip-service", "--json"], {
      encoding: "utf8",
      timeout: 20_000,
      env: {
        ...isolatedCliEnvironment(directory),
        SWIFT_SIM_OPENCODE_COMMAND: "/usr/bin/true",
        SWIFT_SIM_OPENCODE_CONFIG_HOME: directory,
        SWIFT_SIM_DISABLE_CODEX: "1",
        SWIFT_SIM_DISABLE_CURSOR: "1",
        SWIFT_SIM_DISABLE_CLAUDE: "1",
        SWIFT_SIM_MARKETPLACE_ROOT: new URL("../", import.meta.url).pathname,
      },
    });
    assert.equal(setup.status, 0, setup.stderr);
    const report = JSON.parse(setup.stdout);
    assert.equal(report.deviceInstalls.agents.opencode.ready, true);
    assert.equal(report.actions.find((action) => action.id === "opencode")?.state, "configured");
    assert.equal(
      readFileSync(join(directory, "skills", "remote-simulator-companion", ".swift-sim-version"), "utf8").trim(),
      packageJSON.version
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function readJSON(path) {
  return JSON.parse(readFileSync(new URL(path, import.meta.url)));
}


test("notification CLI configures private credentials, reports sanitized state and disables sends", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-notifications-cli-"));
  try {
    const env = isolatedCliEnvironment(directory);
    const keyPath = join(directory, "AuthKey-fixture.p8");
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const run = (...args) => spawnSync(process.execPath, [cli.pathname, "notifications", ...args], { encoding: "utf8", env, timeout: 20_000 });
    const initial = run("status");
    assert.equal(initial.status, 0, initial.stderr);
    assert.deepEqual(JSON.parse(initial.stdout), { configured: false, reason: "APNS_NOT_CONFIGURED" });
    const configure = run("configure", "--key-file", keyPath, "--key-id", "ABCDEFGHIJ", "--team-id", "KLMNOPQRST", "--topic", "dev.fixture.Companion");
    assert.equal(configure.status, 0, configure.stderr);
    assert.equal(JSON.parse(configure.stdout).configured, true);
    const status = run("status");
    assert.equal(status.status, 0, status.stderr);
    assert.deepEqual(JSON.parse(status.stdout), { configured: true });
    assert.doesNotMatch(configure.stdout + status.stdout, /BEGIN PRIVATE KEY|AuthKey-fixture|ABCDEFGHIJ|KLMNOPQRST|dev.fixture.Companion/);
    const disable = run("disable");
    assert.equal(disable.status, 0, disable.stderr);
    assert.deepEqual(JSON.parse(disable.stdout), { configured: false, reason: "APNS_DISABLED" });
    assert.deepEqual(JSON.parse(run("status").stdout), { configured: false, reason: "APNS_DISABLED" });
    assert.equal(run("configure", "--unknown", "secret").status, 1);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function isolatedCliEnvironment(directory) {
  const isolatedHome = join(directory, "home");
  const engine = join(isolatedHome, ".swift-sim", "engine");
  const executableDirectory = join(engine, "InjectionNext.app", "Contents", "MacOS");
  mkdirSync(executableDirectory, { recursive: true });
  writeFileSync(join(executableDirectory, "InjectionNext"), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  writeFileSync(join(engine, "manifest.json"), JSON.stringify({ version: "0.4.0", sha256: "17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696" }), { mode: 0o600 });
  const fixture = new URL("./fixtures/cli-isolation-preload.js", import.meta.url).href;
  return { ...process.env, HOME: isolatedHome, XDG_CONFIG_HOME: join(directory, "config"), NODE_OPTIONS: `--import=${fixture}` };
}
