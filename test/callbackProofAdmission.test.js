import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeReplacementProof,
  replacementCoverageDigest,
  verifyReplacementProofReceipt,
} from "../mac-helper/src/replacementProof.js";

const callback = {
  class_name: "_TtC7Example11Coordinator",
  selector: "scrollViewWillBeginDragging:",
  replacement_selector: "__swiftSim_callback:",
  type_encoding: "v24@0:8@16",
};
const expected = () => ({ version: 3, swift_replacements: 6, objc_callbacks: [{ ...callback }] });
const attemptId = "current-claim-token";
function nativeCallback(value = callback) {
  return { ...value, owns_selector: true, implementation_matches: true,
    encoding_matches: true, implementation_in_patch: true,
    previous_implementation_changed: true, verified: true };
}
function report(proof = expected()) {
  return { attempt_id: attemptId, replacement_proof_version: 3,
    coverage_digest: replacementCoverageDigest(proof), expected_swift_replacements: proof.swift_replacements,
    dynamic_replacements: proof.swift_replacements, objc_replacements: proof.objc_callbacks.length,
    represented_replacements: proof.swift_replacements + proof.objc_callbacks.length,
    complete_replacement_coverage: true, objc_callback_proofs: proof.objc_callbacks.map(nativeCallback) };
}
function verifies(value, proof = expected(), attempt = attemptId) {
  return verifyReplacementProofReceipt({ expected: proof, report: value, attemptId: attempt });
}
function invalid(value, reason) {
  assert.throws(() => normalizeReplacementProof(value), { code: "PATCH_COVERAGE_INVALID" }, reason);
}

test("v3 canonical digest has a cross-runtime known vector and does not mutate input", () => {
  const value = expected();
  Object.freeze(value.objc_callbacks[0]); Object.freeze(value.objc_callbacks); Object.freeze(value);
  assert.equal(replacementCoverageDigest(value), "a375fa459679b23c12fba308dc177f66bad83f9de4478d63fb248e431cbfafd5");
  const other = { ...callback, class_name: "_TtC7Example10Controller", selector: "viewDidAppear:", replacement_selector: "__swiftSim_appeared:" };
  const one = { objc_callbacks: [callback, other], swift_replacements: 6, version: 3 };
  const two = { version: 3, swift_replacements: 6, objc_callbacks: [other, callback] };
  assert.equal(replacementCoverageDigest(one), replacementCoverageDigest(two));
  assert.deepEqual(one.objc_callbacks, [callback, other]);
});

test("v3 normalization rejects ambiguous shape, coercions and oversized member sets", () => {
  for (const value of [null, [], {}, "3", { ...expected(), extra: true }, { ...expected(), version: "3" },
    { ...expected(), version: 2 }, { ...expected(), objc_callbacks: {} }, { ...expected(), objc_callbacks: [null] }]) invalid(value);
  for (const count of [true, false, null, "6", -1, 0.25, NaN, Infinity, 513, Number.MAX_SAFE_INTEGER]) {
    invalid({ ...expected(), swift_replacements: count }, `count ${String(count)} must not coerce`);
  }
  invalid({ version: 3, swift_replacements: 0, objc_callbacks: [] }, "empty logical update has no coverage");
  invalid({ ...expected(), swift_replacements: 512 }, "total represented count exceeds 512");
  invalid({ version: 3, swift_replacements: 0, objc_callbacks: Array.from({ length: 257 }, (_, i) => ({ ...callback, class_name: `Callback${i}` })) });
  invalid({ version: 3, swift_replacements: 0, objc_callbacks: Array.from({ length: 8 }, (_, i) => ({
    ...callback, class_name: `Callback${i}` + "A".repeat(1000), type_encoding: "v".repeat(1024),
  })) }, "individually bounded callbacks must also fit the 12 KiB canonical wire budget");
});

test("callback mappings reject target aliases, invalid selectors and hidden fields", () => {
  for (const altered of [
    { ...callback, extra: true }, { ...callback, selector: callback.replacement_selector },
    { ...callback, replacement_selector: "__swiftSim_noArgument" }, { ...callback, selector: "" },
    { ...callback, class_name: "Class\0Hidden" }, { ...callback, class_name: "../Class" },
    { ...callback, selector: "method\nname:" }, { ...callback, type_encoding: "" },
    { ...callback, type_encoding: "v24@0:8@16\u0000ignored" },
    { ...callback, class_name: "A".repeat(1025) }, { ...callback, type_encoding: "v".repeat(1025) },
  ]) invalid({ ...expected(), objc_callbacks: [altered] });
  invalid({ ...expected(), objc_callbacks: [callback, { ...callback }] }, "duplicate original selector");
  invalid({ ...expected(), objc_callbacks: [callback, { ...callback, selector: callback.replacement_selector,
    replacement_selector: "__swiftSim_second:" }] }, "replacement alias cannot become another original target");
  invalid({ ...expected(), objc_callbacks: [callback, { ...callback, selector: "anotherOriginal:" }] },
    "two originals cannot share a replacement alias");
});

test("complete mixed, Swift-only and Objective-C-only receipts retain honest counts", () => {
  assert.equal(verifies(report()), true);
  const swiftOnly = { version: 3, swift_replacements: 2, objc_callbacks: [] };
  assert.equal(verifies(report(swiftOnly), swiftOnly), true);
  const objcOnly = { version: 3, swift_replacements: 0, objc_callbacks: [callback] };
  assert.equal(verifies(report(objcOnly), objcOnly), true);
  assert.equal(report(objcOnly).dynamic_replacements, 0);
});

test("partial, excessive, stale or contradictory coverage cannot establish v3 success", () => {
  const changes = [
    { replacement_proof_version: 2 }, { replacement_proof_version: "3" },
    { attempt_id: "older-claim-token" }, { attempt_id: undefined },
    { coverage_digest: "0".repeat(64) }, { coverage_digest: undefined },
    { complete_replacement_coverage: false }, { complete_replacement_coverage: 1 },
    { dynamic_replacements: 5 }, { dynamic_replacements: 7 }, { dynamic_replacements: "6" },
    { expected_swift_replacements: 5 }, { expected_swift_replacements: undefined },
    { objc_replacements: 0 }, { objc_replacements: 2 }, { represented_replacements: 6 },
    { represented_replacements: 8 }, { objc_callback_proofs: [] }, { objc_callback_proofs: null },
  ];
  for (const change of changes) assert.equal(verifies({ ...report(), ...change }), false, JSON.stringify(change));
  assert.equal(verifies(report(), expected(), ""), false);
  assert.equal(verifyReplacementProofReceipt({ expected: expected(), report: report() }), false);
  for (const attempt of [7, true, {}, "A".repeat(129)]) {
    assert.equal(verifies({ ...report(), attempt_id: attempt }, expected(), attempt), false, "attempt identity must be a bounded string");
  }
  const changedExpectation = expected(); changedExpectation.objc_callbacks[0].type_encoding = "i24@0:8@16";
  assert.equal(verifies(report(), changedExpectation), false, "same counts with changed expected ABI must not reuse a receipt");
});

test("every callback must prove exact target, changed IMP, ownership, ABI and patch image", () => {
  const proof = report();
  for (const field of ["verified", "owns_selector", "implementation_matches", "encoding_matches",
    "implementation_in_patch", "previous_implementation_changed"]) {
    for (const value of [false, undefined, 1, "true"]) {
      assert.equal(verifies({ ...proof, objc_callback_proofs: [{ ...proof.objc_callback_proofs[0], [field]: value }] }), false, `${field}=${String(value)}`);
    }
  }
  for (const change of [{ class_name: "_TtC7ExampleWrongOwner" }, { selector: "anotherCallback:" },
    { replacement_selector: "olderReplacement:" }, { type_encoding: "i24@0:8@16" }]) {
    assert.equal(verifies({ ...proof, objc_callback_proofs: [{ ...proof.objc_callback_proofs[0], ...change }] }), false);
  }
});

test("same total counts cannot hide one missing callback behind a duplicate or unrelated target", () => {
  const second = { ...callback, selector: "viewDidAppear:", replacement_selector: "__swiftSim_appear:" };
  const proof = { version: 3, swift_replacements: 1, objc_callbacks: [callback, second] };
  const receipt = report(proof);
  assert.equal(verifies(receipt, proof), true);
  assert.equal(verifies({ ...receipt, objc_callback_proofs: [...receipt.objc_callback_proofs].reverse() }, proof), true);
  assert.equal(verifies({ ...receipt, objc_callback_proofs: [nativeCallback(), nativeCallback()] }, proof), false);
  assert.equal(verifies({ ...receipt, objc_callback_proofs: [nativeCallback(), nativeCallback({ ...second, class_name: "WrongClass" })] }, proof), false);
});

test("malformed reports and malformed expectations fail closed without throwing", () => {
  for (const value of [null, undefined, [], "success", 1, {}, { objc_callback_proofs: [null] }]) assert.equal(verifies(value), false);
  for (const value of [null, undefined, [], {}, { ...expected(), objc_callbacks: [null] }]) {
    assert.equal(verifyReplacementProofReceipt({ expected: value, report: report(), attemptId }), false);
  }
});
