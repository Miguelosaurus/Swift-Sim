export function percentile(values, quantile) {
  const sorted = finiteNumbers(values).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  if (quantile <= 0) return sorted[0];
  if (quantile >= 1) return sorted.at(-1);
  const rank = Math.max(1, Math.ceil(quantile * sorted.length));
  return sorted[rank - 1];
}

export function latencySummary(values) {
  const numbers = finiteNumbers(values);
  return {
    count: numbers.length,
    min: percentile(numbers, 0),
    p50: percentile(numbers, 0.5),
    p90: percentile(numbers, 0.9),
    p95: percentile(numbers, 0.95),
    p99: percentile(numbers, 0.99),
    max: percentile(numbers, 1),
  };
}

export function wilsonInterval(successes, total, z = 1.96) {
  const n = Number(total);
  const k = Number(successes);
  if (!Number.isFinite(n) || n <= 0) return { proportion: null, low: null, high: null };
  const proportion = Math.min(1, Math.max(0, k / n));
  const zSquared = z * z;
  const denominator = 1 + zSquared / n;
  const center = (proportion + zSquared / (2 * n)) / denominator;
  const margin = (z / denominator)
    * Math.sqrt((proportion * (1 - proportion) / n) + (zSquared / (4 * n * n)));
  return {
    proportion,
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin),
  };
}

export function classifierSummary(records) {
  const matrix = {
    "hot-reload": { "hot-reload": 0, "build-device": 0, none: 0 },
    "build-device": { "hot-reload": 0, "build-device": 0, none: 0 },
    none: { "hot-reload": 0, "build-device": 0, none: 0 },
  };
  for (const record of records) {
    const expected = record.expectedLane;
    const predicted = record.predictedLane || record.action || "none";
    if (!matrix[expected]) matrix[expected] = { "hot-reload": 0, "build-device": 0, none: 0 };
    if (!Object.hasOwn(matrix[expected], predicted)) matrix[expected][predicted] = 0;
    matrix[expected][predicted] += 1;
  }
  const validRecords = records.filter((record) => record.validity !== "authoring-error");
  const validMatrix = confusionMatrix(validRecords);
  const hotPredictions = validRecords.filter((record) => (record.predictedLane || record.action) === "hot-reload").length;
  const safeHotPredictions = validRecords.filter((record) =>
    record.expectedLane === "hot-reload"
    && (record.predictedLane || record.action) === "hot-reload"
  ).length;
  const expectedHot = validRecords.filter((record) => record.expectedLane === "hot-reload").length;
  const dangerousFalseLive = validRecords.filter((record) =>
    record.expectedLane === "build-device"
    && (record.predictedLane || record.action) === "hot-reload"
  ).length;
  return {
    total: records.length,
    matrix,
    validTotal: validRecords.length,
    validMatrix,
    authoringErrorCount: records.length - validRecords.length,
    dangerousFalseLive,
    safePrecision: hotPredictions === 0 ? null : safeHotPredictions / hotPredictions,
    eligibleRoutingRecall: expectedHot === 0 ? null : safeHotPredictions / expectedHot,
    safePrecisionInterval: wilsonInterval(safeHotPredictions, hotPredictions),
    eligibleRoutingRecallInterval: wilsonInterval(safeHotPredictions, expectedHot),
  };
}

function confusionMatrix(records) {
  const matrix = {
    "hot-reload": { "hot-reload": 0, "build-device": 0, none: 0 },
    "build-device": { "hot-reload": 0, "build-device": 0, none: 0 },
    none: { "hot-reload": 0, "build-device": 0, none: 0 },
  };
  for (const record of records) {
    const expected = record.expectedLane;
    const predicted = record.predictedLane || record.action || "none";
    if (!matrix[expected]) matrix[expected] = { "hot-reload": 0, "build-device": 0, none: 0 };
    if (!Object.hasOwn(matrix[expected], predicted)) matrix[expected][predicted] = 0;
    matrix[expected][predicted] += 1;
  }
  return matrix;
}

export function isSemanticallyConfirmed(record) {
  return record?.terminalState === "semantically-observed"
    && record.applied === true
    && record.refreshAcknowledged === true
    && record.oracleMatched === true
    && Number(record.revision) > Number(record.priorRevision || 0);
}

export function deviceSummary(records) {
  // Static classification records share the same JSONL/report shape but are
  // not physical-device attempts. Keep them out of device reliability and
  // latency denominators unless the runner explicitly marks the record.
  const deviceRecords = records.filter((record) => record.deviceAttempt === true);
  const validHot = deviceRecords.filter((record) =>
    record.validity !== "authoring-error" && record.expectedLane === "hot-reload"
  );
  const confirmed = validHot.filter(isSemanticallyConfirmed);
  const fallback = validHot.filter((record) => record.terminalState === "hot-reload-failed");
  const timeouts = validHot.filter((record) => record.errorCode === "PATCH_TIMEOUT");
  const restores = deviceRecords.filter((record) => record.operation === "restore");
  const restoreFailures = restores.filter((record) => record.terminalState !== "restored");
  const partialApplications = deviceRecords.filter((record) => record.partialApplication === true);
  return {
    attemptedValidHotEdits: validHot.length,
    confirmedHotEdits: confirmed.length,
    confirmedReliability: wilsonInterval(confirmed.length, validHot.length),
    fallbackCount: fallback.length,
    fallbackRate: wilsonInterval(fallback.length, validHot.length),
    timeoutCount: timeouts.length,
    restoreCount: restores.length,
    restoreFailureCount: restoreFailures.length,
    partialApplicationCount: partialApplications.length,
    latency: latencySummary(confirmed.map((record) => record.timing?.totalMs)),
    byCategory: summarizeGroups(validHot, (record) => record.category),
    byWorkload: summarizeGroups(validHot, (record) => record.workload),
  };
}

export function workflowSummary(records) {
  const valid = records.filter((record) => record.validity !== "authoring-error");
  const confirmed = valid.filter((record) => record.confirmedNoBuild === true);
  return {
    validEdits: valid.length,
    confirmedNoBuildEdits: confirmed.length,
    accelerationRate: wilsonInterval(confirmed.length, valid.length),
    byCategory: summarizeGroups(valid, (record) => record.category, (group) =>
      wilsonInterval(group.filter((record) => record.confirmedNoBuild === true).length, group.length)
    ),
    byWorkload: summarizeGroups(valid, (record) => record.workload, (group) =>
      wilsonInterval(group.filter((record) => record.confirmedNoBuild === true).length, group.length)
    ),
  };
}

export function summarizeGroups(records, key, summarize = (group) => ({ count: group.length })) {
  const groups = new Map();
  for (const record of records) {
    const name = String(key(record) || "unknown");
    const group = groups.get(name) || [];
    group.push(record);
    groups.set(name, group);
  }
  return Object.fromEntries([...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, group]) => [name, summarize(group)]));
}

function finiteNumbers(values) {
  return values
    .map(Number)
    .filter((value) => Number.isFinite(value));
}
