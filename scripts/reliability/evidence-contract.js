export const evidenceClasses = Object.freeze({
  "ci-repository": { ordinal: 1, passProvenance: "repository-run", irreducible: false },
  "persistent-mac": { ordinal: 2, passProvenance: "persistent-mac-run", irreducible: true },
  simulator: { ordinal: 3, passProvenance: "simulator-run", irreducible: true },
  "physical-device": { ordinal: 4, passProvenance: "physical-device-run", irreducible: true },
  "network-environment": { ordinal: 5, passProvenance: "environment-run", irreducible: true },
  "external-beta-human": { ordinal: 6, passProvenance: "human-attestation", irreducible: true },
});

const statuses = new Set(["not-collected", "blocked", "failed", "passed", "fixture-passed"]);

export function validateEvidenceRecord(record) {
  const errors = [];
  const definition = evidenceClasses[record?.evidenceClass];
  if (!record || typeof record !== "object") return { valid: false, errors: ["record must be an object"] };
  if (!nonEmpty(record.id)) errors.push("id is required");
  if (!nonEmpty(record.requirementId)) errors.push("requirementId is required");
  if (!definition) errors.push(`unknown evidence class: ${String(record.evidenceClass)}`);
  if (!statuses.has(record.status)) errors.push(`unknown status: ${String(record.status)}`);

  if (record.status === "fixture-passed" && record.provenance?.kind !== "fixture") {
    errors.push("fixture-passed requires fixture provenance");
  }

  if (record.status === "passed" && definition) {
    if (record.provenance?.kind === "fixture") errors.push("fixture evidence cannot satisfy a requirement");
    if (record.provenance?.kind !== definition.passProvenance) {
      errors.push(`${record.evidenceClass} requires ${definition.passProvenance} provenance`);
    }
    if (!nonEmpty(record.provenance?.ref)) errors.push("passed evidence requires provenance.ref");
    if (definition.irreducible && !hasEnvironment(record.environment)) {
      errors.push(`${record.evidenceClass} requires environment identity`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function validateEvidenceReport(report) {
  const errors = [];
  if (report?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  const requirements = Array.isArray(report?.requirements) ? report.requirements : [];
  const records = Array.isArray(report?.records) ? report.records : [];
  if (!Array.isArray(report?.requirements)) errors.push("requirements must be an array");
  if (!Array.isArray(report?.records)) errors.push("records must be an array");

  const requirementMap = new Map();
  for (const requirement of requirements) {
    if (!nonEmpty(requirement?.id) || !evidenceClasses[requirement?.evidenceClass]) {
      errors.push("every requirement needs a valid id and evidenceClass");
      continue;
    }
    if (requirementMap.has(requirement.id)) errors.push(`duplicate requirement: ${requirement.id}`);
    requirementMap.set(requirement.id, requirement);
  }

  const validRecords = [];
  for (const record of records) {
    const validation = validateEvidenceRecord(record);
    errors.push(...validation.errors.map((error) => `${record?.id ?? "record"}: ${error}`));
    const requirement = requirementMap.get(record?.requirementId);
    if (!requirement) errors.push(`${record?.id ?? "record"}: unknown requirementId`);
    else if (record.evidenceClass !== requirement.evidenceClass) errors.push(`${record.id}: evidence class mismatch`);
    if (validation.valid && requirement && record.evidenceClass === requirement.evidenceClass) validRecords.push(record);
  }

  const byRequirement = {};
  for (const requirement of requirements) {
    if (!evidenceClasses[requirement?.evidenceClass]) continue;
    const attempts = validRecords.filter((record) => record.requirementId === requirement.id);
    let state = "not-collected";
    if (attempts.some((record) => record.status === "passed")) state = "passed";
    else if (attempts.some((record) => record.status === "failed")) state = "failed";
    else if (attempts.some((record) => record.status === "blocked")) state = "blocked";
    byRequirement[requirement.id] = {
      evidenceClass: requirement.evidenceClass,
      state,
      fixturePasses: attempts.filter((record) => record.status === "fixture-passed").length,
    };
  }

  const states = Object.values(byRequirement);
  return {
    valid: errors.length === 0,
    errors,
    summary: {
      complete: states.length > 0 && states.every((entry) => entry.state === "passed"),
      byRequirement,
    },
  };
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasEnvironment(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}
