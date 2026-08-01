from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


live_path = Path("mac-helper/src/liveReload.js")
live = live_path.read_text()
live = replace_once(
    live,
    'export async function registerLiveBuildResult({ resultBundle }) {\n',
    '''export async function registerLiveBuildResult(options) {
  return withLiveEngineLifecycleLock(() => registerLiveBuildResultUnlocked(options));
}

async function registerLiveBuildResultUnlocked({ resultBundle }) {
''',
    "live build registration",
)
live = replace_once(
    live,
    'export async function injectLiveSource(sourcePath, runtime = {}) {\n',
    '''export async function injectLiveSource(sourcePath, runtime = {}) {
  if (typeof runtime.engineControl === "function") {
    return injectLiveSourceUnlocked(sourcePath, runtime);
  }
  return withLiveEngineLifecycleLock(() => injectLiveSourceUnlocked(sourcePath, runtime));
}

async function injectLiveSourceUnlocked(sourcePath, runtime = {}) {
''',
    "live source injection",
)
live_path.write_text(live)


test_path = Path("test/mainPostMergeIntegration.test.js")
test_source = test_path.read_text()
marker = 'test("engine-mutating live operations hold the lifecycle lock"'
if marker not in test_source:
    test_source += '''\n\ntest("engine-mutating live operations hold the lifecycle lock", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(
    source,
    /export async function registerLiveBuildResult\(options\) \{\n  return withLiveEngineLifecycleLock\(\(\) => registerLiveBuildResultUnlocked\(options\)\);/,
  );
  assert.match(
    source,
    /export async function injectLiveSource\(sourcePath, runtime = \{\}\) \{[\s\S]*return withLiveEngineLifecycleLock\(\(\) => injectLiveSourceUnlocked\(sourcePath, runtime\)\);/,
  );
  assert.match(
    source,
    /if \(typeof runtime\.engineControl === "function"\) \{\n    return injectLiveSourceUnlocked\(sourcePath, runtime\);/,
  );
});
'''
test_path.write_text(test_source)

print("Applied final live-engine operation locking.")
