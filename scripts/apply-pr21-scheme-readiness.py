#!/usr/bin/env python3
from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}")
    path.write_text(text.replace(old, new, 1))


root = Path(__file__).resolve().parents[1]
live_reload = root / "mac-helper/src/liveReload.js"

replace_once(
    live_reload,
    '''  const engineStatus = control?.success ? control.data : null;
  const projectRoot = projectRootFor(projectPath);
  const watchingProject = Boolean(
    projectRoot
    && engineStatus?.watching_directories?.some((path) => resolve(path) === projectRoot)
  );
''',
    '''  const engineStatus = control?.success ? control.data : null;
  const projectRoot = projectRootFor(projectPath);
  const engineSession = readJSONFile(ENGINE_SESSION);
  const matchingEngineSession = liveEngineSessionMatches(engineSession, {
    projectRoot,
    scheme: schemeSelection.scheme,
  });
  const watchingProject = Boolean(
    matchingEngineSession
    && engineStatus?.watching_directories?.some((path) => resolve(path) === projectRoot)
  );
''',
)

replace_once(
    live_reload,
    '''    && session?.projectRoot === status.project.root
    && session?.scheme === status.project.scheme
    && session?.signingIdentity === signingIdentity
    && session?.engineVersion === ENGINE_VERSION;
''',
    '''    && liveEngineSessionMatches(session, {
      projectRoot: status.project.root,
      scheme: status.project.scheme,
    })
    && session?.signingIdentity === signingIdentity;
''',
)

replace_once(
    live_reload,
    '''function readJSONFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}
''',
    '''function readJSONFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export function liveEngineSessionMatches(session, {
  projectRoot = "",
  scheme = "",
} = {}) {
  return Boolean(
    session
    && String(session.projectRoot || "") === String(projectRoot || "")
    && String(session.scheme || "") === String(scheme || "")
    && session.engineVersion === ENGINE_VERSION
  );
}
''',
)

integration_test = root / "test/mainPostMergeIntegration.test.js"
replace_once(
    integration_test,
    '''  LIVE_REASON_CODES,
  selectLiveApplicationBuildSettings,
''',
    '''  LIVE_REASON_CODES,
  liveEngineSessionMatches,
  selectLiveApplicationBuildSettings,
''',
)

with integration_test.open("a") as handle:
    handle.write('''


test("live readiness is bound to the active engine scheme", () => {
  const session = {
    projectRoot: "/tmp/Repo",
    scheme: "OtherApp",
    engineVersion: "0.4.0",
  };
  assert.equal(liveEngineSessionMatches(session, {
    projectRoot: "/tmp/Repo",
    scheme: "SelectedApp",
  }), false);
  assert.equal(liveEngineSessionMatches(session, {
    projectRoot: "/tmp/Repo",
    scheme: "OtherApp",
  }), true);
  assert.equal(liveEngineSessionMatches(session, {
    projectRoot: "/tmp/AnotherRepo",
    scheme: "OtherApp",
  }), false);

  const source = readFileSync("mac-helper/src/liveReload.js", "utf8");
  assert.match(source, /const matchingEngineSession = liveEngineSessionMatches\(engineSession/);
  assert.match(source, /const watchingProject = Boolean\(\n    matchingEngineSession/);
});
''')

docs = root / "docs/MAIN_POST_MERGE_REVIEW_ROUND1.md"
replace_once(docs, "| P1 | 20 | 20 | 0 |", "| P1 | 21 | 21 | 0 |")
replace_once(
    docs,
    "20. Parseable but incomplete owner and reclaim records are treated as malformed state and become safely reclaimable instead of permanently wedging every lifecycle operation.\n",
    "20. Parseable but incomplete owner and reclaim records are treated as malformed state and become safely reclaimable instead of permanently wedging every lifecycle operation.\n21. Live readiness and routing are bound to the persisted engine session's exact project root, selected scheme, and engine version, preventing cross-scheme compilation-map injection within a shared workspace.\n",
)
replace_once(
    docs,
    "workspace schemes, selected-target package association, host-application signing sections",
    "workspace schemes, selected-target package association, active engine-scheme identity, host-application signing sections",
)

print("Applied PR #21 active-engine scheme readiness fix.")
