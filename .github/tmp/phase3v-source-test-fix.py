from pathlib import Path

path = Path("test/cli.test.js")
text = path.read_text()
start_marker = 'test("device build handoff opens Swift Sim before the direct install fallback", () => {\n'
next_marker = 'test("setup installs the bundled Codex marketplace and plugin", () => {\n'

if text.count(start_marker) != 1:
    raise SystemExit(f"expected one obsolete helper-location test start, found {text.count(start_marker)}")
if text.count(next_marker) != 1:
    raise SystemExit(f"expected one following CLI test anchor, found {text.count(next_marker)}")

start = text.index(start_marker)
end = text.index(next_marker, start)
path.write_text(text[:start] + text[end:])
