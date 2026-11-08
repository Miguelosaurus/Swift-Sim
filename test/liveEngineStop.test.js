import { readStateBytes } from "./fixtures/state-bytes.js";
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { stopLiveEngineProcess } from "../mac-helper/src/liveReload.js";

async function child(t, ignore) {
  const process = spawn(globalThis.process.execPath, ["-e", `${ignore ? "process.on('SIGTERM',()=>{});" : ""}console.log('ready');setInterval(()=>{},1000);`], { stdio: ["ignore", "pipe", "pipe"] });
  await once(process.stdout, "data");
  t.after(async () => {
    if (process.exitCode === null && process.signalCode === null) {
      const done = once(process, "exit"); process.kill("SIGKILL"); await done;
    }
  });
  return process;
}

test("engine handoff waits for actual process exit after graceful termination", async t => {
  const process = await child(t, false);
  await stopLiveEngineProcess(process.pid);
  assert.throws(() => globalThis.process.kill(process.pid, 0), { code: "ESRCH" });
});
test("engine handoff fails closed when graceful termination leaves the old listener alive", async t => {
  const process = await child(t, true);
  await assert.rejects(stopLiveEngineProcess(process.pid, { timeoutMs: 100 }), { code: "LIVE_ENGINE_STOP_UNCONFIRMED" });
  assert.doesNotThrow(() => globalThis.process.kill(process.pid, 0), "handoff never escalates against an unconfirmed owner");
});
test("engine ownership refusal propagates rather than allowing installation to advance", async () => {
  let attempts = 0;
  await assert.rejects(stopLiveEngineProcess(123, { kill() { attempts++; throw Object.assign(new Error("unverified owner"), { code: "EPERM" }); } }), { code: "EPERM" });
  assert.equal(attempts, 1);
});

test("unparsed ownership record preserves engine evidence and never permits replacement cleanup", async t => {
  const { mkdtempSync, writeFileSync, rmSync, existsSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { stopLiveEngine } = await import("../mac-helper/src/liveReload.js");
  const root = mkdtempSync(join(tmpdir(), "swift-sim-engine-stop-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const paths = { pidPath: join(root, "engine.pid"), sessionPath: join(root, "session.json"), socketPath: join(root, "engine.sock") };
  let stops = 0;
  for (const raw of [JSON.stringify({ version: 2, pid: 123, startToken: "owned" }), "", "garbage", "0", "1", "9007199254740993"]) {
    writeFileSync(paths.pidPath, raw); writeFileSync(paths.sessionPath, "session"); writeFileSync(paths.socketPath, "socket-marker");
    await assert.rejects(stopLiveEngine({ ...paths, stop: async () => { stops++; } }), { code: "LIVE_ENGINE_OWNERSHIP_UNCONFIRMED" });
    assert.equal(readStateBytes(paths.pidPath).toString("utf8"), raw);
    assert.equal(readStateBytes(paths.sessionPath).toString("utf8"), "session");
    assert.equal(readStateBytes(paths.socketPath).toString("utf8"), "socket-marker");
  }
  assert.equal(stops, 0);
  writeFileSync(paths.pidPath, "123\n");
  await assert.rejects(stopLiveEngine({ ...paths, stop: async () => { throw new Error("still running"); } }), /still running/);
  assert.ok(Object.values(paths).every(existsSync));
  await stopLiveEngine({ ...paths, stop: async pid => { assert.equal(pid, 123); stops++; } });
  assert.equal(stops, 1);
  assert.ok(Object.values(paths).every(path => !existsSync(path)));
});
