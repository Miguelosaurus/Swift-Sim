from pathlib import Path

path = Path("mac-helper/src/deviceBuildRuntimeController.js")
text = path.read_text()

replacements = [
    (
        " * }} DeviceBuildRuntimeDependencies */\n */\n\nconst ACTIVE_BUILD_STATES",
        " * }} DeviceBuildRuntimeDependencies */\n\nconst ACTIVE_BUILD_STATES",
        "stray JSDoc terminator",
    ),
    (
        '    build.buildSettings = Array.isArray(values["build-setting"])\n      ? [...values["build-setting"]]\n      : [];\n',
        '    build.buildSettings = Array.isArray(values["build-setting"])\n      ? values["build-setting"]\n      : [];\n',
        "build-setting identity preservation",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
