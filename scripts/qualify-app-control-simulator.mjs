#!/usr/bin/env node
// Development-only qualification of an optional, stock automation provider.
// This is not installed in Swift Sim, its helper, or the Debug app SDK.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const { values } = parseArgs({ options: {
  provider: { type: "string" }, simulator: { type: "string" },
  "runner-cache": { type: "string" }, output: { type: "string" },
  help: { type: "boolean" },
} });
if (values.help) {
  console.log("node scripts/qualify-app-control-simulator.mjs --provider <agent-device-package> --simulator <booted-udid> --runner-cache <task-cache> --output <new-directory>");
  process.exit(0);
}
for (const key of ["provider", "simulator", "runner-cache", "output"]) {
  assert(values[key], `Pass --${key}; no device or provider is selected implicitly.`);
}
const inventory = JSON.parse(execFileSync("xcrun", ["simctl", "list", "devices", "booted", "--json"], { encoding: "utf8" }));
assert(Object.values(inventory.devices).flat().some(device =>
  device.udid === values.simulator && device.state === "Booted"),
"The explicit target must already be a booted Simulator. Physical devices are refused.");
const provider = resolve(values.provider);
const metadata = JSON.parse(readFileSync(join(provider, "package.json"), "utf8"));
assert.equal(metadata.name, "agent-device");
assert.equal(metadata.version, "0.21.36",
  "This qualification pins agent-device 0.21.36; qualify a changed version separately.");
const output = resolve(values.output);
mkdirSync(output, { mode: 0o700 }); // Refuse to overwrite a previous run.
const stateDir = mkdtempSync(join(tmpdir(), "swift-sim-ui-check-"));
const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("AGENT_DEVICE_")));
Object.assign(environment, {
  AGENT_DEVICE_NO_UPDATE_NOTIFIER: "1",
  AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET: join(homedir(), "Library/Developer/CoreSimulator/Devices"),
  AGENT_DEVICE_IOS_RUNNER_DERIVED_PATH: resolve(values["runner-cache"]),
});
const selection = { platform: "ios", udid: values.simulator,
  iosSimulatorDeviceSet: environment.AGENT_DEVICE_IOS_SIMULATOR_DEVICE_SET };
const report = { provider: "agent-device", version: "0.21.36", target: "simulator", checks: [], passed: false };
let runtime;
let sessionOpened = false;
let failure;
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const resources = { owner: "Swift Sim simulator app-control qualification", processId: process.pid,
  simulatorId: values.simulator, stateDir, runnerCache: resolve(values["runner-cache"]), released: false };
save("resources.json", resources);
const ref = node => {
  assert(node?.ref, "Expected a semantic control in the current snapshot.");
  return node.ref.startsWith("@") ? node.ref : `@${node.ref}`;
};
try {
  const { startAgentDevice } = await import(pathToFileURL(join(provider, "dist/src/index.js")).href);
  runtime = await startAgentDevice({ stateDir, host: { cwd: output, env: environment } });
  const client = runtime.client;
  const snapshot = async name => {
    const value = await client.capture.snapshot({ ...selection, interactiveOnly: true, timeoutMs: 20000 });
    assert.equal(value.appBundleId, "com.apple.Preferences");
    assert(!value.truncated, "A truncated snapshot cannot prove this check.");
    save(`${name}.json`, { app: value.appBundleId, nodes: value.nodes });
    return value.nodes;
  };
  const press = node => client.interactions.press({ ...selection, ref: ref(node), settle: true, timeoutMs: 10000 });
  await client.apps.open({ ...selection, app: "com.apple.Preferences", foreground: true, timeoutMs: 120000 });
  sessionOpened = true;
  let nodes = await snapshot("initial");
  report.checks.push("native-screen-read");
  await press(nodes.find(node => node.type === "SearchField"));
  nodes = await snapshot("search-open");
  assert(nodes.some(node => node.type === "Button" && node.label === "close"), "Search did not open.");
  report.checks.push("semantic-tap");
  const text = "Swift Sim automation check";
  await client.interactions.fill({ ...selection, ref: ref(nodes.find(node => node.type === "SearchField")),
    text, settle: true, timeoutMs: 10000 });
  nodes = await snapshot("text-entered");
  assert(nodes.some(node => node.type === "SearchField" && node.value === text), "Text entry was not observed.");
  report.checks.push("text-entry-read-back");
  await press(nodes.find(node => node.type === "Button" && node.label === "close"));
  const before = await snapshot("search-closed");
  await client.interactions.scroll({ ...selection, direction: "down", pixels: 450, settle: true, timeoutMs: 10000 });
  nodes = await snapshot("scrolled");
  const signature = list => JSON.stringify(list.filter(node => node.type === "Cell").map(node => [node.identifier, node.label, node.rect]));
  assert.notEqual(signature(nodes), signature(before), "Scrolling did not visibly change the native list.");
  report.checks.push("scroll-observed");
  await client.capture.screenshot({ ...selection, path: join(output, "simulator.png") });
  assert(statSync(join(output, "simulator.png")).size > 0, "Screenshot artifact is empty.");
  report.checks.push("screenshot");
} catch (error) {
  failure = error;
  report.error = error.message;
} finally {
  if (runtime) {
    if (sessionOpened) {
      try { await runtime.client.sessions.close(); }
      catch (error) { failure ||= error; report.sessionCloseError = error.message; }
    }
    try {
      const shutdown = await runtime.close();
      save("shutdown.json", shutdown);
      assert.equal(shutdown.platformOwners, "closed", "Provider teardown did not finish.");
      assert.equal(shutdown.runners.handedOff.length, 0, "A runner was left behind.");
      report.checks.push("provider-teardown");
      rmSync(stateDir, { recursive: true }); // Only the directory this run created.
      resources.released = true;
      save("resources.json", resources);
    } catch (error) { failure ||= error; report.shutdownError = error.message; }
  }
  report.passed = !failure;
  save("result.json", report);
}
console.log(JSON.stringify(report, null, 2));
if (failure) process.exitCode = 1;
