import { createHash } from "node:crypto";

export const REPLACEMENT_PROOF_CAPABILITY = "replacement-proof-v3";
export const REPLACEMENT_PROOF_VERSION = 3;

function invalid() { throw Object.assign(new Error("Invalid complete replacement coverage."), { code: "PATCH_COVERAGE_INVALID" }); }
function exactKeys(value, names) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join("\0") !== [...names].sort().join("\0")) invalid();
}
function boundedASCII(value, limit) {
  if (typeof value !== "string" || !value.length || value.length > limit || /[^\x20-\x7e]/.test(value)) invalid();
  return value;
}
export function normalizeReplacementProof(value) {
  exactKeys(value, ["version", "swift_replacements", "objc_callbacks"]);
  if (value.version !== 3 || !Number.isSafeInteger(value.swift_replacements) || value.swift_replacements < 0 || value.swift_replacements > 512
    || !Array.isArray(value.objc_callbacks) || value.objc_callbacks.length > 256
    || value.swift_replacements + value.objc_callbacks.length === 0
    || value.swift_replacements + value.objc_callbacks.length > 512) invalid();
  const targets = new Set();
  const selectors = new Set();
  const callbacks = value.objc_callbacks.map(callback => {
    exactKeys(callback, ["class_name", "selector", "replacement_selector", "type_encoding"]);
    const className = boundedASCII(callback.class_name, 1024);
    const selector = boundedASCII(callback.selector, 256);
    const replacement = boundedASCII(callback.replacement_selector, 256);
    const encoding = boundedASCII(callback.type_encoding, 512);
    const selectorPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(?::[A-Za-z_$][A-Za-z0-9_$]*)*:?$/;
    if (!/^[A-Za-z_$][A-Za-z0-9_$.]*$/.test(className) || !selectorPattern.test(selector)
      || !selectorPattern.test(replacement) || selector === replacement
      || (selector.match(/:/g) || []).length !== (replacement.match(/:/g) || []).length) invalid();
    const key = className + "\0" + selector;
    if (targets.has(key)) invalid();
    targets.add(key);
    for (const name of [selector, replacement]) {
      const identity = className + "\0" + name;
      if (selectors.has(identity)) invalid();
      selectors.add(identity);
    }
    return { class_name: className, selector, replacement_selector: replacement, type_encoding: encoding };
  });
  callbacks.sort((a, b) => {
    const key = c => [c.class_name, c.selector, c.replacement_selector, c.type_encoding].join("\0");
    return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
  });
  const normalized = { version: 3, swift_replacements: value.swift_replacements, objc_callbacks: callbacks };
  if (Buffer.byteLength(JSON.stringify(sorted(normalized))) > 12 * 1024) invalid();
  return normalized;
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
export function replacementCoverageDigest(value) {
  return createHash("sha256").update(JSON.stringify(sorted(normalizeReplacementProof(value)))).digest("hex");
}
export function verifyReplacementProofReceipt({ expected, report, attemptId } = {}) {
  try {
    const proof = normalizeReplacementProof(expected);
    if (!report || typeof attemptId !== "string" || !attemptId.length || Buffer.byteLength(attemptId) > 128
      || /[\x00-\x1f\x7f]/.test(attemptId) || report.attempt_id !== attemptId || report.replacement_proof_version !== 3
      || report.coverage_digest !== replacementCoverageDigest(proof) || report.complete_replacement_coverage !== true
      || report.expected_swift_replacements !== proof.swift_replacements
      || report.dynamic_replacements !== proof.swift_replacements || report.objc_replacements !== proof.objc_callbacks.length
      || report.represented_replacements !== proof.swift_replacements + proof.objc_callbacks.length
      || !Array.isArray(report.objc_callback_proofs) || report.objc_callback_proofs.length !== proof.objc_callbacks.length) return false;
    const callbacks = report.objc_callback_proofs;
    const expectedCallbacks = proof.objc_callbacks;
    const seen = new Set();
    for (const callback of callbacks) {
      const target = expectedCallbacks.find(value => value.class_name === callback?.class_name && value.selector === callback?.selector);
      const key = callback?.class_name + "\0" + callback?.selector;
      if (!target || seen.has(key) || callback.replacement_selector !== target.replacement_selector
        || callback.type_encoding !== target.type_encoding || callback.verified !== true
        || callback.owns_selector !== true || callback.implementation_matches !== true
        || callback.encoding_matches !== true || callback.implementation_in_patch !== true
        || callback.previous_implementation_changed !== true) return false;
      seen.add(key);
    }
    return true;
  } catch { return false; }
}
