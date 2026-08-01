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
    '''  const compilerConditions = [
    ...clean.matchAll(/^\\s*#(?:if|elseif|else|endif)\\b[^\\n]*/gm),
    ...clean.matchAll(/#(?:available|unavailable)\\s*\\([^\\n)]*\\)/g),
  ]
    .map((match) => compact(match[0]))
    .join("\\n");
''',
    '''  const compilerConditions = [
    ...[...clean.matchAll(/^\\s*#(?:if|elseif|else|endif)\\b[^\\n]*/gm)]
      .map((match) => compact(match[0])),
    ...swiftRuntimeAvailabilitySurface(source, clean),
  ].join("\\n");
''',
    "runtime availability collection",
)
live = replace_once(
    live,
    '''function typeDeclarationRanges(source) {
''',
    '''function swiftRuntimeAvailabilitySurface(source, clean) {
  const conditions = [];
  const tokens = ["#available", "#unavailable"];
  for (let index = 0; index < clean.length; index += 1) {
    const token = tokens.find((candidate) => clean.startsWith(candidate, index));
    if (!token) continue;
    const previous = clean[index - 1] || "";
    const next = clean[index + token.length] || "";
    if (/[A-Za-z0-9_]/.test(previous) || /[A-Za-z0-9_]/.test(next)) continue;
    let cursor = index + token.length;
    while (/\\s/.test(clean[cursor] || "")) cursor += 1;
    if (clean[cursor] !== "(") continue;
    let depth = 0;
    let end = clean.length;
    for (; cursor < clean.length; cursor += 1) {
      if (clean[cursor] === "(") depth += 1;
      else if (clean[cursor] === ")") {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
      }
    }
    conditions.push(compact(source.slice(index, end)));
    index = Math.max(index, end - 1);
  }
  return conditions;
}

function typeDeclarationRanges(source) {
''',
    "runtime availability scanner insertion",
)
live_path.write_text(live)


test_path = Path("test/mainPostMergeIntegration.test.js")
test_source = test_path.read_text()
if 'test("multiline runtime availability changes require a rebuild"' not in test_source:
    test_source += '''\n\ntest("multiline runtime availability changes require a rebuild", () => {
  const before = `func value() -> Int {
  if #available(
    iOS 18,
    *
  ) { return 1 }
  return 0
}`;
  const after = before.replace("iOS 18", "iOS 19");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});

test("multiline runtime unavailability changes require a rebuild", () => {
  const before = `func value() -> Int {
  if #unavailable(
    iOS 18,
    *
  ) { return 0 }
  return 1
}`;
  const after = before.replace("iOS 18", "iOS 19");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});
'''
test_path.write_text(test_source)

print("Applied balanced multiline runtime availability classification.")
