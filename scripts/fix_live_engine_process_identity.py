from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


path = Path("mac-helper/src/liveEngineOwnershipPreload.js")
source = path.read_text()
source = replace_once(
    source,
    'import { homedir } from "node:os";\nimport { dirname, join, resolve } from "node:path";\n',
    'import { homedir, tmpdir } from "node:os";\nimport { dirname, join, resolve } from "node:path";\nimport { fileURLToPath } from "node:url";\n',
    "ownership imports",
)
source = replace_once(
    source,
    '''const originalRmSync = fs.rmSync;
const originalKill = process.kill.bind(process);
''',
    '''const originalRmSync = fs.rmSync;
const originalMkdtempSync = fs.mkdtempSync;
const originalChmodSync = fs.chmodSync;
const originalReadlinkSync = fs.readlinkSync;
const originalRealpathSync = fs.realpathSync;
const originalKill = process.kill.bind(process);
''',
    "ownership fs captures",
)
source = replace_once(
    source,
    '''const AUTHORIZATION_WINDOW_MS = 2_000;
let installed = false;
let configuredExecutable = DEFAULT_ENGINE_EXECUTABLE;
let configuredPIDPath = DEFAULT_ENGINE_PID_PATH;
''',
    '''const AUTHORIZATION_WINDOW_MS = 2_000;
const ENGINE_INSTANCE_ENV = "SWIFT_SIM_ENGINE_INSTANCE_NONCE";
const IDENTITY_HELPER_SOURCE = fileURLToPath(new URL("./liveEngineIdentity.c", import.meta.url));
let installed = false;
let configuredExecutable = canonicalPath(DEFAULT_ENGINE_EXECUTABLE);
let configuredPIDPath = DEFAULT_ENGINE_PID_PATH;
let identityHelperDirectory = "";
let identityHelperPath = "";
''',
    "ownership constants",
)
source = replace_once(
    source,
    '''  configuredExecutable = resolve(String(engineExecutable));
''',
    '''  configuredExecutable = canonicalPath(engineExecutable);
''',
    "configured executable canonicalization",
)
old_spawn = '''  childProcess.spawn = function guardedSpawn(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const child = originalSpawn.call(this, command, normalized.args, normalized.options);
    if (resolveCommand(command) !== configuredExecutable || normalized.options.detached !== true) {
      return child;
    }

    // A failed spawn otherwise emits an unhandled `error` because the legacy
    // live-reload caller publishes the PID synchronously. The guarded PID write
    // below turns that condition into a normal synchronous failure.
    child.once("error", () => {});
    const pid = Number(child.pid);
    if (!Number.isInteger(pid) || pid <= 1) return child;

    const startedAt = requiredProcessStartedAt(pid);
    if (!startedAt) {
      terminateExactProcessGroup(pid, "");
      const error = new Error("Swift Sim could not establish ownership of the live engine process.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_IDENTITY_UNAVAILABLE";
      throw error;
    }
    pendingRecords.set(pid, {
      version: 1,
      pid,
      processGroup: pid,
      startedAt,
      executable: configuredExecutable,
      nonce: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    return child;
  };
'''
new_spawn = '''  childProcess.spawn = function guardedSpawn(command, args, options) {
    const normalized = normalizeInvocation(args, options);
    const engineSpawn = canonicalPath(resolveCommand(command)) === configuredExecutable
      && normalized.options.detached === true;
    const instanceNonce = engineSpawn ? randomUUID() : "";
    if (engineSpawn) {
      normalized.options = {
        ...normalized.options,
        env: {
          ...process.env,
          ...(normalized.options.env || {}),
          [ENGINE_INSTANCE_ENV]: instanceNonce,
        },
      };
    }
    const child = originalSpawn.call(this, command, normalized.args, normalized.options);
    if (!engineSpawn) return child;

    // A failed spawn otherwise emits an unhandled `error` because the legacy
    // live-reload caller publishes the PID synchronously. The guarded PID write
    // below turns that condition into a normal synchronous failure.
    child.once("error", () => {});
    const pid = Number(child.pid);
    if (!Number.isInteger(pid) || pid <= 1) return child;

    const identity = requiredProcessIdentity(pid);
    if (!identity || identity.processGroup !== pid
        || identity.executable !== configuredExecutable
        || identity.instanceNonce !== instanceNonce) {
      terminateSpawnedProcessGroup(pid);
      const error = new Error("Swift Sim could not establish ownership of the live engine process.");
      error.code = "SWIFT_SIM_LIVE_ENGINE_IDENTITY_UNAVAILABLE";
      throw error;
    }
    pendingRecords.set(pid, {
      version: 2,
      pid,
      processGroup: pid,
      startToken: identity.startToken,
      executable: identity.executable,
      instanceNonce,
      recordNonce: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    return child;
  };
'''
source = replace_once(source, old_spawn, new_spawn, "guarded engine spawn")
source = replace_once(
    source,
    '''    if (!record || !liveEngineProcessRecordIsCurrent(record, {
      engineExecutable: configuredExecutable,
    })) {
      if (Number.isInteger(pid) && pid > 1) terminateExactProcessGroup(pid, record?.startedAt || "");
      const error = new Error("Swift Sim refused to publish an unowned live engine PID.");
''',
    '''    if (!record || !liveEngineProcessRecordIsCurrent(record, {
      engineExecutable: configuredExecutable,
    })) {
      const error = new Error("Swift Sim refused to publish an unowned live engine PID.");
''',
    "unsafe invalid-record termination",
)
source = source.replace(
    '''      verifyLegacyCommand: record.legacy === true,
''',
    "",
)
source = source.replace(
    '''          verifyLegacyCommand: authorization.legacy === true,
''',
    "",
)
source = replace_once(
    source,
    '''    terminateExactProcessGroup(value, authorization.startedAt);
''',
    '''    terminateExactProcessGroup(authorization);
''',
    "authorized group termination",
)
old_parse_legacy = '''  if (/^\\d+$/.test(text)) {
    const pid = Number(text);
    if (!Number.isInteger(pid) || pid <= 1) return null;
    return {
      version: 0,
      legacy: true,
      pid,
      processGroup: pid,
      startedAt: processStartedAt(pid),
      executable: resolve(String(engineExecutable)),
    };
  }
'''
new_parse_legacy = '''  if (/^\\d+$/.test(text)) {
    // A numeric legacy record contains no collision-resistant ownership token.
    // Fail closed instead of authorizing a signal against a potentially reused PID.
    return null;
  }
'''
source = replace_once(source, old_parse_legacy, new_parse_legacy, "legacy PID fail-closed parsing")
old_current = '''export function liveEngineProcessRecordIsCurrent(record, {
  engineExecutable = DEFAULT_ENGINE_EXECUTABLE,
  verifyLegacyCommand = false,
  startedAt = processStartedAt(record?.pid),
  command = verifyLegacyCommand ? processCommand(record?.pid) : "",
} = {}) {
  const pid = Number(record?.pid);
  const processGroup = Number(record?.processGroup);
  const expectedExecutable = resolve(String(engineExecutable));
  if (!Number.isInteger(pid) || pid <= 1
      || processGroup !== pid
      || typeof record?.startedAt !== "string"
      || !record.startedAt
      || record.startedAt !== startedAt
      || resolve(String(record?.executable || "")) !== expectedExecutable) {
    return false;
  }
  return !verifyLegacyCommand || commandLineMatchesExecutable(command, expectedExecutable);
}
'''
new_current = '''export function liveEngineProcessRecordIsCurrent(record, {
  engineExecutable = DEFAULT_ENGINE_EXECUTABLE,
  identity = processIdentity(record?.pid),
} = {}) {
  const pid = Number(record?.pid);
  const processGroup = Number(record?.processGroup);
  const expectedExecutable = canonicalPath(engineExecutable);
  return Boolean(
    Number(record?.version) >= 2
    && Number.isInteger(pid)
    && pid > 1
    && processGroup === pid
    && typeof record?.startToken === "string"
    && record.startToken
    && typeof record?.instanceNonce === "string"
    && record.instanceNonce
    && canonicalPath(record?.executable || "") === expectedExecutable
    && identity
    && identity.processGroup === pid
    && identity.startToken === record.startToken
    && identity.executable === expectedExecutable
    && identity.instanceNonce === record.instanceNonce
  );
}
'''
source = replace_once(source, old_current, new_current, "current process identity validation")
old_terminate_and_identity = '''function terminateExactProcessGroup(pid, startedAt) {
  if (startedAt && processStartedAt(pid) !== startedAt) {
    const error = new Error("The live engine process identity changed before termination.");
    error.code = "ESRCH";
    throw error;
  }
  try {
    originalKill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH" || (startedAt && processStartedAt(pid) !== startedAt)) throw error;
    originalKill(pid, "SIGKILL");
  }
}

function requiredProcessStartedAt(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = processStartedAt(pid);
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return "";
}

function processStartedAt(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return "";
  const result = originalSpawnSync("/bin/ps", ["-p", String(value), "-o", "lstart="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function processCommand(pid) {
  const value = Number(pid);
  if (!Number.isInteger(value) || value <= 1) return "";
  const result = originalSpawnSync("/bin/ps", ["-ww", "-p", String(value), "-o", "command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}

function commandLineMatchesExecutable(command, executable) {
  const value = String(command || "").trim();
  return value === executable
    || value.startsWith(`${executable} `)
    || value.startsWith(`"${executable}" `)
    || value.startsWith(`'${executable}' `);
}
'''
new_terminate_and_identity = '''function terminateExactProcessGroup(record) {
  if (!liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: configuredExecutable,
  })) {
    const error = new Error("The live engine process identity changed before termination.");
    error.code = "ESRCH";
    throw error;
  }
  const pid = Number(record.pid);
  try {
    originalKill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH" || !liveEngineProcessRecordIsCurrent(record, {
      engineExecutable: configuredExecutable,
    })) throw error;
    originalKill(pid, "SIGKILL");
  }
}

function terminateSpawnedProcessGroup(pid) {
  try { originalKill(-Number(pid), "SIGKILL"); } catch {
    try { originalKill(Number(pid), "SIGKILL"); } catch {}
  }
}

function requiredProcessIdentity(pid) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const value = processIdentity(pid);
    if (value) return value;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  return null;
}

function processIdentity(pid) {
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

function identityHelperExecutable() {
  if (identityHelperPath) return identityHelperPath;
  try {
    identityHelperDirectory = originalMkdtempSync(join(tmpdir(), "swift-sim-process-identity-"));
    const output = join(identityHelperDirectory, "live-engine-identity");
    const compile = originalSpawnSync("/usr/bin/xcrun", [
      "clang",
      "-Os",
      "-Wall",
      "-Wextra",
      "-Werror",
      IDENTITY_HELPER_SOURCE,
      "-lproc",
      "-o",
      output,
    ], {
      encoding: "utf8",
      timeout: 30_000,
    });
    if (compile.status !== 0) {
      try { originalRmSync(identityHelperDirectory, { recursive: true, force: true }); } catch {}
      identityHelperDirectory = "";
      return "";
    }
    originalChmodSync(output, 0o700);
    identityHelperPath = output;
    process.once("exit", () => {
      try { originalRmSync(identityHelperDirectory, { recursive: true, force: true }); } catch {}
    });
    return identityHelperPath;
  } catch {
    return "";
  }
}

function processInstanceNonceFromPS(pid) {
  const result = originalSpawnSync("/bin/ps", ["eww", "-p", String(pid), "-o", "command="], {
    encoding: "utf8",
    timeout: 5_000,
  });
  return result.status === 0 ? environmentNonce(result.stdout) : "";
}

function environmentNonce(value) {
  return String(value || "").match(
    new RegExp(`(?:^|\\\\s)${ENGINE_INSTANCE_ENV}=([0-9a-f-]{36})(?:\\\\s|$)`, "i"),
  )?.[1] || "";
}

function canonicalPath(path) {
  const value = String(path || "");
  if (!value) return "";
  try {
    return resolve(originalRealpathSync.native ? originalRealpathSync.native(value) : originalRealpathSync(value));
  } catch {
    return resolve(value);
  }
}
'''
source = replace_once(source, old_terminate_and_identity, new_terminate_and_identity, "high-resolution process identity implementation")
path.write_text(source)


test_path = Path("test/liveEngineOwnershipPreload.test.js")
test_source = test_path.read_text()
old_first_test = '''test("live engine records require the exact process start identity", () => {
  const record = {
    version: 1,
    pid: 321,
    processGroup: 321,
    startedAt: "Sat Aug  1 23:00:00 2026",
    executable: "/tmp/InjectionNext",
  };
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: "/tmp/InjectionNext",
    startedAt: record.startedAt,
  }), true);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: "/tmp/InjectionNext",
    startedAt: "Sat Aug  1 23:01:00 2026",
  }), false);
  assert.equal(parseLiveEngineProcessRecord("not-json"), null);
});
'''
new_first_test = '''test("live engine records require the exact kernel start, executable, group, and nonce", () => {
  const executable = resolve(process.execPath);
  const record = {
    version: 2,
    pid: 321,
    processGroup: 321,
    startToken: "darwin:1780000000.123456",
    executable,
    instanceNonce: "11111111-1111-4111-8111-111111111111",
  };
  const identity = {
    startToken: record.startToken,
    processGroup: record.processGroup,
    executable,
    instanceNonce: record.instanceNonce,
  };
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity,
  }), true);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity: { ...identity, startToken: "darwin:1780000000.123457" },
  }), false);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity: { ...identity, executable: "/bin/sleep" },
  }), false);
  assert.equal(liveEngineProcessRecordIsCurrent(record, {
    engineExecutable: executable,
    identity: { ...identity, instanceNonce: "22222222-2222-4222-8222-222222222222" },
  }), false);
  assert.equal(liveEngineProcessRecordIsCurrent({
    version: 1,
    pid: 321,
    processGroup: 321,
    startedAt: "Sat Aug  1 23:00:00 2026",
    executable,
  }, { engineExecutable: executable, identity }), false);
  assert.equal(parseLiveEngineProcessRecord("321"), null);
  assert.equal(parseLiveEngineProcessRecord("not-json"), null);
});
'''
test_source = replace_once(test_source, old_first_test, new_first_test, "ownership unit test")
test_source = test_source.replace('      version: 1,\n      pid: sleeper.pid,\n      processGroup: sleeper.pid,\n      startedAt: "stale-start-identity",\n      executable: process.execPath,\n', '      version: 2,\n      pid: sleeper.pid,\n      processGroup: sleeper.pid,\n      startToken: "darwin:stale-start-identity",\n      executable: process.execPath,\n      instanceNonce: "33333333-3333-4333-8333-333333333333",\n', 1)
test_source = test_source.replace('    assert.equal(observed.record.version, 1);\n', '    assert.equal(observed.record.version, 2);\n    assert.match(observed.record.startToken, /^(?:darwin|linux):/);\n    assert.match(observed.record.instanceNonce, /^[0-9a-f-]{36}$/i);\n', 1)
test_path.write_text(test_source)
