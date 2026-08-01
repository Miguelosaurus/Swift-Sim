import test from "node:test";
import assert from "node:assert/strict";
import { ServeSimAdapter } from "../mac-helper/src/serveSimAdapter.js";

test("serve-sim process deadline kills a command that ignores SIGTERM", async () => {
  const adapter = new ServeSimAdapter({
    command: process.execPath,
    commandTimeoutMs: 75,
    forceKillDelayMs: 50,
  });
  const startedAt = Date.now();
  await assert.rejects(
    adapter.run([
      "-e",
      "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)",
    ]),
    /timed out after 75ms/,
  );
  assert.ok(Date.now() - startedAt < 2_000);
});

test("serve-sim kill uses its shorter explicit deadline", async () => {
  class RecordingAdapter extends ServeSimAdapter {
    calls = [];
    async run(args, options) {
      this.calls.push({ args, options });
      return { code: 0, stdout: "", stderr: "" };
    }
  }
  const adapter = new RecordingAdapter({
    command: "serve-sim",
    commandTimeoutMs: 30_000,
    killTimeoutMs: 1_234,
  });
  await adapter.kill("SIM-R4-KILL-DEADLINE");
  assert.deepEqual(adapter.calls, [{
    args: ["--kill", "SIM-R4-KILL-DEADLINE"],
    options: { allowFailure: true, timeoutMs: 1_234 },
  }]);
});

test("serve-sim timeout keeps force-kill cleanup armed after leader exit", async () => {
  const adapter = new ServeSimAdapter({
    command: process.execPath,
    commandTimeoutMs: 75,
    forceKillDelayMs: 100,
  });
  const startedAt = Date.now();
  await assert.rejects(
    adapter.run([
      "-e",
      "process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)",
    ], { allowFailure: true, timeoutMs: 75 }),
    /timed out after 75ms/,
  );
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 150);
  assert.ok(elapsed < 2_000);
});
