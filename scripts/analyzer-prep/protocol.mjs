import { constants as bufferConstants } from "node:buffer";

export const ANALYZER_PROTOCOL_VERSION = 1;
export const ANALYZER_MAX_OUTPUT_BYTES = 1024 * 1024;
export const ANALYZER_TIMEOUT_MS = 1500;

const VALID_ROUTES = new Set(["no-change", "hot-reload", "rebuild-required"]);
const VALID_STATUSES = new Set(["ok", "unsupported"]);

export function analyzerRequestFromCase(caseItem) {
  const files = caseItem.mode === "edit-set"
    ? caseItem.files
    : [{
      path: `${caseItem.id}.swift`,
      kind: "swift",
      status: "modified",
      beforeSource: caseItem.beforeSource,
      afterSource: caseItem.afterSource,
    }];
  return {
    protocolVersion: ANALYZER_PROTOCOL_VERSION,
    requestId: `corpus:${caseItem.id}`,
    files,
  };
}

export function validateAnalyzerResponse(value, { requestId = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "Analyzer response must be a JSON object." };
  }
  if (value.protocolVersion !== ANALYZER_PROTOCOL_VERSION) {
    return {
      ok: false,
      error: `Analyzer protocol version mismatch: expected ${ANALYZER_PROTOCOL_VERSION}, received ${String(value.protocolVersion)}.`,
    };
  }
  if (requestId && value.requestId !== requestId) {
    return { ok: false, error: "Analyzer response requestId did not match the request." };
  }
  if (!VALID_STATUSES.has(value.status)) {
    return { ok: false, error: "Analyzer response status is invalid." };
  }
  if (!VALID_ROUTES.has(value.route)) {
    return { ok: false, error: "Analyzer response route is invalid." };
  }
  if (value.status === "unsupported" && value.route !== "rebuild-required") {
    return { ok: false, error: "Unsupported analyzer results must require a rebuild." };
  }
  if (typeof value.reasonCode !== "string" || value.reasonCode.length === 0) {
    return { ok: false, error: "Analyzer response reasonCode is required." };
  }
  return { ok: true, value };
}

export function failClosedAnalyzerResult({
  requestId = "",
  reasonCode = "ANALYZER_UNAVAILABLE",
  detail = "Swift analyzer unavailable; signed rebuild required.",
} = {}) {
  return {
    protocolVersion: ANALYZER_PROTOCOL_VERSION,
    analyzerVersion: "unavailable",
    requestId,
    status: "unsupported",
    route: "rebuild-required",
    reasonCode,
    detail,
  };
}

export function decodeBoundedAnalyzerOutput(stdout, {
  requestId = "",
  maxOutputBytes = ANALYZER_MAX_OUTPUT_BYTES,
} = {}) {
  const bytes = Buffer.byteLength(String(stdout ?? ""), "utf8");
  if (bytes > maxOutputBytes) {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: "ANALYZER_OUTPUT_LIMIT",
      detail: `Analyzer output exceeded ${maxOutputBytes} bytes.`,
    });
  }
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? ""));
  } catch {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: "ANALYZER_MALFORMED_OUTPUT",
      detail: "Analyzer output was not valid JSON.",
    });
  }
  const validation = validateAnalyzerResponse(parsed, { requestId });
  if (!validation.ok) {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: parsed?.protocolVersion !== ANALYZER_PROTOCOL_VERSION
        ? "ANALYZER_VERSION_MISMATCH"
        : "ANALYZER_MALFORMED_OUTPUT",
      detail: validation.error,
    });
  }
  return validation.value;
}

export function normalizeAnalyzerExecution(execution, {
  requestId = "",
  maxOutputBytes = ANALYZER_MAX_OUTPUT_BYTES,
} = {}) {
  if (!execution || execution.unavailable === true || execution.error?.code === "ENOENT") {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: "ANALYZER_UNAVAILABLE",
    });
  }
  if (execution.timedOut === true || execution.error?.code === "ETIMEDOUT") {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: "ANALYZER_TIMEOUT",
      detail: "Swift analyzer exceeded its hard timeout.",
    });
  }
  if (execution.error?.code === "ENOBUFS") {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: "ANALYZER_OUTPUT_LIMIT",
      detail: `Swift analyzer exceeded ${maxOutputBytes} output bytes.`,
    });
  }
  if (execution.status !== 0) {
    return failClosedAnalyzerResult({
      requestId,
      reasonCode: "ANALYZER_PROCESS_FAILED",
      detail: "Swift analyzer exited unsuccessfully.",
    });
  }
  return decodeBoundedAnalyzerOutput(execution.stdout, { requestId, maxOutputBytes });
}

export function differentialClass(legacyRoute, candidateRoute) {
  if (legacyRoute === candidateRoute) return "equivalent";
  if (
    candidateRoute === "rebuild-required"
    && (legacyRoute === "hot-reload" || legacyRoute === "no-change")
  ) {
    return "stricter";
  }
  return "potentially-more-permissive";
}

export function assertPermissiveGate(caseItem, className) {
  if (className !== "potentially-more-permissive") return;
  if (caseItem.productionEnabled !== false || caseItem.physicalProofRequired !== true) {
    throw new Error(
      `${caseItem.id}: potentially-more-permissive cases must be disabled and require physical proof.`,
    );
  }
}
