from __future__ import annotations

import os
import subprocess
from pathlib import Path

ORIGINAL_COMMIT = "ff551d4a171aacdb62248ab046b3d384a94e0317"
ORIGINAL_WORKFLOW = ".github/workflows/tmp-phase3s-session-runtime-publisher.yml"


def checked(command: list[str], *, cwd: str | None = None) -> str:
    result = subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=True)
    return result.stdout


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one anchor, found {count}")
    return text.replace(old, new, 1)


workflow = checked(["git", "show", f"{ORIGINAL_COMMIT}:{ORIGINAL_WORKFLOW}"])
marker = "        run: |\n"
if workflow.count(marker) != 1:
    raise SystemExit("expected one original publisher run block")
block = workflow.split(marker, 1)[1]
script = "\n".join(line[10:] if line.startswith("          ") else line for line in block.splitlines()) + "\n"

script = replace_once(
    script,
    'block_start = helper.find("async function fetchWithTimeout(url, timeoutMs) {\\n")\nblock_end = helper.find("async function createDeviceBuild(values) {\\n", block_start)',
    'fetch_start = helper.find("async function fetchWithTimeout(url, timeoutMs) {\\n")\nblock_start = helper.find("async function proxyStream(res, session) {\\n", fetch_start)\nblock_end = helper.find("async function createDeviceBuild(values) {\\n", block_start)',
    "session extraction start",
)
script = replace_once(
    script,
    'if block_start < 0 or block_end < 0:\n    raise SystemExit("session runtime block sentinels missing")\nsession_block = helper[block_start:block_end].rstrip() + "\\n"',
    'if fetch_start < 0 or block_start < 0 or block_end < 0:\n    raise SystemExit("session runtime block sentinels missing")\nfetch_block = helper[fetch_start:block_start].rstrip() + "\\n\\n"\nsession_block = helper[block_start:block_end].rstrip() + "\\n"',
    "session extraction bounds",
)
script = replace_once(
    script,
    'module += indent(session_block, "  ")',
    'module += indent(fetch_block + session_block, "  ")',
    "controller timeout helper",
)
script = replace_once(
    script,
    'helper = helper[:block_start] + helper[block_end:]',
    'remove_start = helper.find("async function proxyStream(res, session) {\\n")\nremove_end = helper.find("async function createDeviceBuild(values) {\\n", remove_start)\nif remove_start < 0 or remove_end < 0:\n    raise SystemExit("updated session removal sentinels missing")\nhelper = helper[:remove_start] + helper[remove_end:]',
    "helper session removal",
)

write_anchor = "helper_path.write_text(helper)\n"
cleanup_code = '''helper_path.write_text(helper)

round2_path = Path("test/confirmationRound2State.test.js")
round2 = round2_path.read_text()
old_import = 'import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";\\n'
new_import = 'import { mkdtempSync, rmSync, writeFileSync } from "node:fs";\\n'
if round2.count(old_import) != 1:
    raise SystemExit("confirmationRound2State readFileSync import sentinel missing")
round2 = round2.replace(old_import, new_import, 1)
legacy_marker = 'test("helper source persists failed starts and uses shared automatic transport matching", () => {'
legacy_start = round2.find(legacy_marker)
if legacy_start < 0:
    raise SystemExit("legacy session source-text test sentinel missing")
round2_path.write_text(round2[:legacy_start].rstrip() + "\\n")

json_module = __import__("json")
baseline_path = Path("scripts/architecture/baseline-policy.json")
baseline_document = json_module.loads(baseline_path.read_text())
source_text_tests = baseline_document.get("caps", {}).get("sourceTextImplementationTests")
if not isinstance(source_text_tests, dict):
    raise SystemExit("source-text debt cap policy is missing")
if source_text_tests.pop("test/confirmationRound2State.test.js", None) != 1:
    raise SystemExit("session source-text debt cap is missing or changed")
baseline_path.write_text(json_module.dumps(baseline_document, indent=2) + "\\n")

package_path = Path("package.json")
package_document = json_module.loads(package_path.read_text())
scripts = package_document.get("scripts")
if not isinstance(scripts, dict):
    raise SystemExit("package scripts are missing")
for script_name in ("check:format", "check:lint"):
    value = scripts.get(script_name)
    if not isinstance(value, str):
        raise SystemExit(f"package {script_name} is missing")
    needle = "mac-helper/src/helperEntrypoint.js"
    addition = "mac-helper/src/sessionRuntimeController.js"
    if value.count(needle) != 1 or addition in value:
        raise SystemExit(f"package {script_name} coverage state unexpected")
    scripts[script_name] = value.replace(needle, f"{needle} {addition}", 1)
package_path.write_text(json_module.dumps(package_document, indent=2) + "\\n")
'''
script = replace_once(script, write_anchor, cleanup_code, "post-transform cleanup")

script = replace_once(
    script,
    "npx prettier --write mac-helper/src/sessionRuntimeController.js test/sessionRuntimeController.test.js\n",
    "npx prettier --write package.json scripts/architecture/baseline-policy.json mac-helper/src/sessionRuntimeController.js test/sessionRuntimeController.test.js\n",
    "prettier coverage",
)

script = replace_once(
    script,
    "  test/sessionRuntimeController.test.js\n\nfiles=\"$(git diff --cached --name-only \"$BASE\" | sort)\"\n",
    "  package.json \\\n  scripts/architecture/baseline-policy.json \\\n  test/confirmationRound2State.test.js \\\n  test/sessionRuntimeController.test.js\n\nfiles=\"$(git diff --cached --name-only \"$BASE\" | sort)\"\n",
    "staged file set",
)
script = replace_once(
    script,
    '  test/sessionRuntimeController.test.js | sort)"\n',
    '  package.json \\\n  scripts/architecture/baseline-policy.json \\\n  test/confirmationRound2State.test.js \\\n  test/sessionRuntimeController.test.js | sort)"\n',
    "expected file set",
)
script = replace_once(
    script,
    "! grep -q 'async function proxyStream' mac-helper/bin/swift-sim-helper.js\n",
    "! grep -q 'async function proxyStream' mac-helper/bin/swift-sim-helper.js\n"
    "grep -q 'async function fetchWithTimeout' mac-helper/bin/swift-sim-helper.js\n"
    "grep -q 'async function fetchWithTimeout' mac-helper/src/sessionRuntimeController.js\n"
    "! grep -q 'helper source persists failed starts' test/confirmationRound2State.test.js\n"
    "python3 -c 'import json; p=json.load(open(\"scripts/architecture/baseline-policy.json\")); assert \"test/confirmationRound2State.test.js\" in p[\"baseline\"][\"sourceTextImplementationTests\"]; assert \"test/confirmationRound2State.test.js\" not in p[\"caps\"][\"sourceTextImplementationTests\"]'\n",
    "post-extraction sentinels",
)

publisher = Path("/tmp/phase3s-publisher.sh")
publisher.write_text(script)
publisher.chmod(0o700)
subprocess.run(["bash", str(publisher)], check=True, env=os.environ.copy())
