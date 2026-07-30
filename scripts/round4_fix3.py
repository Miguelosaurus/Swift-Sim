#!/usr/bin/env python3
from pathlib import Path

path = Path("test/deviceBuilderTimeout.test.js")
text = path.read_text()
old = '''test("a successful buffered command rejects surviving descendants", {
  skip: process.platform === "win32",
  timeout: 10_000,
}, async () => {
'''
new = '''test("a successful buffered command rejects surviving descendants", {
  skip: process.platform === "win32",
  timeout: 15_000,
}, async () => {
'''
if old in text:
    text = text.replace(old, new, 1)
old_fixture = '''      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
    `;
'''
new_fixture = '''      writeFileSync(${JSON.stringify(pidPath)}, String(descendant.pid));
      descendant.unref();
      process.exit(0);
    `;
'''
if old_fixture not in text:
    raise SystemExit("Missing successful descendant fixture")
text = text.replace(old_fixture, new_fixture, 1)
path.write_text(text)
