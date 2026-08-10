from __future__ import annotations

import subprocess
from pathlib import Path

source = Path(".github/tmp/phase3s-typed-controller-oracle.py").read_text()


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


source = replace_once(
    source,
    '/** @typedef {Omit<import("./contracts/session.js").SessionRecord, "logs" | "stream" | "simulatorUDID"> & {\n *   simulatorUDID: string,\n *   logs: string[],\n *   stream: SessionStreamRecord,\n *   orientation?: string,\n * }} SessionRecord',
    '/** @typedef {Omit<import("./contracts/session.js").SessionRecord, "logs" | "stream" | "simulatorUDID" | "remoteBaseUrl"> & {\n *   simulatorUDID: string,\n *   logs: string[],\n *   stream: SessionStreamRecord,\n *   remoteBaseUrl: string,\n *   orientation?: string,\n * }} SessionRecord',
    "session remote base refinement",
)
source = replace_once(
    source,
    ' *   start(input: { simulatorUDID: string, port?: number }): Promise<TransportStream>,',
    ' *   start(input: { simulatorUDID: string, port?: number | undefined }): Promise<TransportStream>,',
    "transport exact-optional port",
)
source = replace_once(
    source,
    ' * @typedef {{ reader: ReadableStreamDefaultReader<Uint8Array>, firstChunk: Uint8Array, contentType: string }} StreamingSource\n',
    ' * @typedef {{ reader: ReadableStreamDefaultReader<Uint8Array>, firstChunk: Uint8Array, contentType: string }} StreamingSource\n * @typedef {{ done: boolean, value?: Uint8Array | undefined }} StreamReadResult\n',
    "stream read result typedef",
)
source = replace_once(
    source,
    'Promise<ReadableStreamReadResult<Uint8Array>>',
    'Promise<StreamReadResult>',
    "stream read result return type",
)

patch_anchor = 'for old, new in annotations:\n    controller = replace_once(controller, old, new, f"annotation {old[:40]}")\ncontroller_path.write_text(controller)\n'
patch_body = '''for old, new in annotations:
    controller = replace_once(controller, old, new, f"annotation {old[:40]}")
controller = replace_once(
    controller,
    "const upstream = await fetchWithTimeout(session.stream.localUrl, timeoutMs);",
    "const upstream = await fetchWithTimeout(/** @type {string} */ (session.stream.localUrl), timeoutMs);",
    "stream URL narrowing",
)
controller = replace_once(
    controller,
    "  function publicStream(stream) {\\n    return {",
    "  function publicStream(stream) {\\n    return /** @type {SessionStreamRecord} */ ({",
    "public stream legacy-shape assertion",
)
controller = replace_once(
    controller,
    "      limitations: stream.limitations || [],\\n    };\\n  }",
    "      limitations: stream.limitations || [],\\n    });\\n  }",
    "public stream assertion close",
)
controller = replace_once(
    controller,
    "    const [x1, y1, x2, y2] = coordinates.map((value) => Math.max(0, Math.min(1, value)));",
    "    const [x1, y1, x2, y2] = /** @type {[number, number, number, number]} */ (\\n      coordinates.map((value) => Math.max(0, Math.min(1, value))),\\n    );",
    "multitouch tuple refinement",
)
controller = replace_once(
    controller,
    '  const store = dependencies?.store;\\n  for (const method of ["findReusable", "create", "save", "get"]) {\\n    if (typeof store?.[method] !== "function") {',
    '  const store = dependencies?.store;\\n  const storeRecord = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (store));\\n  for (const method of ["findReusable", "create", "save", "get"]) {\\n    if (typeof storeRecord[method] !== "function") {',
    "runtime store validation",
)
controller_path.write_text(controller)
'''
source = replace_once(source, patch_anchor, patch_body, "post-annotation refinements")

patched = Path("/tmp/phase3s-typed-controller-oracle-v2-expanded.py")
patched.write_text(source)
subprocess.run(["python3", str(patched)], check=True)
