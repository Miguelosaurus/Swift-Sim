import test from "node:test";
import assert from "node:assert/strict";
import {
  ANALYZER_MAX_OUTPUT_BYTES,
  normalizeAnalyzerExecution,
  validateAnalyzerResponse,
} from "../scripts/analyzer-prep/protocol.mjs";

const requestId = "fixture:protocol";

test("P7 analyzer protocol accepts a versioned rebuild response", () => {
  const response = {
    protocolVersion: 1,
    analyzerVersion: "fixture",
    requestId,
    status: "ok",
    route: "rebuild-required",
    reasonCode: "STRUCTURAL_CHANGE",
  };
  assert.equal(validateAnalyzerResponse(response, { requestId }).ok, true);
});

test("P7 unavailable timeout process and malformed analyzer results fail closed", () => {
  const cases = [
    [{ unavailable: true }, "ANALYZER_UNAVAILABLE"],
    [{ timedOut: true, status: null, stdout: "" }, "ANALYZER_TIMEOUT"],
    [{ status: 2, stdout: "", stderr: "failure" }, "ANALYZER_PROCESS_FAILED"],
    [{ status: 0, stdout: "not-json" }, "ANALYZER_MALFORMED_OUTPUT"],
    [{ status: 0, stdout: "x".repeat(ANALYZER_MAX_OUTPUT_BYTES + 1) }, "ANALYZER_OUTPUT_LIMIT"],
  ];

  for (const [execution, reasonCode] of cases) {
    const result = normalizeAnalyzerExecution(execution, { requestId });
    assert.equal(result.status, "unsupported");
    assert.equal(result.route, "rebuild-required");
    assert.equal(result.reasonCode, reasonCode);
  }
});

test("P7 incompatible analyzer protocol fails closed", () => {
  const result = normalizeAnalyzerExecution({
    status: 0,
    stdout: JSON.stringify({
      protocolVersion: 99,
      analyzerVersion: "future",
      requestId,
      status: "ok",
      route: "hot-reload",
      reasonCode: "IMPLEMENTATION_ONLY",
    }),
  }, { requestId });
  assert.equal(result.route, "rebuild-required");
  assert.equal(result.reasonCode, "ANALYZER_VERSION_MISMATCH");
});

test("P7 unsupported analyzer output cannot claim a hot route", () => {
  const result = normalizeAnalyzerExecution({
    status: 0,
    stdout: JSON.stringify({
      protocolVersion: 1,
      analyzerVersion: "fixture",
      requestId,
      status: "unsupported",
      route: "hot-reload",
      reasonCode: "UNSUPPORTED_SYNTAX",
    }),
  }, { requestId });
  assert.equal(result.route, "rebuild-required");
  assert.equal(result.reasonCode, "ANALYZER_MALFORMED_OUTPUT");
});
