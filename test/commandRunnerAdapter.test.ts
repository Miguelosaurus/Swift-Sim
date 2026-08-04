import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { NodeCommandRunner } from "../mac-helper/src/infrastructure/nodeCommandRunner.js";
import type { CommandRequest } from "../mac-helper/src/infrastructure/ports.js";

const runner = new NodeCommandRunner();

function request(
  source: string,
  overrides: Partial<CommandRequest> & {
    policy?: Partial<CommandRequest["policy"]>;
  } = {},
): CommandRequest {
  return {
    executable: process.execPath,
    args: ["-e", source],
    environment: {
      inherit: [],
      overrides: {},
      unset: [],
    },
    policy: {
      timeoutMs: 5_000,
      outputLimitBytes: 64 * 1024,
      processGroup: "new",
      acceptedExitCodes: [0],
      ...overrides.policy,
    },
    ...overrides,
  };
}

test("NodeCommandRunner applies explicit environment policy and accepted exit codes", async (t) => {
  const visibleName = "SWIFT_SIM_COMMAND_VISIBLE";
  const secretName = "SWIFT_SIM_COMMAND_SECRET";
  const previousVisible = process.env[visibleName];
  const previousSecret = process.env[secretName];
  process.env[visibleName] = "inherited";
  process.env[secretName] = "must-not-inherit";
  t.after(() => {
    restoreEnvironment(visibleName, previousVisible);
    restoreEnvironment(secretName, previousSecret);
  });

  const result = await runner.run(
    request(
      `process.stdout.write(JSON.stringify(process.env)); process.exit(7);`,
      {
        environment: {
          inherit: [visibleName, secretName],
          overrides: { [visibleName]: "overridden", EXTRA: "set", REMOVE: undefined },
          unset: [secretName, "REMOVE"],
        },
        policy: { acceptedExitCodes: [7] },
      },
    ),
  );

  assert.equal(result.code, 7);
  assert.equal(result.error, undefined);
  assert.deepEqual(JSON.parse(result.stdout), {
    [visibleName]: "overridden",
    EXTRA: "set",
  });

  const synchronous = runner.runSync(
    request(`process.stdout.write("sync"); process.exit(7);`, {
      policy: { acceptedExitCodes: [7], processGroup: "inherit" },
    }),
  );
  assert.equal(synchronous.code, 7);
  assert.equal(synchronous.stdout, "sync");
  assert.equal(synchronous.error, undefined);
});

test("NodeCommandRunner fails closed for cancellation signals", async () => {
  const alreadyCancelled = new AbortController();
  alreadyCancelled.abort();
  const beforeStart = await runner.run(
    request(`setInterval(() => {}, 1_000);`, {
      cancellationSignal: alreadyCancelled.signal,
    }),
  );
  assert.equal(beforeStart.cancellationError?.code, "ABORT_ERR");

  const controller = new AbortController();
  const running = runner.run(
    request(descendantFixture(), {
      cancellationSignal: controller.signal,
    }),
  );
  setTimeout(() => controller.abort(), 500);
  const cancelled = await running;
  assert.equal(cancelled.cancellationError?.code, "ABORT_ERR");
  assert.equal(cancelled.code, null);
  assert.equal(processIsAlive(descendantPID(cancelled.stdout)), false);

  const synchronous = runner.runSync(
    request(`process.exit(0);`, {
      cancellationSignal: new AbortController().signal,
      policy: { processGroup: "inherit" },
    }),
  );
  assert.match(synchronous.error ?? "", /cannot observe a cancellation signal/);
});

test("NodeCommandRunner terminates timed-out groups and their descendants", async () => {
  const result = await runner.run(
    request(descendantFixture(), {
      policy: { timeoutMs: 500 },
    }),
  );
  assert.equal(result.timedOut, true);
  assert.match(result.error ?? "", /timed out/);
  assert.equal(processIsAlive(descendantPID(result.stdout)), false);
});

test("NodeCommandRunner bounds output and terminates the producer", async () => {
  const result = await runner.run(
    request(`process.stdout.write("x".repeat(1024 * 1024)); setInterval(() => {}, 1_000);`, {
      policy: { outputLimitBytes: 1_024 },
    }),
  );
  assert.match(result.error ?? "", /exceeded the 1024-byte output limit/);
  assert.ok(Buffer.byteLength(result.stdout) <= 1_024);
});

test("NodeCommandRunner rejects a successful parent with lingering descendants", async () => {
  const result = await runner.run(
    request(`
      const { spawn } = require("node:child_process");
      const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      process.stdout.write(String(child.pid));
      child.unref();
    `),
  );
  assert.match(result.error ?? "", /descendant processes were still running/);
  assert.equal(processIsAlive(descendantPID(result.stdout)), false);
});

function descendantFixture(): string {
  return `
    const { spawn } = require("node:child_process");
    const child = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    process.stdout.write(String(child.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  `;
}

function descendantPID(stdout: string): number {
  const pid = Number(stdout.trim());
  assert.ok(Number.isInteger(pid) && pid > 1, `missing descendant PID in output: ${stdout}`);
  return pid;
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const status = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });
  if (status.status !== 0) return false;
  return !String(status.stdout || "").trim().startsWith("Z");
}

function restoreEnvironment(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
