const MARKER_PREFIX = "SWIFT_SIM_BENCHMARK ";

export class BenchmarkOracle {
  constructor({ baselineCase = "baseline" } = {}) {
    this.baselineCase = baselineCase;
    this.lastRevision = 0;
    this.seenTargets = new Set();
    this.markers = [];
  }

  ingest(line) {
    const marker = parseBenchmarkMarker(line);
    if (!marker) return null;
    if (marker.revision <= this.lastRevision) {
      throw oracleError("ORACLE_OUT_OF_ORDER", `Marker revision ${marker.revision} is not newer than ${this.lastRevision}.`);
    }
    const targetKey = `${marker.case}\u0000${marker.value}`;
    if (marker.case !== this.baselineCase && this.seenTargets.has(targetKey)) {
      throw oracleError("ORACLE_DUPLICATE", `Marker ${marker.case} was emitted more than once.`);
    }
    this.lastRevision = marker.revision;
    this.seenTargets.add(targetKey);
    this.markers.push(marker);
    return marker;
  }

  find({ caseID, value }) {
    return this.markers.find((marker) => marker.case === caseID && marker.value === value) || null;
  }

  assertCurrent({ caseID, value }) {
    const marker = this.find({ caseID, value });
    if (!marker) {
      throw oracleError("ORACLE_EXPECTED_MARKER_MISSING", `Expected marker ${caseID}/${value} was not observed.`);
    }
    return marker;
  }
}

export function parseBenchmarkMarker(line) {
  const text = String(line || "");
  const markerStart = text.indexOf(MARKER_PREFIX);
  if (markerStart < 0) return null;
  const payload = text.slice(markerStart + MARKER_PREFIX.length).trim();
  let value;
  try {
    value = JSON.parse(payload);
  } catch (error) {
    throw oracleError("ORACLE_MALFORMED", `Benchmark marker JSON is invalid: ${error.message}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw oracleError("ORACLE_MALFORMED", "Benchmark marker must be a JSON object.");
  }
  if (typeof value.case !== "string" || !value.case) {
    throw oracleError("ORACLE_MALFORMED", "Benchmark marker case is missing.");
  }
  if (typeof value.value !== "string") {
    throw oracleError("ORACLE_MALFORMED", "Benchmark marker value must be a string.");
  }
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw oracleError("ORACLE_MALFORMED", "Benchmark marker revision must be a positive integer.");
  }
  return { case: value.case, value: value.value, revision: value.revision };
}

export function oracleError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export const benchmarkMarkerPrefix = MARKER_PREFIX;
