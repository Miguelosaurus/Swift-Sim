from __future__ import annotations

import os
import subprocess
from pathlib import Path

BASE = "cd8d32fc2deda31d731d821d59310083640e4dc1"
PRODUCT_BRANCH = "agent/architecture-consolidation-phase-3s-session-runtime-controller"
SOURCE_VERIFY_RUN = "31432882026"
REPO = "Miguelosaurus/Swift-Sim"
WORKTREE = "/tmp/phase3s-typed-controller"


def run(command: list[str], *, cwd: str | None = None, capture: bool = False) -> str:
    result = subprocess.run(command, cwd=cwd, check=True, text=True, capture_output=capture)
    return result.stdout if capture else ""


def output(command: list[str], *, cwd: str | None = None) -> str:
    return run(command, cwd=cwd, capture=True).strip()


def remote_sha(branch: str) -> str:
    line = output(["git", "ls-remote", "origin", f"refs/heads/{branch}"])
    return line.split()[0] if line else ""


verify_state = output([
    "gh", "api", f"repos/{REPO}/actions/runs/{SOURCE_VERIFY_RUN}",
    "--jq", '.status + ":" + (.conclusion // "")',
])
if verify_state != "completed:success":
    raise SystemExit(f"Phase 3S source Verify is not green: {verify_state}")
if remote_sha(PRODUCT_BRANCH) != BASE:
    raise SystemExit("Phase 3S product ref moved before typed-controller construction")

# Reuse the now-green oracle to construct the exact correction in an isolated
# worktree and prove focused behavior + strict type checking before publication.
run(["python3", ".github/tmp/phase3s-typed-controller-oracle-v2.py"])

files = [
    "mac-helper/bin/swift-sim-helper.js",
    "mac-helper/src/infrastructure/compatibilityHelperRuntime.js",
    "mac-helper/src/sessionRuntimeController.js",
    "test/compatibilityHelperRuntime.test.js",
    "test/sessionRuntimeController.test.js",
]
actual = output(["git", "diff", "--name-only", BASE], cwd=WORKTREE).splitlines()
if sorted(actual) != sorted(files):
    raise SystemExit(f"unexpected typed Phase 3S file set: {actual}")

run(["git", "diff", "--check"], cwd=WORKTREE)
run(["git", "config", "user.name", "github-actions[bot]"], cwd=WORKTREE)
run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=WORKTREE)
run(["git", "add", *files], cwd=WORKTREE)
run(["git", "diff", "--cached", "--check"], cwd=WORKTREE)

controller = Path(WORKTREE, "mac-helper/src/sessionRuntimeController.js").read_text()
helper = Path(WORKTREE, "mac-helper/bin/swift-sim-helper.js").read_text()
runtime = Path(WORKTREE, "mac-helper/src/infrastructure/compatibilityHelperRuntime.js").read_text()
if not controller.startswith("// @ts-check\n"):
    raise SystemExit("session controller is not under strict JS checking")
if 'from "node:crypto"' in controller or "randomBytes(" in controller:
    raise SystemExit("session controller still owns direct crypto")
if "dependencies.idGenerator.randomToken(24)" not in controller:
    raise SystemExit("session controller token generation is not injected")
if "idGenerator: runtime.idGenerator" not in helper:
    raise SystemExit("helper does not inject the composed ID generator")
if "createIdGenerator" not in runtime or "SystemIdGenerator" not in runtime:
    raise SystemExit("compatibility runtime does not compose the ID generator")

run(["git", "commit", "-m", "Phase 3S: type session controller infrastructure seams"], cwd=WORKTREE)
candidate = output(["git", "rev-parse", "HEAD"], cwd=WORKTREE)
if output(["git", "rev-parse", "HEAD^"], cwd=WORKTREE) != BASE:
    raise SystemExit("typed Phase 3S correction is not one commit on exact base")

# The oracle already ran focused behavior + check:types. Require the entire
# repository gate on the exact committed candidate before publication.
run(["npm", "run", "check"], cwd=WORKTREE)
run(["git", "diff", "--check"], cwd=WORKTREE)
if output(["git", "status", "--porcelain"], cwd=WORKTREE):
    raise SystemExit("typed Phase 3S candidate worktree is dirty after validation")

verify_state = output([
    "gh", "api", f"repos/{REPO}/actions/runs/{SOURCE_VERIFY_RUN}",
    "--jq", '.status + ":" + (.conclusion // "")',
])
if verify_state != "completed:success":
    raise SystemExit(f"Phase 3S source Verify moved out of green state: {verify_state}")
if remote_sha(PRODUCT_BRANCH) != BASE:
    raise SystemExit("Phase 3S product ref moved before typed-controller publication")

run(["git", "push", "origin", f"HEAD:refs/heads/{PRODUCT_BRANCH}"], cwd=WORKTREE)
print(f"Published typed Phase 3S correction {candidate}")
