from pathlib import Path

path = Path("scripts/architecture/baseline-policy.json")
text = path.read_text()
needle = '      "mac-helper/bin/swift-sim-helper.js",\n'
count = text.count(needle)
if count != 2:
    raise SystemExit(f"expected helper oversized debt in baseline and caps, found {count}")
path.write_text(text.replace(needle, ""))
