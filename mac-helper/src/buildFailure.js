const PRESERVED_CODES = new Set([
  "PROTOCOL_MISMATCH", "HELPER_UNAVAILABLE", "BUILD_STORAGE_INSUFFICIENT",
  "BUILD_STORAGE_UNAVAILABLE", "SIGNING_FAILED", "BUILD_INPUT_INVALID",
  "BUILD_FAILED", "LIVE_LINKER_INCOMPATIBLE", "LIVE_LINKER_INSPECTION_FAILED",
  "SWIFT_SIM_BUILD_CANCELLED", "SWIFT_SIM_UNSAFE_BUILD_RECOVERY",
  "BUILD_RESUME_STATE_CHANGED", "LIVE_BUILD_RESUME_INELIGIBLE", "LIVE_BUILD_RESUME_ARTIFACT_INVALID",
  "LIVE_BUILD_RESUME_IDENTITY_MISMATCH", "LIVE_BUILD_RESUME_RESULT_INVALID", "LIVE_BUILD_RESUME_SOURCE_CHANGED",
  "LIVE_BUILD_RESUME_PROVENANCE_INVALID", "LIVE_BUILD_RESUME_ENGINE_UNAVAILABLE", "LIVE_BUILD_RESUME_REGISTRATION_INCOMPLETE",
  "LIVE_CAPTURE_APP_INVALID", "LIVE_CAPTURE_COMMANDS_INVALID", "LIVE_CAPTURE_COMMANDS_TOO_LARGE",
  "LIVE_CAPTURE_INPUT_INVALID", "LIVE_CAPTURE_PROVENANCE_CHANGED", "LIVE_CAPTURE_RESULT_MISSING",
  "LIVE_CAPTURE_SIGNATURE_INVALID", "LIVE_CAPTURE_SOURCES_INVALID", "LIVE_ENGINE_REGISTRATION_UPDATE_REQUIRED",
  "LIVE_CAPTURE_SOURCE_LINK_UNTRUSTED", "LIVE_CAPTURE_SOURCE_LIMIT", "LIVE_REGISTRATION_BUSY", "LIVE_REGISTRATION_SUPERSEDED",
  "LIVE_REGISTRATION_FAILED", "LIVE_REGISTRATION_PENDING", "LIVE_REGISTRATION_RECEIPT_INVALID",
  "LIVE_REGISTRATION_RECEIPT_MISMATCH", "LIVE_REGISTRATION_REJECTED",
]);

/** @typedef {Error & { code: string, metadataPersistenceFailed?: boolean }} BuildFailure */

/** Keep stage evidence before reducing a subprocess failure to a short message.
 * @param {unknown} value
 * @returns {string}
 */
export function classifyBuildFailure(value) {
  const code = value && typeof value === "object" ? value.code : "";
  if (PRESERVED_CODES.has(code)) return code;
  const text = failureText(value);
  for (const marker of text.matchAll(/\[([A-Z][A-Z0-9_]{1,79})\]/g)) if (PRESERVED_CODES.has(marker[1])) return marker[1];
  if (code === "ENOSPC" || /\bENOSPC\b|no space left on device|not enough (?:free |disk )?space|disk (?:is )?full/i.test(text)) return "BUILD_STORAGE_INSUFFICIENT";
  if (/command CodeSign failed|\bCodeSign[^\r\n]{0,200}\bfailed\b|code signing[^\r\n]{0,160}(?:error|failed|failure|not allowed)|error:[^\r\n]{0,200}(?:codesign|code signing|provisioning|signing certificate)|provisioning profile[^\r\n]{0,200}(?:not found|doesn't|does not|missing|expired)|no (?:signing|development) certificate|signing identity[^\r\n]{0,100}(?:missing|not found|invalid)|certificate (?:has expired|not found|is invalid)|errSecInternalComponent|following build commands failed:[\s\S]{0,1000}\bCodeSign\b/i.test(text)) return "SIGNING_FAILED";
  if (/\bprotocol (?:mismatch|incompatible)|version mismatch|outdated helper/i.test(text)) return "PROTOCOL_MISMATCH";
  if (/missing (?:required )?(?:project|workspace|scheme)|requires? --(?:project|workspace|scheme)|(?:project|workspace|scheme).{0,80}(?:does not exist|not found|is required)|no (?:project|workspace|scheme) (?:was |is )?(?:provided|found|named)|must pass .{0,40}(?:project|workspace|scheme)/i.test(text)) return "BUILD_INPUT_INVALID";
  return "BUILD_FAILED";
}

export function buildFailureNotice(value) {
  const code = classifyBuildFailure(value);
  const messages = {
    BUILD_STORAGE_INSUFFICIENT: "There is not enough free storage for this signed build. Reclaim disposable build outputs or caches, then retry the build.",
    BUILD_STORAGE_UNAVAILABLE: "Swift Sim could not check storage for this signed build. Check the build artifact volume before retrying.",
    SIGNING_FAILED: "Xcode could not sign the app. Inspect the CodeSign, keychain, certificate or provisioning failure before retrying.",
    BUILD_INPUT_INVALID: "The signed build input is missing or invalid. Check the selected project or workspace and scheme.",
    LIVE_LINKER_INCOMPATIBLE: "The live-enabled Debug app has incompatible private self-imports. Use a verified Debug linker workaround or build without live instrumentation; keep Release unchanged.",
    LIVE_LINKER_INSPECTION_FAILED: "The Debug linker compatibility check did not complete. Check the selected Xcode command-line tools before rebuilding.",
    PROTOCOL_MISMATCH: "The Swift Sim runtime versions are incompatible. Align the CLI and helper before retrying.",
    HELPER_UNAVAILABLE: "The Mac helper is unavailable. Diagnose its health before retrying.",
    SWIFT_SIM_BUILD_CANCELLED: "The signed build was cancelled.",
    SWIFT_SIM_UNSAFE_BUILD_RECOVERY: "An interrupted build worker could not be verified safely. Resolve its ownership before starting another build.",
    BUILD_FAILED: "The signed build failed. Inspect the local build diagnostics before retrying.",
    BUILD_RESUME_STATE_CHANGED: "The preserved build changed or another worker owns it. Read its current state before resuming.",
    LIVE_BUILD_RESUME_INELIGIBLE: "This build is not eligible for preserved Debug recovery. Select the failed live-registration build.",
    LIVE_BUILD_RESUME_ARTIFACT_INVALID: "The preserved signed Debug artifacts are missing or unsafe. No new build or installation was started.",
    LIVE_BUILD_RESUME_IDENTITY_MISMATCH: "The preserved app does not match the expected signed build identity. No install was published.",
    LIVE_BUILD_RESUME_RESULT_INVALID: "The preserved Xcode result does not prove a successful matching Debug build. No install was published.",
    LIVE_BUILD_RESUME_SOURCE_CHANGED: "Build inputs changed after the preserved compilation. A fresh signed build is needed; none was started automatically.",
    LIVE_BUILD_RESUME_PROVENANCE_INVALID: "The preserved build provenance could not be verified. No install was published.",
    LIVE_BUILD_RESUME_ENGINE_UNAVAILABLE: "The matching private engine is unavailable. Restore it before resuming this existing build.",
    LIVE_BUILD_RESUME_REGISTRATION_INCOMPLETE: "The preserved app still needs confirmed compiler registration. Resume the existing build after resolving the registration failure.",
    LIVE_ENGINE_REGISTRATION_UPDATE_REQUIRED: "Activate the matching transactional-registration engine, then resume this preserved Debug build.",
    LIVE_REGISTRATION_PENDING: "Compiler registration is unconfirmed. Resume the existing Debug build to query its matching operation; no rebuild is needed for a pending receipt.",
  };
  const registrationMessage = code.startsWith("LIVE_CAPTURE_") || code.startsWith("LIVE_REGISTRATION_")
    ? "The live compilation map could not be verified. Resolve the capture or registration failure before resuming this preserved Debug build. No successful compiler readiness is claimed."
    : messages.BUILD_FAILED;
  return { code, message: messages[code] || registrationMessage };
}

/** Preserve the original exception and add only an allowlisted error identity.
 * @param {unknown} error
 * @param {Record<string, unknown> | undefined} [details]
 * @returns {BuildFailure}
 */
export function annotateBuildFailure(error, details = undefined) {
  const result = error instanceof Error ? error : new Error(String(error || "Signed build failed."));
  result.code = classifyBuildFailure(details ? { ...details, code: result.code, message: result.message } : result);
  return result;
}

/** A persistence failure must not replace the primary build failure.
 * @template {{ state: string, logs?: string[] }} Build
 * @param {Build} build
 * @param {unknown} error
 * @param {((build: Build) => unknown) | undefined} [save]
 * @returns {BuildFailure}
 */
export function recordDeviceBuildFailure(build, error, save = undefined) {
  const failure = annotateBuildFailure(error);
  const notice = buildFailureNotice(failure);
  build.state = "failed";
  if (!Array.isArray(build.logs)) build.logs = [];
  const line = `[${notice.code}] ${notice.message}`;
  if (build.logs.at(-1) !== line) build.logs.push(line);
  try {
    if (typeof save === "function") {
      save(build);
      delete failure.metadataPersistenceFailed;
    }
  }
  catch {
    // ENOSPC can make even a terminal metadata rewrite impossible. The caller
    // still receives the original typed failure and an explicit persistence
    // diagnostic; do not claim a durable repair that could not be written.
    failure.metadataPersistenceFailed = true;
  }
  return failure;
}

function failureText(value) {
  if (typeof value === "string") return value.slice(-2 * 1024 * 1024);
  if (!value || typeof value !== "object") return String(value || "");
  // Xcode often writes the actual failing CodeSign step on stdout and unrelated
  // project warnings on stderr. Neither stream is sufficient by itself.
  return [value.message, value.error, value.stderr, value.stdout, value.cause?.message]
    .filter((item) => typeof item === "string").map((item) => item.slice(-1024 * 1024)).join("\n");
}
