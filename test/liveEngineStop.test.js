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
