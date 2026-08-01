import test from "node:test";
import assert from "node:assert/strict";
import "../mac-helper/src/ownedWorkerPreload.js";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { spawn } = await import("node:child_process");

test("owned workers wait for the durable journal handshake", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-worker-handshake-"));
  try {
    const executable = join(directory, "xcodebuild");
    const marker = join(directory, "ran");
    const workerPath = join(directory, "cancel.worker.json");
    writeFileSync(executable, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
    chmodSync(executable, 0o700);

    const child = spawn(executable, [], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    await sleep(150);
    assert.equal(existsSync(marker), false);

    writeFileSync(workerPath, JSON.stringify({
      pid: child.pid,
      startedAt: "test",
      command: executable,
    }), { mode: 0o600 });
    const result = await waitForClose(child);
    assert.equal(result.code, 0, result.stderr);
    assert.equal(readFileSync(marker, "utf8"), "ran");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("owned workers never start when the journal handshake is absent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-worker-no-handshake-"));
  try {
    const executable = join(directory, "xcodebuild");
    const marker = join(directory, "ran");
    writeFileSync(executable, `#!/bin/sh\nprintf ran > ${JSON.stringify(marker)}\n`, { mode: 0o700 });
    chmodSync(executable, 0o700);

    const child = spawn(executable, [], {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, SWIFT_SIM_WORKER_HANDSHAKE_TIMEOUT_MS: "100" },
    });
    const result = await waitForClose(child);
    assert.equal(result.code, 78);
    assert.match(result.stderr, /journal handshake timed out/i);
    assert.equal(existsSync(marker), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function waitForClose(child) {
  return new Promise((resolve) => {
    const stderr = [];
    child.stderr?.on("data", (chunk) => stderr.push(chunk));
    child.once("close", (code, signal) => resolve({
      code,
      signal,
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
