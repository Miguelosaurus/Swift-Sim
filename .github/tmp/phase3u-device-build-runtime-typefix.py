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
    (
        '/** @typedef {{ mode?: string, provider?: string, expiresAt?: string, generation?: string, referenceID?: string }} BuildDelivery */',
        '/** @typedef {{ mode?: string, provider?: string | undefined, expiresAt?: string | undefined, generation?: string, referenceID?: string }} BuildDelivery */',
        "exact optional delivery projection",
    ),
    (
        '    activeTasks: () => [...activeTasks.values()],\n    cancelBuild: (build, reason) => dependencies.requestCancellation(build, reason),\n  });\n\n  /** @param {Record<string, unknown>} values */',
        '    activeTasks: () => [...activeTasks.values()],\n    cancelBuild,\n  });\n\n  /** @param {BuildRecord} build @param {string} reason */\n  function cancelBuild(build, reason) {\n    return dependencies.requestCancellation(build, reason);\n  }\n\n  /** @param {Record<string, unknown>} values */',
        "typed cancelBuild boundary",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    text = text.replace(old, new, 1)

path.write_text(text)
