import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectPhase4HelperProcessIdentity,
  phase4HelperProcessIdentityPath,
} from "../mac-helper/src/persistence/phase4HelperProcessIdentity.js";

const IDENTITY = Object.freeze({ pid: 900_000_001, startedAt: "Mon Aug 17 00:00:00 2026" });

function inspectWithResult(result) {
  const stateRoot = mkdtempSync(join(tmpdir(), "swift-sim-helper-observation-"));
  mkdirSync(join(stateRoot, "runtime"), { mode: 0o700 });
  writeFileSync(
    phase4HelperProcessIdentityPath(stateRoot),
    JSON.stringify({ version: 1, role: "swift-sim-helper", ...IDENTITY }),
    { mode: 0o600 },
  );
  try {
    return inspectPhase4HelperProcessIdentity({
      stateRoot,
      expectedIdentity: IDENTITY,
      spawnSync(command, args, options) {
        assert.equal(command, "/bin/ps");
        assert.deepEqual(args, ["-p", String(IDENTITY.pid), "-o", "lstart="]);
        assert.deepEqual(options, { encoding: "utf8" });
        if (result instanceof Error) throw result;
        return result;
      },
    });
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
}

test("only explicit successful ps absence proves helper quiescence", () => {
  const absent = inspectWithResult({ status: 1, stdout: "", stderr: "", signal: null });
  assert.equal(absent.state, "absent");
  assert.equal(absent.exactIdentityVerified, true);
  assert.equal(absent.helperQuiesced, true);

  const running = inspectWithResult({ status: 0, stdout: `${IDENTITY.startedAt}\n`, stderr: "" });
  assert.equal(running.state, "running");
  assert.equal(running.exactIdentityVerified, true);
  assert.equal(running.helperQuiesced, false);

  const reused = inspectWithResult({ status: 0, stdout: "Mon Aug 17 00:01:00 2026\n", stderr: "" });
  assert.equal(reused.state, "pid-reused");
  assert.equal(reused.exactIdentityVerified, false);
  assert.equal(reused.helperQuiesced, false);
});

test("unavailable or malformed process observations fail closed", async (t) => {
  const cases = [
    ["thrown command error", new Error("spawn failed")],
    ["missing result", undefined],
    ["array result", []],
    ["error property", { status: 1, stdout: "", stderr: "", error: new Error("ENOENT") }],
    ["signal", { status: null, stdout: "", stderr: "", signal: "SIGTERM" }],
    ["unexpected exit", { status: 2, stdout: "", stderr: "" }],
    ["empty successful output", { status: 0, stdout: "", stderr: "" }],
    ["whitespace successful output", { status: 0, stdout: " \n", stderr: "" }],
    ["stderr on absence", { status: 1, stdout: "", stderr: "permission denied" }],
    ["stderr on success", { status: 0, stdout: IDENTITY.startedAt, stderr: "warning" }],
    ["contradictory absence output", { status: 1, stdout: IDENTITY.startedAt, stderr: "" }],
    ["missing stdout", { status: 1, stderr: "" }],
    ["missing stderr", { status: 1, stdout: "" }],
    ["non-string output", { status: 0, stdout: 42, stderr: "" }],
  ];
  for (const [name, result] of cases) {
    await t.test(name, () => {
      assert.throws(() => inspectWithResult(result), /helper process observation/);
    });
  }
});
