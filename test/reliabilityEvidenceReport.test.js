import assert from "node:assert/strict";
import test from "node:test";
import { validateEvidenceReport } from "../scripts/reliability/evidence-contract.js";

test("report completeness is derived", () => {
  const result = validateEvidenceReport({
    schemaVersion: 1,
    requirements: [{ id: "sim", evidenceClass: "simulator" }],
    records: [{ id: "a", requirementId: "sim", evidenceClass: "simulator", status: "fixture-passed", provenance: { kind: "fixture", ref: "sample" } }]
  });
  assert.equal(result.valid, true);
  assert.equal(result.summary.complete, false);
  assert.equal(result.summary.byRequirement.sim.state, "not-collected");
});
