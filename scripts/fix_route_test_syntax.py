from pathlib import Path

path = Path("test/mainPostMergeIntegration.test.js")
source = path.read_text()
before = '''test("production live routing holds one lifecycle lease", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(source, /if \\(!injectedLifecycle && runtime\\.lifecycleLocked !== true\\) \\{
    return withLiveEngineLifecycleLock/);
  assert.match(source, /runtime\\.lifecycleLocked
    \\? \\(\\(options\\) => inspectLiveReloadUnlocked\\(options\\)\\)/);
  assert.match(source, /runtime\\.lifecycleLocked
    \\? \\(\\(sourcePath, options = \\{\\}\\) => injectLiveSourceUnlocked/);
  assert.match(source, /const start = lifecycleLocked \\? startLiveReloadUnlocked : startLiveReload/);
});
'''
after = '''test("production live routing holds one lifecycle lease", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.ok(source.includes(
    "if (!injectedLifecycle && runtime.lifecycleLocked !== true) {\\n"
      + "    return withLiveEngineLifecycleLock",
  ));
  assert.ok(source.includes(
    "runtime.lifecycleLocked\\n"
      + "    ? ((options) => inspectLiveReloadUnlocked(options))",
  ));
  assert.ok(source.includes(
    "runtime.lifecycleLocked\\n"
      + "    ? ((sourcePath, options = {}) => injectLiveSourceUnlocked",
  ));
  assert.ok(source.includes(
    "const start = lifecycleLocked ? startLiveReloadUnlocked : startLiveReload",
  ));
});
'''
count = source.count(before)
if count != 1:
    raise RuntimeError(f"Expected one broken route test block, found {count}")
path.write_text(source.replace(before, after, 1))
