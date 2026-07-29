#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f"Missing expected block in {path}: {old[:120]!r}")
    if text.count(old) != 1:
        raise SystemExit(f"Expected one match in {path}, found {text.count(old)}")
    file.write_text(text.replace(old, new, 1))


def append_once(path: str, marker: str, addition: str) -> None:
    file = Path(path)
    text = file.read_text()
    if addition in text:
        return
    if marker not in text:
        raise SystemExit(f"Missing append marker in {path}")
    file.write_text(text.replace(marker, marker + addition, 1))

# Populated in the next revision after exact source blocks are verified.
print("round3 patch scaffold")
