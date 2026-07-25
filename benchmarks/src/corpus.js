import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const CORPUS_SCHEMA_VERSION = 1;
export const VALID_LANES = new Set(["hot-reload", "build-device", "none"]);
export const VALID_VALIDITY = new Set(["valid", "authoring-error"]);
export const VALID_CONFIRMATION_POLICIES = new Set([
  "swiftui-body",
  "interposed-function",
  "unverified",
]);

const SECRET_PATTERN = /(token\s*=|bearer\s+|trycloudflare\.com|[?&]token=)/i;

export function loadCorpus(corpusPath) {
  const absolutePath = resolve(corpusPath);
  const corpusRoot = dirname(absolutePath);
  let corpus;
  try {
    corpus = JSON.parse(readFileSync(absolutePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read corpus ${absolutePath}: ${error.message}`);
  }
  assertValidCorpus(corpus, { corpusRoot });
  return { corpus, corpusPath: absolutePath, corpusRoot };
}

export function validateCorpus(corpus, { corpusRoot = process.cwd() } = {}) {
  const errors = [];
  if (!corpus || typeof corpus !== "object" || Array.isArray(corpus)) {
    return { valid: false, errors: ["Corpus must be a JSON object."] };
  }
  if (corpus.schemaVersion !== CORPUS_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${CORPUS_SCHEMA_VERSION}.`);
  }
  requireNonemptyString(corpus.corpusVersion, "corpusVersion", errors);
  requireNonemptyString(corpus.fixtureRevision, "fixtureRevision", errors);
  if (containsSecret(corpus)) errors.push("Corpus contains a token or public delivery URL.");
  if (!Array.isArray(corpus.cases)) {
    errors.push("cases must be an array.");
    return { valid: false, errors };
  }

  if (corpus.metadata !== undefined) validateMetadata(corpus.metadata, corpus.cases, errors);

  const ids = new Set();
  for (const [index, value] of corpus.cases.entries()) {
    const prefix = `cases[${index}]`;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      errors.push(`${prefix} must be an object.`);
      continue;
    }
    if (!/^[a-z0-9][a-z0-9-]*$/.test(String(value.id || ""))) {
      errors.push(`${prefix}.id must contain lowercase letters, numbers, and hyphens.`);
    } else if (ids.has(value.id)) {
      errors.push(`${prefix}.id duplicates ${value.id}.`);
    } else {
      ids.add(value.id);
    }
    requireNonemptyString(value.workload, `${prefix}.workload`, errors);
    requireNonemptyString(value.category, `${prefix}.category`, errors);
    if (!VALID_VALIDITY.has(value.validity)) {
      errors.push(`${prefix}.validity is invalid.`);
    }
    if (!VALID_LANES.has(value.expectedLane)) {
      errors.push(`${prefix}.expectedLane is invalid.`);
    }
    if (value.confirmationPolicy !== undefined
      && !VALID_CONFIRMATION_POLICIES.has(value.confirmationPolicy)) {
      errors.push(`${prefix}.confirmationPolicy is invalid.`);
    }
    const mutationPath = safeCorpusPath(value.mutation, corpusRoot, `${prefix}.mutation`, errors);
    if (mutationPath && !existsSync(mutationPath)) {
      errors.push(`${prefix}.mutation does not exist.`);
    }
    validateBaselineHashes(value.baselineHashes, corpusRoot, prefix, errors);
    if (value.expectedLane === "hot-reload" && value.validity === "valid"
      && value.confirmationPolicy !== "unverified" && !value.oracle) {
      errors.push(`${prefix}.oracle is required for a confirmed hot-reload case.`);
    }
    if (containsSecret(value)) errors.push(`${prefix} contains a token or public delivery URL.`);
  }

  return { valid: errors.length === 0, errors };
}

function validateMetadata(metadata, cases, errors) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    errors.push("metadata must be an object.");
    return;
  }
  const expected = {
    totalCases: cases.length,
    expectedHotReload: cases.filter((value) => value.validity === "valid" && value.expectedLane === "hot-reload").length,
    expectedRebuild: cases.filter((value) => value.validity === "valid" && value.expectedLane === "build-device").length,
    authoringErrors: cases.filter((value) => value.validity === "authoring-error").length,
    multiFileOperations: cases.filter((value) => value.multiFile === true).length,
    smokeHotCases: cases.filter((value) => value.smoke === true && value.expectedLane === "hot-reload").length,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (metadata[key] !== value) errors.push(`metadata.${key} must equal ${value}.`);
  }
}

export function assertValidCorpus(corpus, options = {}) {
  const result = validateCorpus(corpus, options);
  if (!result.valid) {
    throw new Error(`Invalid benchmark corpus:\n${result.errors.map((error) => `- ${error}`).join("\n")}`);
  }
  return corpus;
}

export function readMutation(corpusRoot, mutationPath) {
  const absolutePath = resolveSafePath(corpusRoot, mutationPath);
  return readFileSync(absolutePath, "utf8");
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function resolveSafePath(root, relativePath) {
  const rootPath = resolve(root);
  const candidate = resolve(rootPath, relativePath || "");
  const escaped = relative(rootPath, candidate).startsWith("..") || isAbsolute(relative(rootPath, candidate));
  if (!relativePath || isAbsolute(relativePath) || escaped) {
    throw new Error(`Benchmark path escapes its root: ${relativePath || "<empty>"}`);
  }
  return candidate;
}

function validateBaselineHashes(value, corpusRoot, prefix, errors) {
  if (value === undefined) return;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${prefix}.baselineHashes must be an object.`);
    return;
  }
  for (const [path, hash] of Object.entries(value)) {
    safeCorpusPath(path, corpusRoot, `${prefix}.baselineHashes path`, errors);
    if (!/^[a-f0-9]{64}$/.test(String(hash))) {
      errors.push(`${prefix}.baselineHashes.${path} must be a lowercase SHA-256 hash.`);
    }
  }
}

function safeCorpusPath(value, root, label, errors) {
  if (typeof value !== "string" || !value || isAbsolute(value) || value.startsWith("~")) {
    errors.push(`${label} must be a relative path.`);
    return null;
  }
  try {
    return resolveSafePath(root, value);
  } catch {
    errors.push(`${label} escapes the corpus root.`);
    return null;
  }
}

function requireNonemptyString(value, label, errors) {
  if (typeof value !== "string" || value.trim() === "") errors.push(`${label} must be a nonempty string.`);
}

function containsSecret(value) {
  if (typeof value === "string") return SECRET_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsSecret);
  if (value && typeof value === "object") return Object.values(value).some(containsSecret);
  return false;
}
