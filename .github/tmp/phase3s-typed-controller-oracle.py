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
types = r'''
/** @typedef {import("./contracts/session.js").SessionStreamRecord} SessionStreamRecord */
/** @typedef {import("./infrastructure/ports.js").IdGenerator} IdGenerator */
/** @typedef {Omit<import("./contracts/session.js").SessionRecord, "logs" | "stream" | "simulatorUDID"> & {
 *   simulatorUDID: string,
 *   logs: string[],
 *   stream: SessionStreamRecord,
 *   orientation?: string,
 * }} SessionRecord
 * @typedef {SessionStreamRecord & { logs?: readonly string[] }} TransportStream
 * @typedef {{
 *   findReusable(input: { project: string, scheme: string, simulatorUDID: string, transport: string }): SessionRecord | null | undefined,
 *   create(input: { project: string, scheme: string, simulatorUDID: string, token: string, remoteBaseUrl: string, transport: string }): SessionRecord,
 *   save(session: SessionRecord): unknown,
 *   get(id: string): SessionRecord | null | undefined,
 * }} SessionStorePort
 * @typedef {{
 *   start(input: { simulatorUDID: string, port?: number }): Promise<TransportStream>,
 *   restart(session: SessionRecord): Promise<TransportStream>,
 *   stop(session: SessionRecord): Promise<unknown>,
 * }} SessionTransport
 * @typedef {{ ui(input: { simulatorUDID: string, args: string[] }): Promise<{ stdout?: string }> }} SimulatorUiPort
 * @typedef {{
 *   store: SessionStorePort,
 *   transports: Record<string, SessionTransport>,
 *   adapter: SimulatorUiPort,
 *   defaultTransportPreference(): string,
 *   idGenerator: IdGenerator,
 * }} SessionRuntimeDependencies
 * @typedef {{ project?: string, scheme?: string, simulator?: string, transport?: string, "remote-base-url"?: string, port?: string | number }} SessionStartInput
 * @typedef {{ reader: ReadableStreamDefaultReader<Uint8Array>, firstChunk: Uint8Array, contentType: string }} StreamingSource
 * @typedef {{ type?: unknown, x?: unknown, y?: unknown, scale?: unknown, velocity?: unknown }} GestureInput
 * @typedef {{ type: string, x: number, y: number, scale?: number, velocity?: number }} NormalizedGesture
 * @typedef {{ type?: unknown, x1?: unknown, y1?: unknown, x2?: unknown, y2?: unknown }} MultiTouchInput
 * @typedef {{ type: string, x1: number, y1: number, x2: number, y2: number }} NormalizedMultiTouch
 */
'''
controller = replace_once(
    controller,
    'import { resolvedSessionTransport, sessionTransportMatches } from "./sessionTransportPreference.js";\n',
    'import { resolvedSessionTransport, sessionTransportMatches } from "./sessionTransportPreference.js";\n' + types,
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

annotations = [
    ('  async function fetchWithTimeout(url, timeoutMs) {', '  /** @param {string} url @param {number} timeoutMs */\n  async function fetchWithTimeout(url, timeoutMs) {'),
    ('  async function proxyStream(res, session) {', '  /** @param {import("node:http").ServerResponse} res @param {SessionRecord} session */\n  async function proxyStream(res, session) {'),
    ('    let source;\n', '    /** @type {StreamingSource} */\n    let source;\n'),
    ('  async function openStreamingSource(session, timeoutMs = 5_000) {', '  /** @param {SessionRecord} session @param {number} [timeoutMs] @returns {Promise<StreamingSource>} */\n  async function openStreamingSource(session, timeoutMs = 5_000) {'),
    ('  function readStreamChunk(reader, timeoutMs) {', '  /** @param {ReadableStreamDefaultReader<Uint8Array>} reader @param {number} timeoutMs @returns {Promise<ReadableStreamReadResult<Uint8Array>>} */\n  function readStreamChunk(reader, timeoutMs) {'),
    ('  async function writeChunk(res, chunk) {', '  /** @param {import("node:http").ServerResponse} res @param {Uint8Array} chunk */\n  async function writeChunk(res, chunk) {'),
    ('  const streamRestarts = new Map();\n', '  /** @type {Map<string, Promise<void>>} */\n  const streamRestarts = new Map();\n'),
    ('  function restartStreamOnce(session) {', '  /** @param {SessionRecord} session @returns {Promise<void>} */\n  function restartStreamOnce(session) {'),
    ('  async function restartStream(session) {', '  /** @param {SessionRecord} session */\n  async function restartStream(session) {'),
    ('  async function startOrReuseSession(input, { includeCodexMetadata = false } = {}) {', '  /** @param {SessionStartInput} input @param {{ includeCodexMetadata?: boolean }} [options] */\n  async function startOrReuseSession(input, { includeCodexMetadata = false } = {}) {'),
    ('  async function stopSession(sessionId) {', '  /** @param {string} sessionId */\n  async function stopSession(sessionId) {'),
    ('  function transportForSession(session) {', '  /** @param {SessionRecord} session @returns {SessionTransport} */\n  function transportForSession(session) {'),
    ('  function publicStream(stream) {', '  /** @param {TransportStream} stream @returns {SessionStreamRecord} */\n  function publicStream(stream) {'),
    ('  async function sendControl(session, control) {', '  /** @param {SessionRecord} session @param {string} control */\n  async function sendControl(session, control) {'),
    ('  async function toggleSimulatorUI(simulatorUDID, option) {', '  /** @param {string} simulatorUDID @param {string} option */\n  async function toggleSimulatorUI(simulatorUDID, option) {'),
    ('  const caDebugStates = new Map();\n', '  /** @type {Map<string, "on" | "off">} */\n  const caDebugStates = new Map();\n'),
    ('  async function toggleCADebug(session, option) {', '  /** @param {SessionRecord} session @param {string} option */\n  async function toggleCADebug(session, option) {'),
    ('  async function typeIntoSimulator(session, typedText) {', '  /** @param {SessionRecord} session @param {string} typedText */\n  async function typeIntoSimulator(session, typedText) {'),
    ('  async function sendNamedKey(session, key) {', '  /** @param {SessionRecord} session @param {string} key */\n  async function sendNamedKey(session, key) {'),
    ('  async function sendKeyboardEvents(session, events) {', '  /** @param {SessionRecord} session @param {readonly unknown[]} events */\n  async function sendKeyboardEvents(session, events) {'),
    ('  async function tapSimulator(session, x, y) {', '  /** @param {SessionRecord} session @param {unknown} x @param {unknown} y */\n  async function tapSimulator(session, x, y) {'),
    ('  async function sendGesture(session, event) {', '  /** @param {SessionRecord} session @param {GestureInput} event */\n  async function sendGesture(session, event) {'),
    ('  async function sendMultiTouch(session, event) {', '  /** @param {SessionRecord} session @param {MultiTouchInput} event */\n  async function sendMultiTouch(session, event) {'),
    ('  async function sendTouch(session, payload) {', '  /** @param {SessionRecord} session @param {NormalizedGesture} payload */\n  async function sendTouch(session, payload) {'),
    ('  async function sendButton(session, button) {', '  /** @param {SessionRecord} session @param {string} button */\n  async function sendButton(session, button) {'),
    ('  async function sendRotation(session, orientation) {', '  /** @param {SessionRecord} session @param {string} orientation */\n  async function sendRotation(session, orientation) {'),
    ('  async function sendCADebug(session, option, enabled) {', '  /** @param {SessionRecord} session @param {string} option @param {boolean} enabled */\n  async function sendCADebug(session, option, enabled) {'),
    ('    const options = {\n      "slow-animations": "debug_slow_animations",\n    };\n', '    /** @type {Record<string, string>} */\n    const options = {\n      "slow-animations": "debug_slow_animations",\n    };\n'),
    ('  async function sendMemoryWarning(session) {', '  /** @param {SessionRecord} session */\n  async function sendMemoryWarning(session) {'),
    ('  function sessionWsUrl(session) {', '  /** @param {SessionRecord} session @returns {string} */\n  function sessionWsUrl(session) {'),
    ('  const inputChannels = new Map();\n', '  /** @type {Map<string, ServeSimInputChannel>} */\n  const inputChannels = new Map();\n'),
    ('  function sendServeSimMessage(session, opcode, payload) {', '  /** @param {SessionRecord} session @param {number} opcode @param {unknown} [payload] @returns {Promise<void>} */\n  function sendServeSimMessage(session, opcode, payload) {'),
    ('  function closeInputChannel(session) {', '  /** @param {SessionRecord} session */\n  function closeInputChannel(session) {'),
    ('    constructor(url) {', '    /** @param {string} url */\n    constructor(url) {'),
    ('      this.socket = null;\n      this.connecting = null;\n      this.pending = Promise.resolve();\n', '      /** @type {WebSocket | null} */\n      this.socket = null;\n      /** @type {Promise<WebSocket> | null} */\n      this.connecting = null;\n      /** @type {Promise<void>} */\n      this.pending = Promise.resolve();\n'),
    ('    send(opcode, payload) {', '    /** @param {number} opcode @param {unknown} payload @returns {Promise<void>} */\n    send(opcode, payload) {'),
    ('    connect() {', '    /** @returns {Promise<WebSocket>} */\n    connect() {'),
    ('  function sleep(ms) {', '  /** @param {number} ms */\n  function sleep(ms) {'),
    ('  function normalizeGestureEvent(event) {', '  /** @param {GestureInput} event @returns {NormalizedGesture} */\n  function normalizeGestureEvent(event) {'),
    ('    const normalized = {\n      type,\n      x: Math.max(0, Math.min(1, x)),\n      y: Math.max(0, Math.min(1, y)),\n    };\n', '    /** @type {NormalizedGesture} */\n    const normalized = {\n      type,\n      x: Math.max(0, Math.min(1, x)),\n      y: Math.max(0, Math.min(1, y)),\n    };\n'),
    ('  function normalizeMultiTouchEvent(event) {', '  /** @param {MultiTouchInput} event @returns {NormalizedMultiTouch} */\n  function normalizeMultiTouchEvent(event) {'),
    ('function validateDependencies(dependencies) {', '/** @param {SessionRuntimeDependencies} dependencies */\nfunction validateDependencies(dependencies) {'),
    ('function required(value, name) {', '/** @param {unknown} value @param {string} name @returns {string} */\nfunction required(value, name) {'),
]
for old, new in annotations:
    controller = replace_once(controller, old, new, f"annotation {old[:40]}")
controller_path.write_text(controller)

helper_path = root / "mac-helper/bin/swift-sim-helper.js"
helper = helper_path.read_text()
helper = replace_once(helper, '    defaultTransportPreference,\n  });\n', '    defaultTransportPreference,\n    idGenerator: runtime.idGenerator,\n  });\n', "helper id generator injection")
helper_path.write_text(helper)

runtime_path = root / "mac-helper/src/infrastructure/compatibilityHelperRuntime.js"
runtime = runtime_path.read_text()
runtime = replace_once(runtime, 'import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";\n', 'import { NativeCompanionTransport } from "../transports/nativeCompanionTransport.js";\nimport { SystemIdGenerator } from "./systemIdGenerator.js";\n', "runtime id generator import")
runtime = replace_once(runtime, ' *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,\n', ' *   createNativeCompanionTransport(input: { adapter: ServeSimAdapter }): NativeCompanionTransport,\n *   createIdGenerator(): SystemIdGenerator,\n', "runtime id generator factory type")
runtime = replace_once(runtime, ' *   adapter: ServeSimAdapter,\n', ' *   adapter: ServeSimAdapter,\n *   idGenerator: SystemIdGenerator,\n', "runtime id generator field type")
runtime = replace_once(runtime, '    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),\n', '    createNativeCompanionTransport: ({ adapter }) => new NativeCompanionTransport({ adapter }),\n    createIdGenerator: () => new SystemIdGenerator(),\n', "runtime id generator factory")
runtime = replace_once(runtime, '  const pairingStore = resolved.createPairingStore();\n  const adapter = resolved.createServeSimAdapter();\n  return {\n', '  const pairingStore = resolved.createPairingStore();\n  const adapter = resolved.createServeSimAdapter();\n  const idGenerator = resolved.createIdGenerator();\n  return {\n', "runtime id generator construction")
runtime = replace_once(runtime, '    adapter,\n    activeDeviceBuildTasks: new Map(),\n', '    adapter,\n    idGenerator,\n    activeDeviceBuildTasks: new Map(),\n', "runtime id generator field")
runtime = replace_once(runtime, '    "createServeSimAdapter",\n    "createSessionStore",\n', '    "createServeSimAdapter",\n    "createIdGenerator",\n    "createSessionStore",\n', "runtime id generator required factory")
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
session_test = replace_once(session_test, '      adapter,\n      defaultTransportPreference: () => "auto",\n', '      adapter,\n      defaultTransportPreference: () => "auto",\n      idGenerator: { randomUUID: () => "uuid-1", randomToken: (bytes) => `token-${bytes}` },\n', "session test id dependency")
session_test = replace_once(session_test, '        defaultTransportPreference: () => "auto",\n      }),\n    /adapter\\.ui/,\n', '        defaultTransportPreference: () => "auto",\n        idGenerator: { randomUUID: () => "uuid-1", randomToken: () => "token" },\n      }),\n    /adapter\\.ui/,\n', "session validation adapter case")
session_test = replace_once(session_test, '    () => createSessionRuntimeController({ store, transports: {}, adapter: { ui() {} } }),\n    /defaultTransportPreference/,\n  );\n', '    () => createSessionRuntimeController({ store, transports: {}, adapter: { ui() {} } }),\n    /defaultTransportPreference/,\n  );\n  assert.throws(\n    () =>\n      createSessionRuntimeController({\n        store,\n        transports: {},\n        adapter: { async ui() {} },\n        defaultTransportPreference: () => "auto",\n      }),\n    /idGenerator\\.randomToken/,\n  );\n', "session validation id case")
session_test_path.write_text(session_test)

run(["npx", "prettier", "--write", "mac-helper/src/sessionRuntimeController.js", "mac-helper/src/infrastructure/compatibilityHelperRuntime.js"], cwd=WORKTREE)
run(["node", "--test", "--test-concurrency=1", "test/sessionRuntimeController.test.js", "test/compatibilityHelperRuntime.test.js"], cwd=WORKTREE)
run(["npm", "run", "check:types"], cwd=WORKTREE)
