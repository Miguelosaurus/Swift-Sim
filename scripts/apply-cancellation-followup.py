from pathlib import Path


def replace_once(path, old, new):
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


core = "mac-helper/src/deviceBuilderCore.js"
replace_once(core,
'''    if (now - lastLogSaveAt >= 1_000) {\n      lastLogSaveAt = now;\n      saveBuild();\n    }''',
'''    if (now - lastLogSaveAt >= 1_000) {\n      lastLogSaveAt = now;\n      try {\n        saveBuild();\n      } catch (error) {\n        // Deletion writes the cancellation marker before removing state. Do not\n        // let a progress-log callback crash the helper while runBuffered is\n        // already terminating the owned process group.\n        if (error?.code !== "SWIFT_SIM_BUILD_CANCELLED") throw error;\n      }\n    }''')
replace_once(core,
'''      allowProvisioningUpdates: build.allowProvisioningUpdates,\n      buildSettingArgs,\n    });''',
'''      allowProvisioningUpdates: build.allowProvisioningUpdates,\n      buildSettingArgs,\n      build,\n    });''')
replace_once(core,
'''async function readBuildSettings({ target, scheme, configuration, allowProvisioningUpdates, buildSettingArgs }) {''',
'''async function readBuildSettings({ target, scheme, configuration, allowProvisioningUpdates, buildSettingArgs, build }) {''')
replace_once(core,
'''    "-showBuildSettings",\n  ]);\n  if (result.code !== 0) {''',
'''    "-showBuildSettings",\n  ], { cancelPath: build?.control?.cancelPath || "" });\n  if (result.cancellationError) throw result.cancellationError;\n  if (result.code !== 0) {''')

test_path = "test/deviceBuilderTimeout.test.js"
replace_once(test_path,
'''import assert from "node:assert/strict";\nimport {''',
'''import assert from "node:assert/strict";\nimport { spawnSync } from "node:child_process";\nimport {''')
replace_once(test_path,
'''function processIsAlive(pid) {\n  try {\n    process.kill(pid, 0);\n    return true;\n  } catch {\n    return false;\n  }\n}''',
'''function processIsAlive(pid) {\n  try {\n    process.kill(pid, 0);\n  } catch {\n    return false;\n  }\n  const status = spawnSync("/bin/ps", ["-p", String(pid), "-o", "stat="], { encoding: "utf8" });\n  if (status.status !== 0) return false;\n  return !String(status.stdout || "").trim().startsWith("Z");\n}''')
Path(test_path).write_text(Path(test_path).read_text() + r'''

test("a cancellation marker terminates the complete process group", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-cancel-test-"));
  const pidPath = join(directory, "descendant.pid");
  const cancelPath = join(directory, ".cancelled");
  try {
    const fixture = `
      const { spawn } = require("node:child_process");
      const { writeFileSync } = require("node:fs");
      const descendant = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore",
      });
      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      process.on("SIGTERM", () => {});
      setInterval(() => {}, 1000);
    `;
    const cancellation = setTimeout(() => writeFileSync(cancelPath, "cancel"), 100);
    const result = await runBuffered(process.execPath, ["-e", fixture], {
      timeoutMs: 8_000,
      cancelPath,
    });
    clearTimeout(cancellation);
    assert.equal(result.cancellationError?.code, "SWIFT_SIM_BUILD_CANCELLED");
    const descendantPID = Number(readFileSync(pidPath, "utf8"));
    assert.equal(processIsAlive(descendantPID), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
''')

print("Applied cancellation follow-up")
