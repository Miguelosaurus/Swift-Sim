#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


root = Path(__file__).resolve().parents[1]
preload = root / "mac-helper/src/lockOwnershipPreload.js"

replace_once(
    preload,
    '''function readOwner(path) {
  return readJSON(join(String(path), "owner.json"));
}
''',
    '''function readOwner(path) {
  const owner = readJSON(join(String(path), "owner.json"));
  return completeLockOwner(owner) ? owner : null;
}

function completeLockOwner(owner) {
  const pid = Number(owner?.pid);
  const identity = String(owner?.startToken || owner?.startedAt || "");
  const createdAt = Date.parse(owner?.createdAt || "");
  return Boolean(owner
    && typeof owner === "object"
    && !Array.isArray(owner)
    && Number.isInteger(pid)
    && pid > 0
    && (identity || Number.isFinite(createdAt)));
}
''',
)

replace_once(
    preload,
    '''function writeLockOwner(path, data, options) {
  const lockPath = dirname(String(path));
  const before = readReclaim(lockPath);
  if (before && ownerBelongsToAnotherLiveProcess(before)) throw busyLockError();
  const result = originalWriteFileSync.call(fs, path, data, options);
  const after = readReclaim(lockPath);
  if (after && ownerBelongsToAnotherLiveProcess(after)) {
    try { originalRmSync.call(fs, path, { force: true }); } catch {}
    throw busyLockError();
  }
  return result;
}
''',
    '''function writeLockOwner(path, data, options) {
  const lockPath = dirname(String(path));
  const intendedOwner = parseOwnerData(data);
  const observedPath = observePath(lockPath);
  if (!completeLockOwner(intendedOwner) || !observedPath) throw busyLockError();
  const before = readReclaim(lockPath);
  if (before && ownerBelongsToAnotherLiveProcess(before)) throw busyLockError();
  const result = originalWriteFileSync.call(fs, path, data, options);
  pauseAfterOwnerWriteForTest();

  const currentPath = observePath(lockPath);
  const currentOwner = readOwner(lockPath);
  if (!samePath(currentPath, observedPath) || !sameOwner(currentOwner, intendedOwner)) {
    throw busyLockError();
  }

  const after = readReclaim(lockPath);
  if (after && ownerBelongsToAnotherLiveProcess(after)) {
    // Remove only the exact owner just published into the same directory. A
    // displaced writer must never erase a replacement owner's record.
    if (samePath(observePath(lockPath), observedPath)
        && sameOwner(readOwner(lockPath), intendedOwner)) {
      try { originalRmSync.call(fs, path, { force: true }); } catch {}
    }
    throw busyLockError();
  }
  return result;
}

function parseOwnerData(data) {
  try {
    const text = Buffer.isBuffer(data) ? data.toString("utf8") : String(data);
    const owner = JSON.parse(text);
    return owner && typeof owner === "object" && !Array.isArray(owner) ? owner : null;
  } catch {
    return null;
  }
}

function pauseAfterOwnerWriteForTest() {
  const milliseconds = Number(process.env.SWIFT_SIM_LOCK_OWNER_PAUSE_MS || 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    Math.min(5_000, Math.floor(milliseconds)),
  );
}
''',
)

replace_once(
    preload,
    '''  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  const currentOwner = readOwner(lockPath);
  if (!sameOwner(currentOwner, observedOwner) || lockOwnerIsAlive(currentOwner)) {
    removeOwnedClaim(claimPath, claim);
    return false;
  }
  return true;
}
''',
    '''  pauseAfterClaimForTest();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
  const currentClaim = readReclaim(lockPath);
  if (!sameOwner(currentClaim, claim)) {
    removeOwnedClaim(claimPath, claim);
    return false;
  }
  const currentOwner = readOwner(lockPath);
  if (!sameOwner(currentOwner, observedOwner) || lockOwnerIsAlive(currentOwner)) {
    removeOwnedClaim(claimPath, claim);
    return false;
  }
  return true;
}

function pauseAfterClaimForTest() {
  const milliseconds = Number(process.env.SWIFT_SIM_LOCK_CLAIM_PAUSE_MS || 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return;
  Atomics.wait(
    new Int32Array(new SharedArrayBuffer(4)),
    0,
    0,
    Math.min(5_000, Math.floor(milliseconds)),
  );
}
''',
)

replace_once(
    preload,
    '''function sameOwner(first, second) {
  if (!first && !second) return true;
''',
    '''function observePath(path) {
  try {
    const stat = originalStatSync.call(fs, path);
    return { device: String(stat.dev), inode: String(stat.ino) };
  } catch {
    return null;
  }
}

function samePath(first, second) {
  return Boolean(first && second
    && first.device === second.device
    && first.inode === second.inode);
}

function sameOwner(first, second) {
  if (!first && !second) return true;
''',
)

test_file = root / "test/lockOwnershipPreload.test.js"
replace_once(test_file, 'import { spawnSync } from "node:child_process";\n', 'import { spawn, spawnSync } from "node:child_process";\n')
replace_once(
    test_file,
    '''  readFileSync,
  readdirSync,
  rmSync,
''',
    '''  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
''',
)
replace_once(test_file, 'import { tmpdir } from "node:os";\n', 'import { once } from "node:events";\nimport { tmpdir } from "node:os";\n')

insert_before = '''test("stale renewal cancellation markers self-heal without clearing build cancellation", () => {
'''
new_tests = r'''test("a parseable malformed owner cannot permanently block lock reclamation", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-malformed-owner-"));
  const lock = join(directory, "state.lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({}));
  try {
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
      await import(${JSON.stringify(resolve("mac-helper/src/atomicLockRemovalPreload.js"))});
      await import(${JSON.stringify(preload)});
      const fs = await import('node:fs');
      fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
    `], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(lock), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a reclaimer cannot delete after its exact claim is replaced", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-replaced-claim-"));
  const lock = join(directory, "state.lock");
  const claimPath = join(lock, ".swift-sim-reclaim.json");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({
    pid: 99_999_999,
    startedAt: "never",
    nonce: "stale-owner",
    createdAt: new Date(0).toISOString(),
  }));

  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_LOCK_CLAIM_PAUSE_MS = '300';
    await import(${JSON.stringify(resolve("mac-helper/src/atomicLockRemovalPreload.js"))});
    await import(${JSON.stringify(preload)});
    const fs = await import('node:fs');
    fs.rmSync(${JSON.stringify(lock)}, { recursive: true, force: true });
  `], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForPath(claimPath);
    const replacementClaim = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: "replacement-claim",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(claimPath, JSON.stringify(replacementClaim));
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(existsSync(lock), true);
    assert.deepEqual(JSON.parse(readFileSync(claimPath, "utf8")), replacementClaim);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a displaced owner writer cannot claim a replacement lock", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-lock-displaced-writer-"));
  const lock = join(directory, "state.lock");
  const displaced = join(directory, "displaced.lock");
  const ownerPath = join(lock, "owner.json");
  mkdirSync(lock);

  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    process.env.SWIFT_SIM_LOCK_OWNER_PAUSE_MS = '300';
    await import(${JSON.stringify(preload)});
    const { spawnSync } = await import('node:child_process');
    const fs = await import('node:fs');
    const startedAt = String(spawnSync('/bin/ps', ['-p', String(process.pid), '-o', 'lstart='], { encoding: 'utf8' }).stdout || '').trim();
    try {
      fs.writeFileSync(${JSON.stringify(ownerPath)}, JSON.stringify({
        pid: process.pid,
        startedAt,
        nonce: 'displaced-writer',
        createdAt: new Date().toISOString(),
      }), { flag: 'wx', mode: 0o600 });
      process.exit(2);
    } catch (error) {
      if (error?.code !== 'EBUSY') process.exit(3);
    }
  `], { stdio: ["ignore", "pipe", "pipe"] });

  try {
    await waitForPath(ownerPath);
    renameSync(lock, displaced);
    mkdirSync(lock);
    const replacementOwner = {
      pid: process.pid,
      startedAt: processStartedAt(process.pid),
      nonce: "replacement-owner",
      createdAt: new Date().toISOString(),
    };
    writeFileSync(join(lock, "owner.json"), JSON.stringify(replacementOwner));
    const [code] = await once(child, "exit");
    assert.equal(code, 0);
    assert.equal(existsSync(lock), true);
    assert.deepEqual(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")), replacementOwner);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
    rmSync(directory, { recursive: true, force: true });
  }
});

async function waitForPath(path) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    if (existsSync(path)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

'''
replace_once(test_file, insert_before, new_tests + insert_before)

docs = root / "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md"
replace_once(docs, "| P1 | 22 | 22 | 0 |", "| P1 | 24 | 24 | 0 |")
replace_once(
    docs,
    "22. Detached live-engine startup is transactional: PID-record publication failure terminates the exact verified process group, and session-publication failure rolls back through the durable identity-checked PID record.\n",
    "22. Detached live-engine startup is transactional: PID-record publication failure terminates the exact verified process group, and session-publication failure rolls back through the durable identity-checked PID record.\n23. Shared helper/build-state lock reclamation rejects parseable malformed owner records and revalidates the exact reclaim claim before atomic removal, preventing permanent wedges and stale-claim deletion after ownership changes.\n24. Generic lock owner publication is bound to the exact directory device/inode and intended owner record after the write, so a suspended writer cannot resume into a quarantined directory and execute without mutual exclusion or erase a replacement owner.\n",
)
replace_once(
    docs,
    "lock ownership and reclamation, parseable malformed owner/reclaim records",
    "lock ownership and reclamation, exact generic reclaim claims, displaced-writer rejection, parseable malformed owner/reclaim records",
)

print("Applied manual PR #21 generic lock ownership hardening.")
