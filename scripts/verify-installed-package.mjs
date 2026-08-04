#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const packageRoot = resolve(process.argv[2] || "");
if (!packageRoot || !existsSync(join(packageRoot, "dist", "mac-helper", "bin", "swift-sim-entry.js"))) {
  throw new Error(`Expected an installed Swift Sim package root, got ${packageRoot}`);
}

const root = mkdtempSync(join(tmpdir(), "swift-sim-installed-package-"));
const isolatedHome = join(root, "home");
const cursorHome = join(root, "cursor-skills");
const openCodeHome = join(root, "opencode");
const fakeBin = join(root, "bin");
mkdirSync(isolatedHome, { recursive: true });
mkdirSync(fakeBin, { recursive: true });

const codexState = join(root, "codex");
const claudeState = join(root, "claude");
const env = {
  ...process.env,
  HOME: isolatedHome,
  XDG_CONFIG_HOME: join(root, "config"),
  SWIFT_SIM_CURSOR_COMMAND: "/usr/bin/true",
  SWIFT_SIM_CURSOR_SKILL_HOME: cursorHome,
  SWIFT_SIM_OPENCODE_COMMAND: "/usr/bin/true",
  SWIFT_SIM_OPENCODE_CONFIG_HOME: openCodeHome,
};
const fakeCodex = writeFake("codex", fakeCodexSource(), { FAKE_CODEX_STATE: codexState });
const fakeClaude = writeFake("claude", fakeClaudeSource(), { FAKE_CLAUDE_STATE: claudeState });
env.SWIFT_SIM_CODEX_COMMAND = fakeCodex;
env.SWIFT_SIM_CLAUDE_COMMAND = fakeClaude;
delete env.SWIFT_SIM_MARKETPLACE_ROOT;

const engine = join(isolatedHome, ".swift-sim", "engine");
const executable = join(engine, "InjectionNext.app", "Contents", "MacOS", "InjectionNext");
mkdirSync(dirname(executable), { recursive: true });
writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o700 });
writeFileSync(join(engine, "manifest.json"), JSON.stringify({
  version: "0.4.0",
  sha256: "17932eb4d59d8c5d97f76bc46a97898997c96e2efbd740e045ea65c0e2b01696",
}));

const entry = join(packageRoot, "dist", "mac-helper", "bin", "swift-sim-entry.js");
const setup = run(entry, ["setup", "--skip-service", "--json"]);
assert.equal(setup.status, 0, setup.stderr);
const setupReport = JSON.parse(setup.stdout);
const codexMarketplacePath = readFileSync(`${codexState}.marketplace`, "utf8").trim();
const claudeMarketplace = JSON.parse(readFileSync(`${claudeState}.marketplace`, "utf8"));
assert.equal(realpathSync(codexMarketplacePath), realpathSync(packageRoot));
assert.equal(realpathSync(claudeMarketplace.path), realpathSync(packageRoot));
assert.equal(readFileSync(join(cursorHome, "remote-simulator-companion", ".swift-sim-version"), "utf8").trim(), "0.6.1");
assert.equal(readFileSync(join(openCodeHome, "skills", "remote-simulator-companion", ".swift-sim-version"), "utf8").trim(), "0.6.1");
assert.ok(setupReport.actions.some((action) => action.id === "cursor" && action.state === "configured"));
assert.ok(existsSync(join(packageRoot, "plugins", "swift-sim-companion", "skills", "remote-simulator-companion", "SKILL.md")));
assert.equal(existsSync(join(packageRoot, "mac-helper", "src")), false);

const doctor = run(entry, ["doctor", "--json"]);
assert.equal(doctor.status, 0, doctor.stderr);
const doctorReport = JSON.parse(doctor.stdout);
assert.equal(doctorReport.version, "0.6.1");
assert.equal(doctorReport.deviceInstalls.agents.codex.ready, true);
assert.equal(doctorReport.deviceInstalls.agents.claude.ready, true);
assert.equal(doctorReport.deviceInstalls.agents.cursor.ready, true);
assert.equal(doctorReport.deviceInstalls.agents.opencode.ready, true);

console.log("Verified isolated installed-package setup, doctor, marketplace, and skill paths");

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env });
}

function writeFake(name, source, extraEnv) {
  const path = join(fakeBin, name);
  writeFileSync(path, source, { mode: 0o700 });
  Object.assign(env, extraEnv);
  return path;
}

function fakeCodexSource() {
  return `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const state = process.env.FAKE_CODEX_STATE;
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("codex 1.0.0");
else if (args === "plugin marketplace list") console.log(existsSync(state + ".marketplace") ? "swift-sim " + readFileSync(state + ".marketplace", "utf8").trim() : "");
else if (args.startsWith("plugin marketplace add ")) writeFileSync(state + ".marketplace", process.argv.at(-1));
else if (args.startsWith("plugin marketplace remove ") || args.startsWith("plugin remove ")) {}
else if (args === "plugin list") console.log(existsSync(state + ".plugin") ? "swift-sim-companion@swift-sim installed, enabled  0.6.1" : "");
else if (args.startsWith("plugin add ")) writeFileSync(state + ".plugin", "ready");
else process.exit(2);
`;
}

function fakeClaudeSource() {
  return `#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
const state = process.env.FAKE_CLAUDE_STATE;
const args = process.argv.slice(2).join(" ");
if (args === "--version") console.log("claude 2.1.200");
else if (args === "plugin marketplace list --json") console.log(JSON.stringify(existsSync(state + ".marketplace") ? [{ name: "swift-sim", source: "directory", path: JSON.parse(readFileSync(state + ".marketplace", "utf8")).path }] : []));
else if (args.startsWith("plugin marketplace add ")) writeFileSync(state + ".marketplace", JSON.stringify({ path: process.argv[5] }));
else if (args.startsWith("plugin marketplace update ")) process.exit(existsSync(state + ".marketplace") ? 0 : 1);
else if (args.startsWith("plugin marketplace remove ")) {}
else if (args === "plugin list --json") console.log(JSON.stringify(existsSync(state + ".plugin") ? [{ id: "swift-sim-companion@swift-sim", version: "0.6.1", enabled: true }] : []));
else if (args.startsWith("plugin install ") || args.startsWith("plugin update ") || args.startsWith("plugin enable ")) writeFileSync(state + ".plugin", "ready");
else process.exit(2);
`;
}
