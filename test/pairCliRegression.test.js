import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cli = new URL("../mac-helper/bin/swift-sim.js", import.meta.url);
const preload = new URL("./fixtures/pair-cli-preload.mjs", import.meta.url);

test("packaged swift-sim pair reaches setup-status and the real pair dispatch path", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pair-cli-"));
  const callsPath = join(directory, "pair-calls.jsonl");
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", preload.href, cli.pathname, "pair"],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          SWIFT_SIM_PAIR_CALLS: callsPath,
        },
      },
    );

    assert.equal(result.status, 0, result.stderr);
    const calls = readFileSync(callsPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], [
      "pair",
      "--remote-base-url",
      "https://fixture-mac.example.test",
      "--mac-name",
      "fixture-mac",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
