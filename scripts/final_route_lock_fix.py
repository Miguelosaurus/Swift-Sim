from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text()


def write(path: str, value: str) -> None:
    Path(path).write_text(value)


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


live_path = "mac-helper/src/liveReload.js"
source = read(live_path)
source = replace_once(
    source,
    '''export async function routeLiveEditSet(options = {}) {
  const { runtime = {}, project = "", host = "", scheme = "" } = options;
  const injectedLifecycle = Boolean(runtime.inspect || runtime.inject || runtime.preflight);
  const recoveryEnabled = runtime.disableRecovery !== true
''',
    '''export async function routeLiveEditSet(options = {}) {
  const runtime = options.runtime || {};
  const injectedLifecycle = Boolean(
    runtime.inspect || runtime.inject || runtime.preflight || runtime.recover
  );
  if (!injectedLifecycle && runtime.lifecycleLocked !== true) {
    return withLiveEngineLifecycleLock(() => routeLiveEditSet({
      ...options,
      runtime: { ...runtime, lifecycleLocked: true },
    }));
  }
  const { project = "", host = "", scheme = "" } = options;
  const recoveryEnabled = runtime.disableRecovery !== true
''',
    "route lifecycle lease",
)
source = replace_once(
    source,
    '''  const recovery = await (runtime.recover || defaultRecoverLiveSession)({ project, host, scheme });
''',
    '''  const recovery = await (runtime.recover || defaultRecoverLiveSession)({
    project,
    host,
    scheme,
    lifecycleLocked: runtime.lifecycleLocked === true,
  });
''',
    "route recovery lifecycle context",
)
source = replace_once(
    source,
    '''  const inspect = runtime.inspect || ((options) => inspectLiveReload(options));
  const inject = runtime.inject || ((sourcePath, options = {}) => injectLiveSource(sourcePath, { ...runtime, ...options }));
''',
    '''  const inspect = runtime.inspect || (runtime.lifecycleLocked
    ? ((options) => inspectLiveReloadUnlocked(options))
    : ((options) => inspectLiveReload(options)));
  const inject = runtime.inject || (runtime.lifecycleLocked
    ? ((sourcePath, options = {}) => injectLiveSourceUnlocked(sourcePath, { ...runtime, ...options }))
    : ((sourcePath, options = {}) => injectLiveSource(sourcePath, { ...runtime, ...options })));
''',
    "route unlocked engine operations",
)
source = replace_once(
    source,
    '''async function defaultRecoverLiveSession({ project, host, scheme }) {
  try {
    const restarted = await startLiveReload({ project, host, scheme, forceRestart: true });
''',
    '''async function defaultRecoverLiveSession({ project, host, scheme, lifecycleLocked = false }) {
  const start = lifecycleLocked ? startLiveReloadUnlocked : startLiveReload;
  const inspect = lifecycleLocked ? inspectLiveReloadUnlocked : inspectLiveReload;
  try {
    const restarted = await start({ project, host, scheme, forceRestart: true });
''',
    "route recovery unlocked start",
)
source = replace_once(
    source,
    '''    let status = await inspectLiveReload({ project, host, scheme });
    while (Date.now() < deadline) {
      if (status.ready) return { ready: true, status };
      await delay(250);
      status = await inspectLiveReload({ project, host, scheme });
''',
    '''    let status = await inspect({ project, host, scheme });
    while (Date.now() < deadline) {
      if (status.ready) return { ready: true, status };
      await delay(250);
      status = await inspect({ project, host, scheme });
''',
    "route recovery unlocked inspection",
)
write(live_path, source)


test_path = "test/mainPostMergeIntegration.test.js"
test_source = read(test_path)
if 'test("production live routing holds one lifecycle lease"' not in test_source:
    test_source += '''\n\ntest("production live routing holds one lifecycle lease", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(source, /if \(!injectedLifecycle && runtime\.lifecycleLocked !== true\) \{\n    return withLiveEngineLifecycleLock/);
  assert.match(source, /runtime\.lifecycleLocked\n    \? \(\(options\) => inspectLiveReloadUnlocked\(options\)\)/);
  assert.match(source, /runtime\.lifecycleLocked\n    \? \(\(sourcePath, options = \{\}\) => injectLiveSourceUnlocked/);
  assert.match(source, /const start = lifecycleLocked \? startLiveReloadUnlocked : startLiveReload/);
});\n'''
write(test_path, test_source)
