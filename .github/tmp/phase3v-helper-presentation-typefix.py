from pathlib import Path

path = Path("mac-helper/src/http/helperPresentation.js")
text = path.read_text()
old = " *   expiresAt?: string,\n"
new = " *   expiresAt: string,\n"
count = text.count(old)
if count != 1:
    raise SystemExit(f"expected one expiresAt typedef anchor, found {count}")
path.write_text(text.replace(old, new, 1))
