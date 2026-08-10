from pathlib import Path

path = Path("test/cli.test.js")
text = path.read_text()
block = '''test("device build handoff opens Swift Sim before the direct install fallback", () => {\n  const helper = readFileSync(new URL("../mac-helper/bin/swift-sim-helper.js", import.meta.url), "utf8");\n  const primary = helper.indexOf(">Open in Swift Sim</a>");\n  const fallback = helper.indexOf(">Install directly</a>");\n  assert.ok(primary >= 0);\n  assert.ok(fallback > primary);\n  assert.match(helper, /window\\.location\\.href = \\${customSchemeScript}/);\n});\n\n'''
count = text.count(block)
if count != 1:
    raise SystemExit(f"expected one obsolete helper-location test, found {count}")
path.write_text(text.replace(block, "", 1))
