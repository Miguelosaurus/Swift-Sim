#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


root = Path(__file__).resolve().parents[1]
ownership = root / "mac-helper/src/liveEngineOwnershipPreload.js"
replace_once(
    ownership,
    '''    pendingRecords.delete(pid);
    atomicWriteProcessRecord(configuredPIDPath, record);
    return undefined;
''',
    '''    pendingRecords.delete(pid);
    try {
      atomicWriteProcessRecord(configuredPIDPath, record);
    } catch (error) {
      // Once publication fails there is no durable record through which a
      // later start can identify this detached engine. Terminate only the
      // exact process group whose complete kernel/executable/nonce identity
      // was established above; never leave an untracked engine behind.
      try { terminateExactProcessGroup(record); } catch {}
      throw error;
    }
    return undefined;
''',
)

live_reload = root / "mac-helper/src/liveReload.js"
replace_once(
    live_reload,
    '''    writeFileSync(ENGINE_PID, `${child.pid}\\n`, { mode: 0o600 });
    writeFileSync(ENGINE_SESSION, `${JSON.stringify({
      projectRoot: status.project.root,
      scheme: status.project.scheme,
      signingIdentity,
      engineVersion: ENGINE_VERSION,
    }, null, 2)}\\n`, { mode: 0o600 });
    child.unref();
''',
    '''    writeFileSync(ENGINE_PID, `${child.pid}\\n`, { mode: 0o600 });
    try {
      writeFileSync(ENGINE_SESSION, `${JSON.stringify({
        projectRoot: status.project.root,
        scheme: status.project.scheme,
        signingIdentity,
        engineVersion: ENGINE_VERSION,
      }, null, 2)}\\n`, { mode: 0o600 });
    } catch (error) {
      // The durable PID record now authorizes an exact identity-checked stop.
      // Roll back the engine rather than leaving a process whose session was
      // never published and which future starts cannot safely reuse.
      await stopLiveEngine();
      throw error;
    }
    child.unref();
''',
)

test_file = root / "test/liveEngineOwnershipPreload.test.js"
insert_before = '''

test("identity failure never authorizes an unverified cleanup signal", () => {
'''
new_test = r'''

test("PID publication failure terminates the exact detached engine", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-live-publish-failure-"));
  const pidPath = join(directory, "engine.pid");
  const script = `
    import { spawn } from 'node:child_process';
    import { mkdirSync, writeFileSync } from 'node:fs';
    import { setTimeout as delay } from 'node:timers/promises';
    import { installLiveEngineOwnershipBoundary } from ${JSON.stringify(preloadURL)};
    const pidPath = ${JSON.stringify(pidPath)};
    mkdirSync(pidPath);
    installLiveEngineOwnershipBoundary({ engineExecutable: process.execPath, pidPath });
    const engine = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: 'ignore',
    });
    let failureCode = '';
    try {
      writeFileSync(pidPath, String(engine.pid), { mode: 0o600 });
    } catch (error) {
      failureCode = String(error?.code || error?.name || 'error');
    }
    await delay(150);
    const engineAlive = alive(engine.pid);
    if (engineAlive) {
      try { process.kill(-engine.pid, 'SIGKILL'); } catch {}
    }
    console.log(JSON.stringify({ failureCode, engineAlive }));
    function alive(pid) {
      try { process.kill(pid, 0); return true; } catch { return false; }
    }
  `;

  try {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const { stdout, stderr, code } = await collect(child);
    assert.equal(code, 0, stderr);
    const observed = JSON.parse(stdout.trim());
    assert.notEqual(observed.failureCode, "");
    assert.equal(observed.engineAlive, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("session publication failure rolls back through the durable PID record", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  const pidWrite = source.indexOf("writeFileSync(ENGINE_PID");
  const sessionWrite = source.indexOf("writeFileSync(ENGINE_SESSION", pidWrite);
  const unref = source.indexOf("child.unref()", sessionWrite);
  const publication = source.slice(pidWrite, unref);
  assert.match(publication, /try \{[\s\S]*writeFileSync\(ENGINE_SESSION/);
  assert.match(publication, /catch \(error\) \{[\s\S]*await stopLiveEngine\(\);[\s\S]*throw error/);
});
'''
replace_once(test_file, insert_before, new_test + insert_before)

docs = root / "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md"
replace_once(docs, "| P1 | 21 | 21 | 0 |", "| P1 | 22 | 22 | 0 |")
replace_once(
    docs,
    "21. Live readiness and routing are bound to the persisted engine session's exact project root, selected scheme, and engine version, preventing cross-scheme compilation-map injection within a shared workspace.\n",
    "21. Live readiness and routing are bound to the persisted engine session's exact project root, selected scheme, and engine version, preventing cross-scheme compilation-map injection within a shared workspace.\n22. Detached live-engine startup is transactional: PID-record publication failure terminates the exact verified process group, and session-publication failure rolls back through the durable identity-checked PID record.\n",
)
replace_once(
    docs,
    "identity-failure no-signal behavior, stale/reused PIDs",
    "identity-failure no-signal behavior, PID/session publication rollback, stale/reused PIDs",
)

print("Applied manual PR #21 live-engine publication rollback fix.")
