import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
const entry = fileURLToPath(new URL("../mac-helper/bin/swift-sim-entry.js", import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
test(
  "real one-shot recovery starts an isolated stopped helper and repeating recovery reuses it",
  { timeout: 30000 },
  async (t) => {
    const root = mkdtempSync(join(tmpdir(), "swift-sim-recovery-process-"));
    const socket = createServer();
    socket.listen(0, "127.0.0.1");
    await once(socket, "listening");
    const port = socket.address().port;
    await new Promise((r) => socket.close(r));
    let pid;
    t.after(async () => {
      if (pid) {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {}
        for (let i = 0; i < 60; i++) {
          try {
            process.kill(pid, 0);
          } catch {
            break;
          }
          await sleep(100);
        }
        try {
          process.kill(-pid, "SIGKILL");
        } catch {}
      }
      rmSync(root, { recursive: true, force: true });
    });
    const env = {
      ...process.env,
      HOME: root,
      SWIFT_SIM_PORT: String(port),
      SWIFT_SIM_HOST: "127.0.0.1",
    };
    delete env.SWIFT_SIM_MARKETPLACE_ROOT;
    delete env.SWIFT_SIM_HELPER_WAS_RUNNING;
    const run = () =>
      new Promise((resolve, reject) => {
        const child = spawn(
          process.execPath,
          [entry, "recover-delivery", "--project", join(root, "App.xcodeproj"), "--scheme", "App"],
          { env, stdio: ["ignore", "pipe", "pipe"] },
        );
        let stdout = "",
          stderr = "";
        child.stdout.on("data", (x) => (stdout += x));
        child.stderr.on("data", (x) => (stderr += x));
        child.on("error", reject);
        child.on("exit", (code) => {
          if (code !== 0) reject(Error(stderr));
          else resolve(JSON.parse(stdout));
        });
      });
    const first = await run();
    assert.equal(first.code, "RECOVERY_READY");
    assert.deepEqual(first.repaired, ["helper-started"]);
    assert.equal(first.completionVerified, false);
    const processResult = spawnSync(
      "/usr/sbin/lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"],
      { encoding: "utf8" },
    );
    pid = Number(processResult.stdout.trim());
    assert.ok(pid > 1);
    const command = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
    }).stdout;
    assert.match(command, /swift-sim-helper-entry.js serve/);
    const second = await run();
    assert.equal(second.code, "RECOVERY_READY");
    assert.deepEqual(second.repaired, []);
    const after = spawnSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
    });
    assert.equal(Number(after.stdout.trim()), pid);
  },
);
