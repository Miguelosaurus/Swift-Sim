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
    '''  if (beforeSurface.modifiers !== afterSurface.modifiers) {
''',
    '''  if (beforeSurface.attributes !== afterSurface.attributes) {
    return result(
      "rebuild-required",
      false,
      "A declaration attribute or property-wrapper argument changed.",
      paths,
      LIVE_REASON_CODES.DECLARATION_CHANGED,
    );
  }
  if (beforeSurface.modifiers !== afterSurface.modifiers) {
''',
    "balanced attribute comparison",
)
live = replace_once(
    live,
    '''  const modifiers = [...clean.matchAll(/^\\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\\s*\\((?:[^()\\n]|\\([^()]*\\))*\\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\\b)/gm)]
''',
    '''  const attributes = swiftAttributeSurface(source, clean);
  const modifiers = [...clean.matchAll(/^\\s*((?:(?:@[A-Za-z_][A-Za-z0-9_.]*(?:\\s*\\((?:[^()\\n]|\\([^()]*\\))*\\))?|public|private|fileprivate|internal|open|package|nonisolated|static|final|mutating|consuming|borrowing)\\s+)+)(?=(?:actor|class|deinit|enum|extension|func|init|let|operator|precedencegroup|protocol|struct|subscript|typealias|var)\\b)/gm)]
''',
    "balanced attribute surface",
)
live = replace_once(
    live,
    '''    compilerConditions,
    modifiers,
''',
    '''    compilerConditions,
    attributes,
    modifiers,
''',
    "attribute projection",
)
live = replace_once(
    live,
    '''function typeDeclarationRanges(source) {
''',
    '''function swiftAttributeSurface(source, clean) {
  const attributes = [];
  for (let index = 0; index < clean.length; index += 1) {
    if (clean[index] !== "@") continue;
    const previous = clean[index - 1] || "";
    if (/[A-Za-z0-9_]/.test(previous)) continue;
    let end = index + 1;
    if (!/[A-Za-z_]/.test(clean[end] || "")) continue;
    while (/[A-Za-z0-9_.]/.test(clean[end] || "")) end += 1;
    let cursor = end;
    while (/\\s/.test(clean[cursor] || "")) cursor += 1;
    if (clean[cursor] === "(") {
      let depth = 0;
      for (; cursor < clean.length; cursor += 1) {
        if (clean[cursor] === "(") depth += 1;
        else if (clean[cursor] === ")") {
          depth -= 1;
          if (depth === 0) {
            cursor += 1;
            break;
          }
        }
      }
      if (depth === 0) end = cursor;
    }
    attributes.push(compact(source.slice(index, end)));
    index = Math.max(index, end - 1);
  }
  return attributes.join("\\n");
}

function typeDeclarationRanges(source) {
''',
    "balanced attribute scanner",
)
live_path.write_text(live)


test_path = Path("test/mainPostMergeIntegration.test.js")
tests = test_path.read_text()
tests += '''

test("deeply nested attribute arguments require a rebuild", () => {
  const before = `struct Model {
  @Wrapper(configuration: .init(value: .init(raw: 1)))
  var value: Int
}`;
  const after = before.replace("raw: 1", "raw: 2");
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("multiline attribute arguments require a rebuild", () => {
  const before = `struct Model {
  @Wrapper(
    configuration: .init(
      value: 1
    )
  )
  var value: Int
}`;
  const after = before.replace("value: 1", "value: 2");
  assert.equal(classifySwiftSource(before, after).hotReloadable, false);
});

test("attribute-looking text in strings and comments does not change the surface", () => {
  const before = `func value() -> String { "@Wrapper(value: 1)" } // @Other(value: 1)`;
  const after = `func value() -> String { "@Wrapper(value: 2)" } // @Other(value: 2)`;
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, true);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.IMPLEMENTATION_ONLY);
});
'''
test_path.write_text(tests)

print("Applied balanced Swift attribute classification.")
