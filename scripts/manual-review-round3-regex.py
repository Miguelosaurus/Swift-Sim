from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{path}: expected one match, found {count}")
    file.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, content: str) -> None:
    file = Path(path)
    text = file.read_text()
    if marker in text:
        raise SystemExit(f"{path}: marker already exists")
    file.write_text(text.rstrip() + "\n\n" + content.strip() + "\n")


replace_exact(
    "mac-helper/src/liveReload.js",
    '''  if (/#(?:externalMacro|freestanding|attached)\\b|@_dynamicReplacement\\b/.test(clean)) {
    return { unsupported: "Macros and explicit dynamic replacement require a rebuild." };
  }

  const imports =''',
    '''  if (/#(?:externalMacro|freestanding|attached)\\b|@_dynamicReplacement\\b/.test(clean)) {
    return { unsupported: "Macros and explicit dynamic replacement require a rebuild." };
  }
  if (swiftRegexLiteralPresent(source, clean)) {
    return { unsupported: "Swift regex literals require a rebuild." };
  }

  const imports =''',
)

replace_exact(
    "mac-helper/src/liveReload.js",
    '''function swiftAttributeSurface(source, clean) {
''',
    r'''function swiftRegexLiteralPresent(source, clean) {
  for (let index = 0; index < clean.length; index += 1) {
    let hashCount = 0;
    let slashIndex = index;
    if (clean[index] === "#") {
      while (clean[slashIndex] === "#") {
        hashCount += 1;
        slashIndex += 1;
      }
      if (clean[slashIndex] !== "/") continue;
    } else if (clean[index] !== "/" || clean[index + 1] === "/" || clean[index + 1] === "*") {
      continue;
    }
    if (!swiftRegexCanStart(clean, index)) continue;

    let escaped = false;
    let characterClass = false;
    for (let cursor = slashIndex + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (hashCount > 0) {
        if (character === "/"
            && source.startsWith("#".repeat(hashCount), cursor + 1)) {
          return true;
        }
        continue;
      }
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === "[") {
        characterClass = true;
        continue;
      }
      if (character === "]") {
        characterClass = false;
        continue;
      }
      if (character === "/" && !characterClass) return true;
      if (character === "\n") break;
    }
  }
  return false;
}

function swiftRegexCanStart(clean, index) {
  const prefix = clean.slice(0, index);
  const previous = prefix.match(/\S(?=\s*$)/)?.[0] || "";
  if (!previous || "=([{,:;!?&|".includes(previous)) return true;
  return /\b(?:return|throw|case|in|where|try|await|yield)\s*$/.test(prefix);
}

function swiftAttributeSurface(source, clean) {
''',
)

append_once(
    "test/mainPostMergeIntegration.test.js",
    "Swift regex literals fail closed before quote content can hide declarations",
    r'''test("Swift regex literals fail closed before quote content can hide declarations", () => {
  for (const literal of ['/"/', '#/"/#']) {
    const before = `struct Model {
  let pattern = ${literal}
  var count: Int = 0
}`;
    const after = before.replace("var count: Int", "var count: String");
    const result = classifySwiftSource(before, after);
    assert.equal(result.hotReloadable, false);
    assert.equal(result.reasonCode, LIVE_REASON_CODES.MACRO_OR_EXPLICIT_REPLACEMENT);
  }
});

test("ordinary division expressions remain hot reloadable", () => {
  const before = `func ratio() -> Int { total / count }`;
  const after = `func ratio() -> Int { total / divisor }`;
  const result = classifySwiftSource(before, after);
  assert.equal(result.hotReloadable, true);
  assert.equal(result.reasonCode, LIVE_REASON_CODES.IMPLEMENTATION_ONLY);
});''',
)

replace_exact("docs/MAIN_POST_MERGE_REVIEW_ROUND1.md", "| P1 | 28 | 28 | 0 |", "| P1 | 29 | 29 | 0 |")
replace_exact(
    "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md",
    "28. Persisted device-build and validation worker journals use the collision-resistant kernel start token, executable, and process-group identity; restart recovery never signals a live legacy, unverifiable, or PID-reused worker record.\n",
    "28. Persisted device-build and validation worker journals use the collision-resistant kernel start token, executable, and process-group identity; restart recovery never signals a live legacy, unverifiable, or PID-reused worker record.\n"
    "29. Swift bare and extended regex literals fail closed to rebuild before quote or delimiter content can desynchronize the declaration scanner; ordinary division expressions remain eligible for implementation-only hot reload.\n",
)

Path(".github/workflows/manual-review-round3-regex.yml").unlink(missing_ok=True)
Path("scripts/manual-review-round3-regex.py").unlink(missing_ok=True)
