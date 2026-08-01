from pathlib import Path

path = Path("test/mainPostMergeIntegration.test.js")
source = path.read_text()
marker = 'test("production live routing holds one lifecycle lease", () => {'
start = source.find(marker)
if start < 0:
    raise RuntimeError("Route lifecycle regression test marker is missing")
replacement = '''test("production live routing holds one lifecycle lease", () => {
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
path.write_text(source[:start] + replacement)
