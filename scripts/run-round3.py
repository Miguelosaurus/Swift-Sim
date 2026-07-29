#!/usr/bin/env python3
from pathlib import Path
import runpy

path = Path("scripts/apply-round3.py")
text = path.read_text()
text = text.replace("devicePageMatch", "deviceWebMatch")
text = text.replace(
    "re.subn(pattern, replacement, text, count=1, flags=re.S)",
    "re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)",
)
patched = Path("scripts/.apply-round3-runtime.py")
patched.write_text(text)
try:
    runpy.run_path(str(patched), run_name="__main__")
finally:
    patched.unlink(missing_ok=True)
