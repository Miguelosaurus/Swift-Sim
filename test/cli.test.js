import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const cli = new URL("../mac-helper/bin/swift-sim.js", import.meta.url);
const packageJSON = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));

test("swift-sim exposes the packaged version and install-first help", () => {
  const version = spawnSync(process.execPath, [cli.pathname, "version"], { encoding: "utf8" });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), packageJSON.version);

  const help = spawnSync(process.execPath, [cli.pathname, "help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /iPhone app installs are the primary workflow/);
  assert.match(help.stdout, /Live Simulator preview is optional/);
});

test("bundled marketplace points at the packaged Swift Sim plugin", () => {
  const marketplace = JSON.parse(readFileSync(new URL("../.agents/plugins/marketplace.json", import.meta.url)));
  assert.equal(marketplace.name, "swift-sim");
  assert.equal(marketplace.plugins[0].name, "swift-sim-companion");
  assert.equal(marketplace.plugins[0].source.path, "./plugins/swift-sim-companion");
});
