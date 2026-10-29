import assert from "node:assert/strict";
import test from "node:test";
import { validateEvidenceRecord } from "../scripts/reliability/evidence-contract.js";

test("class-correct provenance can pass", () => {
  const result = validateEvidenceRecord({
    id: "attempt",
    requirementId: "device",
    evidenceClass: "physical-device",
    status: "passed",
    provenance: { kind: "physical-device-run", ref: "device-run" },
    environment: { model: "captured", os: "captured" }
  });
  assert.equal(result.valid, true);
});
