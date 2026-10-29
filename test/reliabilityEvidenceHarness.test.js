import assert from "node:assert/strict";
import test from "node:test";
import { validateEvidenceRecord } from "../scripts/reliability/evidence-contract.js";

test("fixture evidence cannot become device evidence", () => {
  const result = validateEvidenceRecord({
    id: "attempt",
    requirementId: "device",
    evidenceClass: "physical-device",
    status: "passed",
    provenance: { kind: "fixture", ref: "fixture-run" },
    environment: { device: "fixture" },
  });
  assert.equal(result.valid, false);
});

test("repository evidence cannot become simulator evidence", () => {
  const result = validateEvidenceRecord({
    id: "attempt",
    requirementId: "simulator",
    evidenceClass: "simulator",
    status: "passed",
    provenance: { kind: "repository-run", ref: "ci-run" },
    environment: { simulator: "fixture" },
  });
  assert.equal(result.valid, false);
});
