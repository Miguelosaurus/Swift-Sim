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

test("optional setup preserves identity, signing and archive boundaries", () => {
  const result = spawnSync("python3", ["-I", "-B", "test/optional/app_control_setup_test.py"], {
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

test(
  "native launch handoff validates callbacks without a Simulator",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "swift-sim-testing-handoff-"));
    try {
      const binary = join(root, "handoff-tests");
      const built = spawnSync(
        "xcrun",
        [
          "swiftc",
          "Companion/SwiftSimCompanion/AppTestingHandoff.swift",
          "test/optional/AppTestingHandoffTests.swift",
          "-o",
          binary,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      assert.equal(built.status, 0, built.stderr);
      const tested = spawnSync(binary, [], { encoding: "utf8", timeout: 5_000 });
      assert.equal(tested.status, 0, tested.stderr);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("worker failure output never leaks raw process output", async () => {
  const output = [];
  const code = await runAppControlCli(["status"], {
    run: async () => ({ code: 1, stdout: "PRIVATE-TOKEN", stderr: "PRIVATE-KEY" }),
    write: (line) => output.push(line),
  });
  assert.equal(code, 1);
  assert.doesNotMatch(output.join(""), /PRIVATE/);
});

test(
  "phone lifetime expires with a blocked UI thread and cannot be renewed",
  {
    skip: process.platform !== "darwin",
  },
  () => {
    const root = mkdtempSync(join(tmpdir(), "swift-sim-testing-lifetime-"));
    try {
      const binary = join(root, "lifetime-tests");
      const built = spawnSync(
        "xcrun",
        [
          "swiftc",
          "mac-helper/optional/app-control/runner/SwiftSimTestingLifetime.swift",
          "test/optional/AppTestingLifetimeTests.swift",
          "-o",
          binary,
        ],
        { encoding: "utf8", timeout: 60_000 },
      );
      assert.equal(built.status, 0, built.stderr);
      for (const args of [[], ["blocked-main"]]) {
        const tested = spawnSync(binary, args, { encoding: "utf8", timeout: 3_000 });
        assert.equal(tested.status, 0, tested.stderr);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("setup selects a bounded one-shot worker without changing ordinary command policy", async () => {
  const calls = [];
  for (const args of [["setup"], ["status"]]) {
    await runAppControlCli(args, {
      run: async (request) => {
        calls.push(request);
        return { code: 0, stdout: JSON.stringify({ schemaVersion: 1, outcome: "fixture" }) };
      },
      write() {},
    });
  }
  assert.match(calls[0].args.at(-1), /setup\.py$/);
  assert.equal(calls[0].policy.timeoutMs, 420_000);
  assert.match(calls[1].args.at(-1), /control\.py$/);
  assert.equal(calls[1].policy.timeoutMs, 65_000);
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
