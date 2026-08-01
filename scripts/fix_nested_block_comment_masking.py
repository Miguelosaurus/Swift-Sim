from pathlib import Path


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise RuntimeError(f"Expected one {label} anchor, found {count}")
    return source.replace(before, after, 1)


live_path = Path("mac-helper/src/liveReload.js")
source = live_path.read_text()
before = '''function maskCommentsAndStrings(source) {
  let output = "";
  let mode = "code";
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\\n") {
        mode = "code";
        output += char;
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        mode = "code";
      } else output += char === "\\n" ? "\\n" : " ";
      continue;
    }
    if (mode === "string") {
      if (escaped) escaped = false;
      else if (char === "\\\\") escaped = true;
      else if (char === "\\\"") mode = "code";
      output += char === "\\n" ? "\\n" : " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
    } else if (char === "\\\"") {
      output += " ";
      mode = "string";
    } else {
      output += char;
    }
  }
  return output;
}
'''
after = '''function maskCommentsAndStrings(source) {
  let output = "";
  let mode = "code";
  let escaped = false;
  let blockCommentDepth = 0;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (mode === "line-comment") {
      if (char === "\\n") {
        mode = "code";
        output += char;
      } else output += " ";
      continue;
    }
    if (mode === "block-comment") {
      if (char === "/" && next === "*") {
        output += "  ";
        index += 1;
        blockCommentDepth += 1;
      } else if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        blockCommentDepth -= 1;
        if (blockCommentDepth === 0) mode = "code";
      } else output += char === "\\n" ? "\\n" : " ";
      continue;
    }
    if (mode === "string") {
      if (escaped) escaped = false;
      else if (char === "\\\\") escaped = true;
      else if (char === "\\\"") mode = "code";
      output += char === "\\n" ? "\\n" : " ";
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      mode = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      mode = "block-comment";
      blockCommentDepth = 1;
    } else if (char === "\\\"") {
      output += " ";
      mode = "string";
    } else {
      output += char;
    }
  }
  return output;
}
'''
source = replace_once(source, before, after, "comment masker")
live_path.write_text(source)


test_path = Path("test/mainPostMergeIntegration.test.js")
test_source = test_path.read_text()
if 'test("nested block comments cannot truncate runtime availability scanning"' not in test_source:
    test_source += '''\n\ntest("nested block comments cannot truncate runtime availability scanning", () => {
  const before = `func value() -> Int {
  if #available(/* outer /* inner */ ) still outer */ iOS 18, *) { return 1 }
  return 0
}`;
  const after = before.replace("iOS 18", "iOS 19");
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, false);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.DECLARATION_CHANGED);
});\n'''
test_path.write_text(test_source)
