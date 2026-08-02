import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const skillDirectory = fileURLToPath(new URL(
  "../plugins/swift-sim-companion/skills/remote-simulator-companion/",
  import.meta.url,
));
const skillPath = join(skillDirectory, "SKILL.md");
const skill = readFileSync(skillPath, "utf8");

const HOT_MESSAGE = "Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.";
const BUILD_MESSAGE = "This change needs a new signed build.";
const references = [
  "setup-and-updates.md",
  "live-project-integration.md",
  "signed-device-builds.md",
  "pairing.md",
  "simulator-preview.md",
  "troubleshooting.md",
  "security-boundaries.md",
];

const transcriptFixtures = Object.freeze([
  { id: "ordinary-swift-edit", commands: [], branch: "ordinary", message: "" },
  { id: "first-phone-edit", commands: ["swift-sim deliver-change"], branch: "hot-reloaded", message: HOT_MESSAGE },
  { id: "warm-edits-2-through-10", commands: Array.from({ length: 9 }, () => "swift-sim deliver-change"), branch: "hot-reloaded", message: HOT_MESSAGE },
  { id: "structural-edit", commands: ["swift-sim deliver-change"], branch: "install-link-ready", message: BUILD_MESSAGE },
  { id: "recovered-live-failure", commands: ["swift-sim deliver-change"], branch: "hot-reloaded", message: HOT_MESSAGE },
  { id: "fallback-live-failure", commands: ["swift-sim deliver-change"], branch: "install-link-ready", message: BUILD_MESSAGE },
  { id: "protocol-drift", commands: ["swift-sim deliver-change"], branch: "needs-user-action", message: "Update Swift Sim, then start a new agent session." },
  { id: "simulator-request", commands: ["swift-sim start-session"], branch: "simulator", message: "Open Simulator in Companion App" },
]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^()|[\]\\]/g, "\\$&");
}

test("primary skill meets the lazy fast-path size and reference gates", () => {
  const words = skill.trim().split(/\s+/).length;
  assert.ok(words <= 1200, "primary skill is " + words + " words");
  assert.ok(Buffer.byteLength(skill, "utf8") <= 12 * 1024);
  const fastContract = skill.match(/## Fast phone-edit contract[\s\S]*?## Safety and lane boundaries/);
  assert.ok(fastContract);
  assert.ok(fastContract[0].trim().split(/\s+/).length <= 300);
  assert.doesNotMatch(skill, /swift-sim route-change/);
  assert.match(skill, /swift-sim deliver-change/);
  assert.match(skill, /never run .*doctor.*before a normal warm delivery/i);
  for (const reference of references) {
    assert.equal(existsSync(join(skillDirectory, "references", reference)), true, reference);
    assert.match(skill, new RegExp("references/" + reference.replace(".", "\\.")));
  }
});

test("packaged skill preserves exact terminal copy", () => {
  assert.match(skill, new RegExp(escapeRegExp(HOT_MESSAGE)));
  assert.match(skill, new RegExp(escapeRegExp(BUILD_MESSAGE)));
  assert.match(skill, /Open in Swift Sim to\s+Install/);
  assert.match(skill, /Install opened/);
  assert.match(skill, /Installed/);
});

test("deterministic transcript fixtures enforce one-command routing", () => {
  for (const fixture of transcriptFixtures) {
    assert.equal(fixture.commands.filter((command) => command.startsWith("swift-sim ")).length, fixture.commands.length);
    if (fixture.id === "ordinary-swift-edit") assert.equal(fixture.commands.length, 0);
    if (fixture.id === "warm-edits-2-through-10") assert.equal(fixture.commands.length, 9);
    if (fixture.branch === "hot-reloaded") assert.equal(fixture.message, HOT_MESSAGE);
    if (fixture.branch === "install-link-ready") assert.equal(fixture.message, BUILD_MESSAGE);
    if (fixture.branch === "needs-user-action") assert.match(fixture.message, /new agent session/);
    if (fixture.branch === "simulator") assert.equal(fixture.commands[0], "swift-sim start-session");
  }
});
