from pathlib import Path

controller = Path("mac-helper/src/deviceBuildRuntimeController.js")
text = controller.read_text()

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
    (
        '    const error = new Error("Device build was cancelled while delivery was starting.");\n    // @ts-expect-error Compatibility errors carry stable string codes.\n    error.code = "SWIFT_SIM_BUILD_CANCELLED";\n    throw error;\n',
        '    const error = Object.assign(\n      new Error("Device build was cancelled while delivery was starting."),\n      { code: "SWIFT_SIM_BUILD_CANCELLED" },\n    );\n    throw error;\n',
        "typed cancellation error",
    ),
    (
        '  /**\n   * @template Result\n   * @param {string} key\n   * @param {BuildRecord} build\n   * @param {() => Promise<Result> | Result} operation\n   * @returns {Promise<Result>}\n   */\n  function trackInternal(key, build, operation) {\n    return trackRegisteredDeviceBuildTask(\n      /** @type {Map<string, { build: BuildRecord, promise: Promise<Result> }>} */ (\n        /** @type {unknown} */ (activeTasks)\n      ),\n      key,\n      build,\n      operation,\n    );\n  }\n',
        '  /**\n   * @param {string} key\n   * @param {BuildRecord} build\n   * @param {() => Promise<unknown> | unknown} operation\n   * @returns {Promise<unknown>}\n   */\n  function trackInternal(key, build, operation) {\n    return trackRegisteredDeviceBuildTask(activeTasks, key, build, operation);\n  }\n',
        "task registry typing",
    ),
]

for old, new, label in replacements:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    text = text.replace(old, new, 1)

controller.write_text(text)

test_path = Path("test/deviceBuildRuntimeController.test.js")
test_text = test_path.read_text()

test_replacements = [
    (
        'test("delivery cleanup uses the injected clock, records outcomes, and prevents overlapping drains", async () => {',
        'test("delivery cleanup uses the injected clock, skips future jobs, and records outcomes", async () => {',
        "cleanup test claim",
    ),
    (
        '  let unblock;\n  const gate = new Promise((resolve) => { unblock = resolve; });\n',
        '',
        "unused cleanup gate",
    ),
    (
        '  unblock();\n  await gate;\n',
        '',
        "unused cleanup gate completion",
    ),
]

for old, new, label in test_replacements:
    count = test_text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    test_text = test_text.replace(old, new, 1)

test_path.write_text(test_text)
