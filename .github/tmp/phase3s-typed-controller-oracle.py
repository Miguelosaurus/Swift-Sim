from __future__ import annotations

import subprocess
from pathlib import Path

BASE = "cd8d32fc2deda31d731d821d59310083640e4dc1"
WORKTREE = "/tmp/phase3s-typed-controller"


def run(command: list[str], *, cwd: str | None = None) -> None:
    subprocess.run(command, cwd=cwd, check=True)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


run(["git", "worktree", "add", WORKTREE, BASE])
run(["npm", "ci"], cwd=WORKTREE)
root = Path(WORKTREE)

controller_path = root / "mac-helper/src/sessionRuntimeController.js"
controller = controller_path.read_text()
controller = "// @ts-check\n" + controller
controller = replace_once(controller, 'import { randomBytes } from "node:crypto";\n', '', "controller crypto import")
controller = replace_once(
    controller,
    'import { resolvedSessionTransport, sessionTransportMatches } from "./sessionTransportPreference.js";\n',
    'import { resolvedSessionTransport, sessionTransportMatches } from "./sessionTransportPreference.js";\n\n/** @typedef {import("./infrastructure/ports.js").IdGenerator} IdGenerator */\n/** @typedef {{\n *   store: any,\n *   transports: Record<string, any>,\n *   adapter: { ui(input: any): Promise<any> },\n *   defaultTransportPreference(): string,\n *   idGenerator: IdGenerator,\n * }} SessionRuntimeDependencies */\n',
    "controller dependency types",
)
controller = replace_once(
    controller,
    'export function createSessionRuntimeController(dependencies) {\n',
    '/** @param {SessionRuntimeDependencies} dependencies */\nexport function createSessionRuntimeController(dependencies) {\n',
    "controller dependency annotation",
)
controller = replace_once(
    controller,
    '      token: randomBytes(24).toString("base64url"),\n',
    '      token: dependencies.idGenerator.randomToken(24),\n',
    "controller token seam",
)
controller = replace_once(
    controller,
    '  if (typeof dependencies?.defaultTransportPreference !== "function") {\n    throw new TypeError("Session runtime controller requires defaultTransportPreference().");\n  }\n',
    '  if (typeof dependencies?.defaultTransportPreference !== "function") {\n    throw new TypeError("Session runtime controller requires defaultTransportPreference().");\n  }\n  if (typeof dependencies?.idGenerator?.randomToken !== "function") {\n    throw new TypeError("Session runtime controller requires idGenerator.randomToken().");\n  }\n',
    "controller id generator validation",
)
controller_path.write_text(controller)

helper_path = root / "mac-helper/bin/swift-sim-helper.js"
helper = helper_path.read_text()
helper = replace_once(
    helper,
    '    defaultTransportPreference,\n  });\n',
    '    defaultTransportPreference,\n    idGenerator: runtime.idGenerator,\n  });\n',
    "helper id generator injection",
)
helper_path.write_text(helper)

runtime_path = root / "mac-helper/src/infrastructure/compatibilityHelperRuntime.js"
runtime = runtime_path.read_text()
runtime = replace_once(
    runtime,
    'import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";\n',
    'import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";\nimport { SystemIdGenerator } from "./systemIdGenerator.js";\n',
    "runtime id generator import",
)
runtime = replace_once(
    runtime,
    ' *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,\n',
    ' *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,\n *   createIdGenerator(): SystemIdGenerator,\n',
    "runtime id generator factory type",
)
runtime = replace_once(
    runtime,
    ' *   adapter: ServeSimAdapter,\n',
    ' *   adapter: ServeSimAdapter,\n *   idGenerator: SystemIdGenerator,\n',
    "runtime id generator field type",
)
runtime = replace_once(
    runtime,
    '    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),\n',
    '    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),\n    createIdGenerator: () => new SystemIdGenerator(),\n',
    "runtime id generator factory",
)
runtime = replace_once(
    runtime,
    '  const pairingStore = resolved.createPairingStore();\n  const adapter = resolved.createServeSimAdapter();\n  return {\n',
    '  const pairingStore = resolved.createPairingStore();\n  const adapter = resolved.createServeSimAdapter();\n  const idGenerator = resolved.createIdGenerator();\n  return {\n',
    "runtime id generator construction",
)
runtime = replace_once(runtime, '    adapter,\n    activeDeviceBuildTasks: new Map(),\n', '    adapter,\n    idGenerator,\n    activeDeviceBuildTasks: new Map(),\n', "runtime id generator field")
runtime = replace_once(
    runtime,
    '    "createServeSimAdapter",\n    "createSessionStore",\n',
    '    "createServeSimAdapter",\n    "createIdGenerator",\n    "createSessionStore",\n',
    "runtime id generator required factory",
)
runtime_path.write_text(runtime)

runtime_test_path = root / "test/compatibilityHelperRuntime.test.js"
runtime_test = runtime_test_path.read_text()
runtime_test = replace_once(runtime_test, '    "createDeviceInventory",\n  ].map', '    "createDeviceInventory",\n    "createIdGenerator",\n  ].map', "runtime test id value")
runtime_test = replace_once(runtime_test, '  assert.strictEqual(runtime.adapter, adapter);\n', '  assert.strictEqual(runtime.adapter, adapter);\n  assert.strictEqual(runtime.idGenerator, values.createIdGenerator);\n', "runtime test id assertion")
runtime_test = replace_once(runtime_test, '    "createServeSimAdapter",\n    "createSessionStore",\n', '    "createServeSimAdapter",\n    "createIdGenerator",\n    "createSessionStore",\n', "runtime test id order")
runtime_test = replace_once(runtime_test, '    createNativeCompanionTransport: factory,\n  };\n', '    createNativeCompanionTransport: factory,\n    createIdGenerator: factory,\n  };\n', "runtime test id factory")
runtime_test_path.write_text(runtime_test)

session_test_path = root / "test/sessionRuntimeController.test.js"
session_test = session_test_path.read_text()
session_test = replace_once(
    session_test,
    '      adapter,\n      defaultTransportPreference: () => "auto",\n',
    '      adapter,\n      defaultTransportPreference: () => "auto",\n      idGenerator: { randomUUID: () => "uuid-1", randomToken: (bytes) => `token-${bytes}` },\n',
    "session test id dependency",
)
session_test = replace_once(
    session_test,
    '        defaultTransportPreference: () => "auto",\n      }),\n    /adapter\\.ui/,\n',
    '        defaultTransportPreference: () => "auto",\n        idGenerator: { randomUUID: () => "uuid-1", randomToken: () => "token" },\n      }),\n    /adapter\\.ui/,\n',
    "session validation adapter case",
)
session_test = replace_once(
    session_test,
    '    () => createSessionRuntimeController({ store, transports: {}, adapter: { ui() {} } }),\n    /defaultTransportPreference/,\n  );\n',
    '    () => createSessionRuntimeController({ store, transports: {}, adapter: { ui() {} } }),\n    /defaultTransportPreference/,\n  );\n  assert.throws(\n    () =>\n      createSessionRuntimeController({\n        store,\n        transports: {},\n        adapter: { async ui() {} },\n        defaultTransportPreference: () => "auto",\n      }),\n    /idGenerator\\.randomToken/,\n  );\n',
    "session validation id case",
)
session_test_path.write_text(session_test)

run(["npx", "prettier", "--write", "mac-helper/src/sessionRuntimeController.js", "mac-helper/src/infrastructure/compatibilityHelperRuntime.js"], cwd=WORKTREE)
run(["node", "--test", "--test-concurrency=1", "test/sessionRuntimeController.test.js", "test/compatibilityHelperRuntime.test.js"], cwd=WORKTREE)
run(["npm", "run", "check:types"], cwd=WORKTREE)
