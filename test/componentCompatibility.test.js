import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPONENTS,
  validateComponentContract,
  componentReadiness,
  engineMatchesContract,
} from "../mac-helper/src/componentCompatibility.js";
const manifest = { ...COMPONENTS.engine };
function input() {
  return {
    engineManifest: manifest,
    helperHealth: {
      ok: true,
      version: COMPONENTS.version,
      protocol: 1,
      payload: { capabilities: [...COMPONENTS.helper.capabilities] },
    },
    agentReady: true,
    privateRouteReady: true,
  };
}
test("one exact contract describes local prerequisites while phone proof stays separate", () => {
  const result = componentReadiness(input());
  assert.equal(result.ready, true);
  assert.equal(result.phoneProofRequired, true);
  assert.equal(result.sdk.state, "checked-on-debug-connection");
  assert.equal(engineMatchesContract(manifest), true);
  assert.equal(engineMatchesContract({ ...manifest, version: "0.4.0" }), false);
});
for (const change of [
  (v) => (v.version = "0.0.0"),
  (v) => (v.engine.sha256 = "invalid"),
  (v) => (v.sdk.engineRevision = "c".repeat(40)),
  (v) => (v.sdk.enginePackageVersion = "0.4.0"),
  (v) => (v.agents.version = "0.0.0"),
  (v) => (v.engine.url = "https://example.invalid/engine.zip"),
  (v) => (v.engine.maxArchiveBytes = Infinity),
])
  test("a drifting or untrusted component contract is rejected", () => {
    const value = structuredClone(COMPONENTS);
    change(value);
    assert.throws(() => validateComponentContract(value, COMPONENTS.version), {
      code: "COMPONENT_CONTRACT_INVALID",
    });
  });
for (const change of [
  (v) => (v.engineManifest = null),
  (v) => (v.engineManifest = { ...manifest, sourceRevision: "c".repeat(40) }),
  (v) => (v.helperHealth.version = "0.0.0"),
  (v) => (v.helperHealth.payload.capabilities = []),
  (v) => (v.agentReady = false),
  (v) => (v.privateRouteReady = false),
])
  test("incomplete prerequisites never claim remote readiness", () => {
    const value = input();
    change(value);
    const result = componentReadiness(value);
    assert.equal(result.ready, false);
    assert.equal(result.phoneProofRequired, true);
  });

test("an explicit mismatching candidate is preserved with actionable selection guidance", () => {
  const value = input();
  value.engineManifest = { ...manifest, version: "9.0.0", localCandidate: true };
  const result = componentReadiness(value);
  assert.equal(result.ready, false);
  assert.equal(result.engine.code, "ENGINE_LOCAL_CANDIDATE_SELECTED");
  assert.match(result.engine.action, /setup preserves it/);
});
