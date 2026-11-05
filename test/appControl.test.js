import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { runAppControlCli } from "../mac-helper/src/appControlCli.js";

test("app-control adapter boundary and Python safety/lifecycle cases", () => {
  const result = spawnSync("python3", ["-I", "-B", "test/optional/app_control_test.py"], {
    encoding: "utf8",
    timeout: 30_000,
  });
  assert.equal(result.status, 0, result.stderr);
});

test("optional help never launches a worker", async () => {
  const output = [];
  assert.equal(
    await runAppControlCli(["help"], {
      run() {
        throw Error("unexpected worker");
      },
      write: (line) => output.push(line),
    }),
    0,
  );
  assert.match(output[0], /separate signed/);
});

test("worker failure output never leaks raw process output", async () => {
  const output = [];
  const code = await runAppControlCli(["status"], {
    run: async () => ({ code: 1, stdout: "PRIVATE-TOKEN", stderr: "PRIVATE-KEY" }),
    write: (line) => output.push(line),
  });
  assert.equal(code, 1);
  assert.doesNotMatch(output.join(""), /PRIVATE/);
});

test("normal delivery and notification imports never load optional testing modules", () => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-lazy-control-"));
  try {
    const loader = join(root, "reject-control.mjs");
    writeFileSync(
      loader,
      `export function resolve(s,c,n){if(s.includes('appControlCli')||s.includes('optional/app-control'))throw Error('optional control loaded');return n(s,c);}`,
    );
    const modules = ["liveReload.js", "changeDelivery.js", "apnsProvider.js"].map(
      (name) => pathToFileURL(resolve("mac-helper/src", name)).href,
    );
    const script = modules.map((url) => `await import(${JSON.stringify(url)});`).join("\n");
    const result = spawnSync(
      process.execPath,
      ["--experimental-loader", loader, "--input-type=module", "-e", script],
      {
        encoding: "utf8",
        timeout: 20_000,
        env: { ...process.env, HOME: root },
      },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(root, ".swift-sim", "app-control")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
