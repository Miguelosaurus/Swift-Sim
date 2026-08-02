from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


ownership_path = Path("mac-helper/src/liveEngineOwnershipPreload.js")
source = ownership_path.read_text()
source = replace_once(
    source,
    '''    const instanceNonce = engineSpawn ? randomUUID() : "";
    if (engineSpawn) {
      normalized.options = {
''',
    '''    const instanceNonce = engineSpawn ? randomUUID() : "";
    if (engineSpawn && process.platform === "darwin" && !identityHelperExecutable()) {
      const error = new Error("Swift Sim could not prepare the live-engine identity verifier.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_IDENTITY_UNAVAILABLE";
      throw error;
    }
    if (engineSpawn) {
      normalized.options = {
''',
    "precompile identity helper",
)
source = replace_once(
    source,
    '''    if (!identity || identity.processGroup !== pid
        || identity.executable !== configuredExecutable
        || identity.instanceNonce !== instanceNonce) {
      terminateSpawnedProcessGroup(pid);
      const error = new Error("Swift Sim could not establish ownership of the live engine process.");
''',
    '''    if (!identity || identity.processGroup !== pid
        || identity.executable !== configuredExecutable
        || identity.instanceNonce !== instanceNonce) {
      // Identity failure never authorizes a signal. The child may already have
      // exited and its PID/PGID may have been recycled while inspection ran.
      const error = new Error("Swift Sim could not establish ownership of the live engine process.");
''',
    "unverified spawn cleanup",
)
source = replace_once(
    source,
    '''function terminateSpawnedProcessGroup(pid) {
  try { originalKill(-Number(pid), "SIGKILL"); } catch {
    try { originalKill(Number(pid), "SIGKILL"); } catch {}
  }
}

''',
    "",
    "unsafe spawned group terminator",
)
old_identity = '''function processIdentity(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return null;
  if (process.platform === "darwin") return darwinProcessIdentity(value);
  if (process.platform === "linux") return linuxProcessIdentity(value);
  return null;
}

function darwinProcessIdentity(pid) {
  const helper = identityHelperExecutable();
  if (!helper) return null;
  const result = originalSpawnSync(helper, [String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const [rawStartToken, rawProcessGroup, rawExecutable] = String(result.stdout || "").split(/\\r?\\n/);
  const processGroup = Number(rawProcessGroup);
  const executable = canonicalPath(rawExecutable || "");
  const instanceNonce = processInstanceNonceFromPS(pid);
  if (!rawStartToken || !Number.isInteger(processGroup) || processGroup <= 1
      || !executable || !instanceNonce) return null;
  return {
    startToken: `darwin:${rawStartToken}`,
    processGroup,
    executable,
    instanceNonce,
  };
}

function linuxProcessIdentity(pid) {
  try {
    const stat = String(originalReadFileSync(`/proc/${pid}/stat`, "utf8"));
    const closing = stat.lastIndexOf(")");
    if (closing < 0) return null;
    const fields = stat.slice(closing + 2).trim().split(/\\s+/);
    const processGroup = Number(fields[2]);
    const startTicks = fields[19] || "";
    const executable = canonicalPath(originalReadlinkSync(`/proc/${pid}/exe`));
    const environment = originalReadFileSync(`/proc/${pid}/environ`);
    const instanceNonce = environmentNonce(String(environment).replaceAll("\\0", " "));
    if (!startTicks || !Number.isInteger(processGroup) || processGroup <= 1
        || !executable || !instanceNonce) return null;
    return {
      startToken: `linux:${startTicks}`,
      processGroup,
      executable,
      instanceNonce,
    };
  } catch {
    return null;
  }
}
'''
new_identity = '''function processIdentity(pid) {
  const kernelIdentity = kernelProcessIdentity(pid);
  if (!kernelIdentity) return null;
  const instanceNonce = process.platform === "darwin"
    ? processInstanceNonceFromPS(pid)
    : process.platform === "linux"
      ? linuxProcessInstanceNonce(pid)
      : "";
  return instanceNonce ? { ...kernelIdentity, instanceNonce } : null;
}

export function kernelProcessIdentity(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return null;
  if (process.platform === "darwin") return darwinKernelProcessIdentity(value);
  if (process.platform === "linux") return linuxKernelProcessIdentity(value);
  return null;
}

function darwinKernelProcessIdentity(pid) {
  const helper = identityHelperExecutable();
  if (!helper) return null;
  const result = originalSpawnSync(helper, [String(pid)], {
    encoding: "utf8",
    timeout: 5_000,
  });
  if (result.status !== 0) return null;
  const [rawStartToken, rawProcessGroup, rawExecutable] = String(result.stdout || "").split(/\\r?\\n/);
  const processGroup = Number(rawProcessGroup);
  const executable = canonicalPath(rawExecutable || "");
  if (!rawStartToken || !Number.isInteger(processGroup) || processGroup <= 1 || !executable) return null;
  return {
    startToken: `darwin:${rawStartToken}`,
    processGroup,
    executable,
  };
}

function linuxKernelProcessIdentity(pid) {
  try {
    const stat = String(originalReadFileSync(`/proc/${pid}/stat`, "utf8"));
    const closing = stat.lastIndexOf(")");
    if (closing < 0) return null;
    const fields = stat.slice(closing + 2).trim().split(/\\s+/);
    const processGroup = Number(fields[2]);
    const startTicks = fields[19] || "";
    const executable = canonicalPath(originalReadlinkSync(`/proc/${pid}/exe`));
    if (!startTicks || !Number.isInteger(processGroup) || processGroup <= 1 || !executable) return null;
    return {
      startToken: `linux:${startTicks}`,
      processGroup,
      executable,
    };
  } catch {
    return null;
  }
}

function linuxProcessInstanceNonce(pid) {
  try {
    const environment = originalReadFileSync(`/proc/${pid}/environ`);
    return environmentNonce(String(environment).replaceAll("\\0", " "));
  } catch {
    return "";
  }
}
'''
source = replace_once(source, old_identity, new_identity, "shared kernel identity")
ownership_path.write_text(source)


lock_path = Path("mac-helper/src/liveEngineLifecycleLock.js")
lock = lock_path.read_text()
lock = replace_once(
    lock,
    'import { spawnSync } from "node:child_process";\n',
    'import { kernelProcessIdentity } from "./liveEngineOwnershipPreload.js";\n',
    "lifecycle identity import",
)
lock = lock.replace('let currentProcessStartedAt = "";', 'let currentProcessStartToken = "";', 1)
lock = lock.replace('    startedAt: processStartIdentity(),', '    version: 2,\n    startToken: processStartIdentity(),', 2)
lock = replace_once(
    lock,
    '''function sameOwner(left, right) {
  return Boolean(left && right
    && Number(left.pid) === Number(right.pid)
    && left.startedAt === right.startedAt
    && left.nonce === right.nonce);
}

function lockOwnerIsAlive(owner) {
  const pid = Number(owner?.pid);
  if (!Number.isInteger(pid) || pid <= 1 || !owner?.startedAt) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return processStartedAt(pid) === owner.startedAt;
}
''',
    '''function sameOwner(left, right) {
  return Boolean(left && right
    && Number(left.pid) === Number(right.pid)
    && ownerStartToken(left) === ownerStartToken(right)
    && left.nonce === right.nonce);
}

function ownerStartToken(owner) {
  return String(owner?.startToken || owner?.startedAt || "");
}

export function lockOwnerIsAlive(owner, {
  identity = kernelProcessIdentity(owner?.pid),
} = {}) {
  const pid = Number(owner?.pid);
  const startToken = String(owner?.startToken || "");
  if (!Number.isInteger(pid) || pid <= 1 || !startToken) return false;
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  return Boolean(identity && identity.startToken === startToken);
}
''',
    "lifecycle owner validation",
)
lock = replace_once(
    lock,
    '''function processStartIdentity() {
  currentProcessStartedAt ||= requiredProcessStartedAt(process.pid);
  return currentProcessStartedAt;
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = processStartedAt(pid);
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish live-engine lock ownership.");
}

function processStartedAt(pid) {
  const result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}
''',
    '''function processStartIdentity() {
  currentProcessStartToken ||= requiredProcessStartToken(process.pid);
  return currentProcessStartToken;
}

function requiredProcessStartToken(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = kernelProcessIdentity(pid)?.startToken || "";
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error("Unable to establish live-engine lock ownership.");
}
''',
    "lifecycle kernel start token",
)
lock_path.write_text(lock)


reload_path = Path("mac-helper/src/liveReload.js")
reload = reload_path.read_text()
reload = replace_once(
    reload,
    '''  const output = String(settings.stdout || "");
  const selectedSettings = selectLiveApplicationBuildSettings(output, scheme);
''',
    '''  if (settings.status !== 0 || settings.error) {
    const detail = settings.error?.code === "ETIMEDOUT"
      ? "The Xcode build-settings query timed out."
      : String(settings.stderr || settings.stdout || settings.error?.message || "").trim();
    throw new Error(
      detail
        ? `Unable to determine host-app signing settings. ${detail}`
        : "Unable to determine host-app signing settings.",
    );
  }
  const output = String(settings.stdout || "");
  const selectedSettings = selectLiveApplicationBuildSettings(output, scheme);
''',
    "build settings status guard",
)
reload = replace_once(
    reload,
    '''  const team = String(selectedSettings.DEVELOPMENT_TEAM || "").trim();
  const identities = spawnSync(
''',
    '''  const team = String(selectedSettings.DEVELOPMENT_TEAM || "").trim();
  if (!team) {
    throw new Error("Xcode did not report a Development Team for the selected host application target.");
  }
  const identities = spawnSync(
''',
    "development team fail closed",
)
reload = replace_once(
    reload,
    '''  return [...new Set([
    preferred,
    teamMatch,
    ...development.map((match) => match[1]),
  ].filter(Boolean))];
''',
    '''  return [...new Set([
    preferred,
    teamMatch,
  ].filter(Boolean))];
''',
    "unrelated signing fallback removal",
)
reload = replace_once(
    reload,
    '''  const signingIdentities = resolveSigningIdentities(status.project.path, status.project.scheme);
  if (signingIdentities.length === 0) {
''',
    '''  let signingIdentities;
  try {
    signingIdentities = resolveSigningIdentities(status.project.path, status.project.scheme);
  } catch (error) {
    return {
      ...status,
      started: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  if (signingIdentities.length === 0) {
''',
    "live start signing error",
)
reload_path.write_text(reload)


ownership_test_path = Path("test/liveEngineOwnershipPreload.test.js")
ownership_test = ownership_test_path.read_text()
if 'test("identity failure never authorizes an unverified cleanup signal"' not in ownership_test:
    ownership_test += '''\n\ntest("identity failure never authorizes an unverified cleanup signal", () => {
  const source = readFileSync("mac-helper/src/liveEngineOwnershipPreload.js", "utf8");
  const failureBranch = source.slice(
    source.indexOf("if (!identity || identity.processGroup !== pid"),
    source.indexOf("pendingRecords.set(pid", source.indexOf("if (!identity || identity.processGroup !== pid")),
  );
  assert.doesNotMatch(failureBranch, /kill|terminate/);
  assert.match(source, /process\.platform === "darwin" && !identityHelperExecutable\(\)/);
});\n'''
ownership_test_path.write_text(ownership_test)


lock_test_path = Path("test/liveEngineLifecycleLock.test.js")
lock_test = lock_test_path.read_text()
lock_test = lock_test.replace(
    'import { cleanupCreatedLockDirectory, withLiveEngineLifecycleLock } from "../mac-helper/src/liveEngineLifecycleLock.js";',
    'import { cleanupCreatedLockDirectory, lockOwnerIsAlive, withLiveEngineLifecycleLock } from "../mac-helper/src/liveEngineLifecycleLock.js";',
    1,
)
if 'test("lifecycle owners require the exact kernel start token"' not in lock_test:
    lock_test += '''\n\ntest("lifecycle owners require the exact kernel start token", () => {
  const owner = {
    version: 2,
    pid: process.pid,
    startToken: "darwin:1780000000.123456",
    nonce: "owner",
  };
  assert.equal(lockOwnerIsAlive(owner, {
    identity: { startToken: owner.startToken },
  }), true);
  assert.equal(lockOwnerIsAlive(owner, {
    identity: { startToken: "darwin:1780000000.123457" },
  }), false);
  assert.equal(lockOwnerIsAlive({
    pid: process.pid,
    startedAt: "Sat Aug  1 23:00:00 2026",
    nonce: "legacy",
  }, {
    identity: { startToken: owner.startToken },
  }), false);
});\n'''
lock_test_path.write_text(lock_test)


integration_path = Path("test/mainPostMergeIntegration.test.js")
integration = integration_path.read_text()
if 'test("live signing fails closed when build settings are unavailable"' not in integration:
    integration += '''\n\ntest("live signing fails closed when build settings are unavailable", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(source, /if \(settings\.status !== 0 \|\| settings\.error\)/);
  assert.match(source, /Xcode did not report a Development Team/);
  assert.doesNotMatch(
    source.slice(source.indexOf("function resolveSigningIdentities"), source.indexOf("function provisioningIdentityForTeam")),
    /\.\.\.development\.map/,
  );
});\n'''
integration_path.write_text(integration)
