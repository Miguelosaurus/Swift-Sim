from pathlib import Path

path = Path("scripts/architecture/baseline-policy.json")
text = path.read_text()
needle = '      "mac-helper/bin/swift-sim-helper.js",\n'
count = text.count(needle)
if count != 2:
    raise SystemExit(f"expected helper oversized debt in baseline and caps, found {count}")

caps_index = text.index('  "caps": {')
cap_index = text.index(needle, caps_index)
path.write_text(text[:cap_index] + text[cap_index + len(needle):])
