from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


def replace_first_after(source: str, marker: str, before: str, after: str, label: str) -> str:
    marker_index = source.find(marker)
    if marker_index < 0:
        raise RuntimeError(f"Missing section marker for {label}")
    index = source.find(before, marker_index)
    if index < 0:
        raise RuntimeError(f"Missing replacement anchor: {label}")
    return source[:index] + after + source[index + len(before):]


live_path = Path("mac-helper/src/liveReload.js")
live = live_path.read_text()
live = replace_once(
    live,
    'export async function inspectLiveReload({ project = "", host = "" } = {}) {\n',
    '''export async function inspectLiveReload(options = {}) {
  return withLiveEngineLifecycleLock(() => inspectLiveReloadUnlocked(options));
}

async function inspectLiveReloadUnlocked({ project = "", host = "" } = {}) {
''',
    "inspect lifecycle wrapper",
)
live = replace_first_after(
    live,
    "async function startLiveReloadUnlocked",
    '  let status = await inspectLiveReload({ project, host });\n',
    '  let status = await inspectLiveReloadUnlocked({ project, host });\n',
    "initial locked start inspection",
)
live = replace_first_after(
    live,
    "async function startLiveReloadUnlocked",
    '  status = await inspectLiveReload({ project, host });\n',
    '  status = await inspectLiveReloadUnlocked({ project, host });\n',
    "final locked start inspection",
)
live = replace_once(
    live,
    '''  const modifiers = [...clean.matchAll(/^\\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\\s*\\((?:[^()\\n]|\\([^()]*\\))*\\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\\b)/gm)]
    .map((match) => compact(match[1]))
    .sort()
    .join("\\n");''',
    '''  const modifiers = [...clean.matchAll(/^\\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\\s*\\((?:[^()\\n]|\\([^()]*\\))*\\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\\b)/gm)]
    .map((match) => {
      const captureOffset = match[0].indexOf(match[1]);
      const start = match.index + captureOffset;
      return compact(source.slice(start, start + match[1].length));
    })
    .join("\\n");''',
    "source-preserving modifier surface",
)
live_path.write_text(live)

session_path = Path("Companion/SwiftSimCompanion/SessionStore.swift")
session = session_path.read_text()
session = replace_once(
    session,
    '''        pairingAttemptRevision &+= 1
        let attemptRevision = pairingAttemptRevision
''',
    '''        pairingAttemptRevision &+= 1
        connectionChecksRevision &+= 1
        let attemptRevision = pairingAttemptRevision
''',
    "pair attempt diagnostics invalidation",
)
session_path.write_text(session)

test_path = Path("test/mainPostMergeIntegration.test.js")
tests = test_path.read_text()
tests += '''

test("string-valued property-wrapper arguments require a rebuild", () => {
  const before = `struct Model {
  @State(initialValue: "before") var value: String
}`;
  const after = before.replace('"before"', '"after"');
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("property wrappers remain associated with their declarations", () => {
  const before = `struct Model {
  @State var first: Int = 0
  @Binding var second: Int
}`;
  const after = `struct Model {
  @Binding var first: Int = 0
  @State var second: Int
}`;
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("live engine inspection is serialized with replacement", () => {
  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(
    source,
    /export async function inspectLiveReload\\(options = \\{\\}\\) \\{\\n  return withLiveEngineLifecycleLock/,
  );
  assert.match(source, /let status = await inspectLiveReloadUnlocked/);
});
'''
test_path.write_text(tests)

print("Applied merged-main follow-up fixes.")
