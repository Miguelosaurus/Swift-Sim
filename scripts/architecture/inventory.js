#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "../..");
const policyPath = join(scriptDirectory, "baseline-policy.json");
const policyRepositoryPath = "scripts/architecture/baseline-policy.json";
const MAX_PRODUCTION_LINES_WITHOUT_ADR = 800;
const policyCategories = [
  "preloadRuntimePatchModules",
  "childProcessImporters",
  "destructiveFilesystemImporters",
  "sourceTextImplementationTests",
  "oversizedProductionFiles",
];
const setCategories = new Set(["preloadRuntimePatchModules", "oversizedProductionFiles"]);
const mapCategories = new Set(policyCategories.filter((category) => !setCategories.has(category)));
const destructiveFilesystemApis = new Set([
  "appendFile", "appendFileSync", "chmod", "chmodSync", "chown", "chownSync",
  "copyFile", "copyFileSync", "cp", "cpSync", "fchmod", "fchmodSync", "fchown", "fchownSync",
  "ftruncate", "ftruncateSync", "link", "linkSync", "mkdir", "mkdirSync", "open", "openSync",
  "rename", "renameSync", "rm", "rmSync", "rmdir", "rmdirSync", "symlink", "symlinkSync",
  "truncate", "truncateSync", "unlink", "unlinkSync", "utimes", "utimesSync", "write", "writeFile",
  "writeFileSync", "writev", "writevSync",
]);
const excludedRootPatterns = [
  /^(?:\.build|\.git|DerivedData|build|dist|node_modules|coverage|fixtures|__fixtures__|results)(?:\/|$)/,
  /^(?:test|benchmarks)\/(?:fixtures|__fixtures__)(?:\/|$)/,
  /^benchmarks\/results(?:\/|$)/,
];
const productionJavaScriptPattern = /^(?:mac-helper\/(?:src|bin)\/).+\.(?:js|mjs|cjs)$/;
const productionTypeScriptPattern = /^(?:mac-helper\/(?:src|bin)\/).+\.(?:ts|mts|cts)$/;
const typescriptDeclarationPattern = /\.d\.(?:ts|mts|cts)$/;
const unsupportedNodeTypeScriptPattern = /^(?:mac-helper\/(?:src|bin)\/)\S+\.tsx$/;
const productionSwiftPattern = /^(?:Companion\/SwiftSimCompanion|Sources)\/.+\.swift$/;
const testPattern = /^(?:test|benchmarks\/test|Companion\/SwiftSimCompanionTests)\/.+/;
const sourceTextTestExtensionPattern = /\.(?:js|mjs|cjs|ts|mts|cts|tsx|swift)$/;
const markdownPattern = /(?:^|\/)README\.md$|\.md$/;
const preloadRuntimeNamePattern = /(?:preload|runtimeboundary|hardenedruntime|childruntime|fetchboundary|artifactcleanupboundary|devicebuildcapabilityboundary|helperhttpboundary)/i;
const monitoredModulePattern = /^(?:node:)?(?:child_process|fs|fs\/promises)$/;

const pathRules = {
  productionJavaScript: "mac-helper/src/**/*.js and mac-helper/bin/**/*.js; tracked only",
  productionTypeScript: "mac-helper/src/**/*.ts, *.mts, and *.cts; tracked only, with .d.ts/.d.mts/.d.cts inventoried but excluded from runtime analysis",
  unsupportedNodeTypeScript: "mac-helper/src/**/*.tsx and mac-helper/bin/**/*.tsx are explicitly prohibited",
  productionSwift: "Companion/SwiftSimCompanion/**/*.swift and Sources/**/*.swift; tracked only",
  tests: "test/**, benchmarks/test/**, and Companion/SwiftSimCompanionTests/**; tracked only",
  documentation: "tracked Markdown files outside excluded generated/test fixture roots",
  excluded: "path-aware generated roots, dependencies, .git, benchmark results, and test fixture roots; declared production roots take precedence",
  importScanner: "statement-aware lexical scanning of static ESM imports, TypeScript import-equals, and CommonJS require calls; comments, strings, and templates are ignored; declarations and type-only bindings are non-runtime; dynamic imports and computed requires are not classified",
  enforcementUnit: "one capability/importer per production file; evidence lists APIs and lines without changing the enforcement count",
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === "--json") {
    console.log(JSON.stringify(collectInventory(repositoryRoot), null, 2));
  } else if (command === "--check") {
    const policy = JSON.parse(readFileSync(policyPath, "utf8"));
    const inventory = collectInventory(repositoryRoot);
    const result = checkInventory(inventory, policy, { root: repositoryRoot });
    if (result.violations.length > 0) {
      for (const violation of result.violations) console.error(`Architecture check: ${violation}`);
      process.exitCode = 1;
    } else {
      console.log(`Architecture check passed (${result.inventory.productionFileCounts.total} production source files).`);
    }
  } else {
    console.error("Usage: node scripts/architecture/inventory.js --json|--check");
    process.exitCode = 2;
  }
}

export function collectInventory(root, options = {}) {
  const trackedFiles = normalizeTrackedFiles(root, options.trackedFiles);
  const sourceFiles = trackedFiles.filter((file) => !isExcluded(file));
  const productionJavaScriptFiles = sourceFiles.filter((file) => productionJavaScriptPattern.test(file));
  const productionTypeScriptFiles = sourceFiles.filter((file) => productionTypeScriptPattern.test(file));
  const typescriptDeclarationFiles = productionTypeScriptFiles.filter((file) => typescriptDeclarationPattern.test(file));
  const productionRuntimeTypeScriptFiles = productionTypeScriptFiles.filter((file) => !typescriptDeclarationPattern.test(file));
  const unsupportedNodeFiles = sourceFiles.filter((file) => unsupportedNodeTypeScriptPattern.test(file));
  const productionSwiftFiles = sourceFiles.filter((file) => productionSwiftPattern.test(file));
  const productionNodeFiles = [...productionJavaScriptFiles, ...productionRuntimeTypeScriptFiles].sort();
  const productionSourceFiles = [...productionNodeFiles, ...productionSwiftFiles].sort();
  const fileReader = options.readFile || ((file) => readFileSync(join(root, file), "utf8"));
  const contents = new Map();
  const read = (file) => {
    if (!contents.has(file)) contents.set(file, fileReader(file));
    return contents.get(file);
  };

  const productionFileDetails = productionSourceFiles.map((file) => ({
    path: file,
    language: languageFor(file),
    lines: lineCount(read(file)),
  }));
  const productionNodeDetails = productionNodeFiles.map((file) => analyzeNodeModule(file, read(file)));
  const preloadRuntimePatchModules = productionNodeDetails
    .filter((detail) => detail.preloadRuntimeReasons.length > 0)
    .map((detail) => ({ path: detail.path, reasons: detail.preloadRuntimeReasons }));
  const childProcessImports = productionNodeDetails
    .map((detail) => detail.childProcessImporter)
    .filter(Boolean);
  const destructiveFilesystemImports = productionNodeDetails
    .map((detail) => detail.destructiveFilesystemImporter)
    .filter(Boolean);
  const directGlobalFetchUses = productionNodeDetails.flatMap((detail) => detail.directGlobalFetchUses);
  const writableJSONDomainStateStores = productionNodeDetails.flatMap((detail) => detail.writableJSONDomainStateStores);
  const sourceTextImplementationTests = sourceFiles
    .filter((file) => testPattern.test(file) && sourceTextTestExtensionPattern.test(file))
    .map((file) => analyzeTest(file, read(file)))
    .filter(Boolean);
  const packageEntrypoints = packageEntrypointsFor(root, trackedFiles, read);
  const workflowBadgeTargets = workflowBadgesFor(root, sourceFiles, read);

  return {
    schemaVersion: 2,
    pathRules,
    productionFileCounts: {
      javascript: productionJavaScriptFiles.length,
      typescript: productionTypeScriptFiles.length,
      typescriptDeclarations: typescriptDeclarationFiles.length,
      swift: productionSwiftFiles.length,
      total: productionSourceFiles.length,
    },
    productionFiles: productionFileDetails.sort((a, b) => a.path.localeCompare(b.path)),
    typescriptDeclarationFiles: typescriptDeclarationFiles.sort(),
    unsupportedNodeFiles: unsupportedNodeFiles.sort(),
    largestProductionFiles: [...productionFileDetails]
      .sort((a, b) => b.lines - a.lines || a.path.localeCompare(b.path))
      .slice(0, 20),
    preloadRuntimePatchModules,
    childProcessImports: childProcessImports.sort(compareEvidence),
    destructiveFilesystemImports: destructiveFilesystemImports.sort(compareEvidence),
    sourceTextImplementationTests: sourceTextImplementationTests.sort(compareEvidence),
    directGlobalFetchUses: directGlobalFetchUses.sort(compareEvidence),
    writableJSONDomainStateStores: writableJSONDomainStateStores.sort(compareEvidence),
    packageEntrypoints: packageEntrypoints.sort((a, b) => `${a.kind}:${a.name}`.localeCompare(`${b.kind}:${b.name}`)),
    workflowBadgeTargets: workflowBadgeTargets.sort(compareEvidence),
    generatedFrom: {
      trackedFiles: sourceFiles.length,
      productionNodeFiles: productionNodeFiles.length,
    },
  };
}

export function collectInventoryAtCommit(root, commit) {
  assertCommitExists(root, commit);
  const trackedFiles = gitOutput(root, ["ls-tree", "-r", "--name-only", "-z", commit]).split("\0").filter(Boolean).sort();
  const cache = new Map();
  return collectInventory(root, {
    trackedFiles,
    readFile(file) {
      if (!cache.has(file)) cache.set(file, gitOutput(root, ["show", `${commit}:${file}`]));
      return cache.get(file);
    },
  });
}

export function checkInventory(inventory, policy, options = {}) {
  const violations = [];
  const normalized = normalizePolicy(policy);
  if (normalized.errors.length > 0) violations.push(...normalized.errors);
  let history = options.history || null;
  if (!history && options.root && normalized.policy) {
    try {
      history = createHistoryContext(options.root, normalized.policy, options);
    } catch (error) {
      violations.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (history && normalized.policy) {
    violations.push(...verifyPolicyHistory(normalized.policy, history, options));
  }

  if (normalized.policy) {
    violations.push(...validateAllowlistEntries(normalized.policy.allowlists, options));
    violations.push(...compareCurrentInventory(inventory, normalized.policy, options));
  }

  if (inventory.unsupportedNodeFiles.length > 0) {
    for (const file of inventory.unsupportedNodeFiles) {
      violations.push(`unsupported Node production extension .tsx: ${file}`);
    }
  }

  return { inventory, violations: [...new Set(violations)] };
}

function normalizePolicy(policy) {
  const errors = [];
  if (!policy || policy.version !== 2) errors.push("policy version must be 2");
  if (!policy || !/^[0-9a-f]{40}$/.test(policy.baselineCommit || "")) {
    errors.push("baselineCommit must be a full 40-character commit SHA");
  }
  if (!policy?.baseline || !policy?.caps || !policy?.allowlists) {
    errors.push("policy must contain baseline, caps, and allowlists sections");
    return { errors, policy: null };
  }
  for (const category of policyCategories) {
    if (!(category in policy.baseline)) errors.push(`baseline is missing ${category}`);
    if (!(category in policy.caps)) errors.push(`caps is missing ${category}`);
    if (!(category in policy.allowlists)) errors.push(`allowlists is missing ${category}`);
  }
  return { errors, policy: errors.length > 0 ? null : policy };
}

function createHistoryContext(root, policy, options = {}) {
  const baselineCommit = policy.baselineCommit;
  const baseCommit = resolveBaseCommit(root, baselineCommit, options);
  return {
    root,
    baselineCommit,
    baseCommit,
    baselineInventory: collectInventoryAtCommit(root, baselineCommit),
    basePolicy: readPolicyAtCommit(root, baseCommit),
    knownFiles: new Set(normalizeTrackedFiles(root)),
  };
}

function verifyPolicyHistory(policy, history, options) {
  const violations = [];
  if (!history.baselineInventory) {
    violations.push("baseline inventory could not be generated from baselineCommit");
    return violations;
  }
  const expectedBaseline = snapshotFromInventory(history.baselineInventory);
  if (!sameValue(policy.baseline, expectedBaseline)) {
    violations.push("baseline sections do not match generated inventory at baselineCommit");
  }
  if (history.basePolicy) {
    if (policy.baselineCommit !== history.basePolicy.baselineCommit) {
      violations.push("baselineCommit changed from the PR base policy");
    }
    if (!sameValue(policy.baseline, history.basePolicy.baseline)) {
      violations.push("baseline snapshot is immutable and cannot change from the PR base policy");
    }
    violations.push(...compareCapsMonotonic(policy.caps, history.basePolicy.caps));
    violations.push(...compareAllowlistsMonotonic(policy.allowlists, history.basePolicy.allowlists));
  } else if (policy.baselineCommit !== history.baseCommit) {
    violations.push("a new policy must anchor baselineCommit to the PR merge-base");
  }
  if (policy.baselineCommit !== history.baselineCommit) {
    violations.push("baselineCommit does not match the policy being checked");
  }
  return violations;
}

function compareCurrentInventory(inventory, policy, options) {
  const violations = [];
  const allowlists = indexAllowlists(policy.allowlists);
  const current = snapshotFromInventory(inventory);

  for (const category of policyCategories) {
    if (setCategories.has(category)) {
      const caps = new Set(policy.caps[category]);
      const observed = new Set(current[category]);
      for (const path of caps) {
        if (!observed.has(path)) violations.push(`stale ${category} cap for removed debt ${path}`);
      }
      for (const path of observed) {
        if (!caps.has(path) && !allowlists[category].has(path)) {
          violations.push(`new ${category} ${path} is not in caps or a structured allowlist`);
        }
      }
    } else {
      const caps = policy.caps[category];
      const observed = current[category];
      for (const [path, cap] of Object.entries(caps)) {
        const count = Number(observed[path] || 0);
        if (count < Number(cap)) violations.push(`stale ${category} cap for removed debt ${path}: cap ${cap}, current ${count}`);
      }
      for (const [path, count] of Object.entries(observed)) {
        const cap = Number(caps[path] || 0);
        const exception = allowlists[category].get(path);
        const allowed = exception && Number.isInteger(exception.max) && exception.max >= count;
        if (count > cap && !allowed) {
          violations.push(`new ${category} capability in ${path}: cap ${cap}, current ${count}`);
        }
      }
    }
  }

  for (const entry of inventory.workflowBadgeTargets.filter((candidate) => !candidate.exists)) {
    violations.push(`stale workflow badge target ${entry.path}:${entry.line} -> ${entry.workflow}`);
  }
  return violations;
}

function validateAllowlistEntries(allowlists, options) {
  const violations = [];
  const today = options.today || new Date().toISOString().slice(0, 10);
  const knownFiles = options.history?.knownFiles || (options.root ? new Set(normalizeTrackedFiles(options.root)) : null);
  for (const category of policyCategories) {
    const entries = allowlists[category];
    if (!Array.isArray(entries)) {
      violations.push(`allowlists.${category} must be an array of structured entries`);
      continue;
    }
    const ids = new Set();
    const paths = new Set();
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") {
        violations.push(`invalid ${category} allowlist entry`);
        continue;
      }
      if (!entry.id || typeof entry.id !== "string" || ids.has(entry.id)) violations.push(`allowlist ${category} entries require unique ids`);
      ids.add(entry.id);
      if (!entry.path || typeof entry.path !== "string" || paths.has(entry.path)) violations.push(`allowlist ${category} entries require unique paths`);
      paths.add(entry.path);
      if (!/^docs\/internal\/adr\/ADR-\d{4}-[^/]+\.md$/.test(entry.adr || "")) {
        violations.push(`allowlist ${category}/${entry.id || "<unknown>"} requires an ADR path`);
      } else if (knownFiles && !knownFiles.has(entry.adr)) {
        violations.push(`allowlist ${category}/${entry.id || "<unknown>"} references a missing ADR ${entry.adr}`);
      }
      for (const field of ["reason", "owner", "removalPhase"]) {
        if (typeof entry[field] !== "string" || entry[field].trim() === "") violations.push(`allowlist ${category}/${entry.id || "<unknown>"} requires ${field}`);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.expiresOn || "") || entry.expiresOn < today) {
        violations.push(`allowlist ${category}/${entry.id || "<unknown>"} is missing a future expiresOn date`);
      }
      if (mapCategories.has(category) && (!Number.isInteger(entry.max) || entry.max < 1)) {
        violations.push(`allowlist ${category}/${entry.id || "<unknown>"} requires a positive integer max`);
      }
      if (setCategories.has(category) && "max" in entry) {
        violations.push(`allowlist ${category}/${entry.id || "<unknown>"} must not define max`);
      }
    }
  }
  return violations;
}

function compareCapsMonotonic(current, base) {
  const violations = [];
  for (const category of policyCategories) {
    if (setCategories.has(category)) {
      const baseSet = new Set(base?.[category] || []);
      for (const path of current[category] || []) {
        if (!baseSet.has(path)) violations.push(`${category} cap was increased with new path ${path}`);
      }
    } else {
      const baseMap = base?.[category] || {};
      for (const [path, value] of Object.entries(current[category] || {})) {
        if (!(path in baseMap)) violations.push(`${category} cap was increased with new path ${path}`);
        else if (Number(value) > Number(baseMap[path])) violations.push(`${category} cap increased for ${path}: base ${baseMap[path]}, current ${value}`);
      }
    }
  }
  return violations;
}

function compareAllowlistsMonotonic(current, base) {
  const violations = [];
  for (const category of policyCategories) {
    const baseById = new Map((base?.[category] || []).map((entry) => [entry.id, entry]));
    for (const entry of current[category] || []) {
      const previous = baseById.get(entry.id);
      if (previous && !sameValue(previous, entry)) {
        violations.push(`existing ${category} allowlist ${entry.id} may only be removed, not edited or extended`);
      }
    }
  }
  return violations;
}

export function snapshotFromInventory(inventory) {
  return {
    preloadRuntimePatchModules: inventory.preloadRuntimePatchModules.map((entry) => entry.path).sort(),
    childProcessImporters: countByPath(inventory.childProcessImports),
    destructiveFilesystemImporters: countByPath(inventory.destructiveFilesystemImports),
    sourceTextImplementationTests: countByPath(inventory.sourceTextImplementationTests),
    oversizedProductionFiles: inventory.productionFiles.filter((entry) => entry.lines > MAX_PRODUCTION_LINES_WITHOUT_ADR).map((entry) => entry.path).sort(),
  };
}

function indexAllowlists(allowlists) {
  const result = {};
  for (const category of policyCategories) {
    const index = new Map();
    for (const entry of allowlists[category] || []) index.set(entry.path, entry);
    result[category] = setCategories.has(category) ? new Set(index.keys()) : index;
  }
  return result;
}

function analyzeNodeModule(path, source) {
  const lexical = lexSource(source);
  const imports = scanImports(path, lexical);
  const childProcessEntries = imports.filter((entry) => entry.runtime && entry.module === "node:child_process");
  const childProcessImporter = childProcessEntries.length > 0 ? {
    path,
    line: Math.min(...childProcessEntries.map((entry) => entry.line)),
    kind: "importer-capability",
    modules: [...new Set(childProcessEntries.map((entry) => entry.module))].sort(),
  } : null;
  const destructiveFilesystemImporter = destructiveApisForImports(path, lexical.codeSource, imports, lexical.tokens);
  const directGlobalFetchUses = [];
  for (const match of lexical.codeSource.matchAll(/(?<![\w.$])fetch\s*\(/g)) {
    directGlobalFetchUses.push({ path, line: lineNumber(source, match.index), kind: "global-fetch-call" });
  }
  for (const match of lexical.codeSource.matchAll(/\bglobal(?:This)?\.fetch\b/g)) {
    directGlobalFetchUses.push({ path, line: lineNumber(source, match.index), kind: match[0] });
  }
  const jsonPathLiterals = lexical.tokens
    .filter((token) => token.kind === "string" && token.value.endsWith(".json"))
    .map((token) => token.value)
    .filter((value) => !value.endsWith("package.json"))
    .sort();
  const writesJSON = destructiveFilesystemImporter && /\bJSON\s*\.\s*stringify\s*\(/.test(lexical.codeSource);
  const writableJSONDomainStateStores = writesJSON
    ? [...new Set(jsonPathLiterals)].map((storePath) => {
      const token = lexical.tokens.find((candidate) => candidate.kind === "string" && candidate.value === storePath);
      return { path, line: lineNumber(source, token?.start), storePath, owner: path };
    })
    : [];
  const preloadRuntimeReasons = [];
  if (preloadRuntimeNamePattern.test(basename(path))) preloadRuntimeReasons.push("module-name");
  if (localImportModules(lexical.tokens).some((entry) => entry.runtime && /^\.{1,2}\//.test(entry.module) && preloadRuntimeNamePattern.test(basename(entry.module)))) {
    preloadRuntimeReasons.push("imports-preload-or-runtime-boundary");
  }
  const patchEvidence = patchEvidenceFor(lexical.codeSource, imports, lexical.tokens);
  if (patchEvidence.length > 0) preloadRuntimeReasons.push(...patchEvidence);
  return {
    path,
    childProcessImporter,
    destructiveFilesystemImporter,
    directGlobalFetchUses,
    writableJSONDomainStateStores,
    preloadRuntimeReasons: [...new Set(preloadRuntimeReasons)],
  };
}

function scanImports(path, sourceOrLexical) {
  const lexical = sourceOrLexical.tokens ? sourceOrLexical : lexSource(sourceOrLexical);
  const { tokens } = lexical;
  const imports = [];
  const skippedRequireIndices = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind !== "identifier") continue;
    if (token.value === "import") {
      const importEquals = parseImportEquals(tokens, index);
      if (importEquals) {
        if (monitoredModulePattern.test(importEquals.entry.module)) {
          imports.push({ path, ...importEquals.entry, line: lineNumber(lexical.source, token.start) });
        }
        skippedRequireIndices.add(importEquals.requireIndex);
        index = importEquals.endIndex;
        continue;
      }
      if (tokens[index + 1]?.value === "(" || tokens[index + 1]?.value === ".") continue;
      const parsedImport = parseStaticImport(tokens, index);
      if (parsedImport && monitoredModulePattern.test(parsedImport.entry.module)) {
        imports.push({ path, ...parsedImport.entry, line: lineNumber(lexical.source, token.start) });
        index = parsedImport.endIndex;
      }
      continue;
    }
    if (token.value !== "require" || skippedRequireIndices.has(index)) continue;
    const parsedRequire = parseCommonJSRequire(tokens, index);
    if (parsedRequire && monitoredModulePattern.test(parsedRequire.module)) {
      imports.push({
        path,
        line: lineNumber(lexical.source, token.start),
        kind: "commonjs-require",
        module: parsedRequire.module,
        bindings: parseRequireBindings(tokens, index),
        runtime: true,
      });
    }
  }
  return imports.sort((a, b) => a.line - b.line || a.module.localeCompare(b.module));
}

function lexSource(source) {
  const tokens = [];
  const masked = source.split("");
  const mask = (start, end) => {
    for (let index = start; index < end; index += 1) {
      if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " ";
    }
  };
  let index = 0;
  const lexString = () => {
    const start = index;
    const quote = source[index];
    let value = "";
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        if (index + 1 < source.length) value += source[index + 1];
        index += 2;
        continue;
      }
      if (source[index] === quote) {
        index += 1;
        break;
      }
      value += source[index];
      index += 1;
    }
    tokens.push({ kind: "string", value, start, end: index });
    mask(start, index);
  };
  const lexTemplate = () => {
    mask(index, index + 1);
    index += 1;
    while (index < source.length) {
      if (source[index] === "\\") {
        mask(index, Math.min(source.length, index + 2));
        index += 2;
        continue;
      }
      if (source[index] === "`") {
        mask(index, index + 1);
        index += 1;
        return;
      }
      if (source[index] === "$" && source[index + 1] === "{") {
        mask(index, index + 1);
        tokens.push({ kind: "punctuation", value: "{", start: index + 1, end: index + 2 });
        index += 2;
        lexCode(true);
        continue;
      }
      mask(index, index + 1);
      index += 1;
    }
  };
  const lexCode = (stopAtClosingBrace) => {
    let braceDepth = 0;
    while (index < source.length) {
      const character = source[index];
      if (stopAtClosingBrace && character === "}") {
        if (braceDepth === 0) {
          tokens.push({ kind: "punctuation", value: character, start: index, end: index + 1 });
          index += 1;
          return;
        }
        braceDepth -= 1;
      }
      if (stopAtClosingBrace && character === "{") braceDepth += 1;
      if (/\s/.test(character)) {
        index += 1;
        continue;
      }
      if (character === "/" && source[index + 1] === "/") {
        const start = index;
        index += 2;
        while (index < source.length && source[index] !== "\n") index += 1;
        mask(start, index);
        continue;
      }
      if (character === "/" && source[index + 1] === "*") {
        const start = index;
        index += 2;
        while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) index += 1;
        index = Math.min(source.length, index + 2);
        mask(start, index);
        continue;
      }
      if (character === "'" || character === "\"") {
        lexString();
        continue;
      }
      if (character === "`") {
        lexTemplate();
        continue;
      }
      if (/[A-Za-z_$]/.test(character)) {
        const start = index;
        index += 1;
        while (index < source.length && /[\w$]/.test(source[index])) index += 1;
        tokens.push({ kind: "identifier", value: source.slice(start, index), start, end: index });
        continue;
      }
      tokens.push({ kind: "punctuation", value: character, start: index, end: index + 1 });
      index += 1;
    }
  };
  lexCode(false);
  return { source, tokens, codeSource: masked.join("") };
}

function parseStaticImport(tokens, importIndex) {
  let index = importIndex + 1;
  const typeOnly = tokens[index]?.value === "type";
  if (typeOnly) index += 1;
  if (tokens[index]?.kind === "string") {
    return {
      endIndex: index,
      entry: {
        kind: "esm-side-effect",
        module: canonicalModule(tokens[index].value),
        bindings: [],
        runtime: !typeOnly,
      },
    };
  }
  const clauseStart = index;
  if (tokens[index]?.value === "*") {
    index += 1;
    if (tokens[index]?.value === "as") index += 2;
  } else if (tokens[index]?.value === "{") {
    index = consumeBalanced(tokens, index, "{", "}");
    if (index < 0) return null;
  } else if (tokens[index]?.kind === "identifier") {
    index += 1;
    if (tokens[index]?.value === ",") {
      index += 1;
      if (tokens[index]?.value === "*") {
        index += 1;
        if (tokens[index]?.value === "as") index += 2;
      } else if (tokens[index]?.value === "{") {
        index = consumeBalanced(tokens, index, "{", "}");
        if (index < 0) return null;
      } else {
        return null;
      }
    }
  } else {
    return null;
  }
  if (tokens[index]?.value !== "from" || tokens[index + 1]?.kind !== "string") return null;
  const moduleIndex = index + 1;
  const clause = tokensToText(tokens.slice(clauseStart, index));
  const bindings = parseESMBindings(clause, typeOnly);
  return {
    endIndex: moduleIndex,
    entry: {
      kind: "esm",
      module: canonicalModule(tokens[moduleIndex].value),
      bindings,
      runtime: !typeOnly && (bindings.length === 0 || bindings.some((binding) => !binding.typeOnly)),
    },
  };
}

function consumeBalanced(tokens, startIndex, open, close) {
  let depth = 0;
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return -1;
}

function parseImportEquals(tokens, importIndex) {
  let index = importIndex + 1;
  const typeOnly = tokens[index]?.value === "type";
  if (typeOnly) index += 1;
  const local = tokens[index];
  if (local?.kind !== "identifier" || tokens[index + 1]?.value !== "=" || tokens[index + 2]?.value !== "require") return null;
  const parsedRequire = parseCommonJSRequire(tokens, index + 2);
  if (!parsedRequire) return null;
  return {
    requireIndex: index + 2,
    endIndex: parsedRequire.endIndex,
    entry: {
      kind: "typescript-import-equals",
      module: parsedRequire.module,
      bindings: [{ type: "namespace", local: local.value, typeOnly }],
      runtime: !typeOnly,
    },
  };
}

function parseCommonJSRequire(tokens, requireIndex) {
  if (tokens[requireIndex + 1]?.value !== "(" || tokens[requireIndex + 2]?.kind !== "string") return null;
  const closeIndex = requireIndex + 3;
  if (tokens[closeIndex]?.value !== ")") return null;
  return {
    module: canonicalModule(tokens[requireIndex + 2].value),
    endIndex: closeIndex,
  };
}

function parseStaticRequireMember(tokens, requireIndex) {
  const parsedRequire = parseCommonJSRequire(tokens, requireIndex);
  if (!parsedRequire) return null;
  const members = [];
  let index = parsedRequire.endIndex + 1;
  while (tokens[index]?.value === "." && tokens[index + 1]?.kind === "identifier") {
    members.push(tokens[index + 1].value);
    index += 2;
  }
  return {
    ...parsedRequire,
    members,
    endIndex: index - 1,
  };
}

function localImportModules(tokens) {
  const modules = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].kind !== "identifier" || tokens[index].value !== "import") continue;
    if (tokens[index + 1]?.value === "(" && tokens[index + 2]?.kind === "string") {
      modules.push({ module: tokens[index + 2].value, runtime: true });
      index += 2;
      continue;
    }
    const parsedImport = parseStaticImport(tokens, index);
    if (parsedImport) {
      modules.push({ module: parsedImport.entry.module, runtime: parsedImport.entry.runtime });
      index = parsedImport.endIndex;
    }
  }
  return modules;
}

function tokensToText(tokens) {
  return tokens.map((token) => token.value).join(" ");
}

function parseESMBindings(clause, typeOnly = false) {
  const bindings = [];
  const trimmed = clause.trim();
  if (!trimmed) return bindings;
  const namespace = trimmed.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) bindings.push({ type: "namespace", local: namespace[1], typeOnly });
  const named = trimmed.match(/\{([\s\S]*)\}/);
  if (named) {
    for (const item of named[1].split(",")) {
      const trimmedItem = item.trim();
      const itemTypeOnly = typeOnly || /^type\s+/.test(trimmedItem);
      const normalizedItem = trimmedItem.replace(/^type\s+/, "");
      const [imported, local] = normalizedItem.split(/\s+as\s+/);
      if (imported) bindings.push({ type: "named", imported: imported.trim(), local: (local || imported).trim(), typeOnly: itemTypeOnly });
    }
  }
  const defaultBinding = trimmed.split(",")[0].trim();
  if (defaultBinding && /^[A-Za-z_$][\w$]*$/.test(defaultBinding)) bindings.push({ type: "namespace", local: defaultBinding, typeOnly });
  return bindings;
}

function parseRequireBindings(tokens, requireIndex) {
  if (tokens[requireIndex - 1]?.value !== "=") return [];
  const member = parseStaticRequireMember(tokens, requireIndex);
  const leftHandSide = tokens.slice(Math.max(0, requireIndex - 12), requireIndex - 1);
  const openBrace = leftHandSide.map((token) => token.value).lastIndexOf("{");
  const closeBrace = leftHandSide.map((token) => token.value).lastIndexOf("}");
  if (openBrace >= 0 && closeBrace > openBrace) {
    return leftHandSide.slice(openBrace + 1, closeBrace)
      .reduce((items, token) => {
        if (token.value === ",") items.push([]);
        else items[items.length - 1].push(token);
        return items;
      }, [[]])
      .map((item) => {
        const identifiers = item.filter((token) => token.kind === "identifier");
        if (identifiers.length === 0) return null;
        const colon = item.findIndex((token) => token.value === ":");
        const imported = identifiers[0].value;
        const local = colon >= 0 ? identifiers[identifiers.length - 1].value : imported;
        return { type: "named", imported, local };
      })
      .filter(Boolean);
  }
  const identifiers = leftHandSide.filter((token) => token.kind === "identifier");
  const local = identifiers.at(-1);
  if (local && member?.members.length > 0) {
    const imported = member.members.at(-1);
    if (member.members.length === 1 || member.members[0] === "promises") {
      return [{ type: "named", imported, local: local.value }];
    }
  }
  return local ? [{ type: "namespace", local: local.value }] : [];
}

function destructiveApisForImports(path, source, imports, tokens) {
  const apis = new Set();
  const lines = [];
  const modules = new Set();
  for (const entry of imports.filter((candidate) => candidate.runtime && (candidate.module === "node:fs" || candidate.module === "fs" || candidate.module === "node:fs/promises" || candidate.module === "fs/promises"))) {
    const promisesModule = entry.module.endsWith("/promises");
    modules.add(entry.module);
    for (const binding of entry.bindings) {
      if (binding.typeOnly) continue;
      if (binding.type === "named" && destructiveFilesystemApis.has(binding.imported)) {
        apis.add(binding.imported);
        lines.push(entry.line);
      }
      if (binding.type === "named" && binding.imported === "promises") {
        collectNamespaceApis(source, binding.local, apis, lines, true);
      }
      if (binding.type === "namespace") {
        collectNamespaceApis(source, binding.local, apis, lines, promisesModule || binding.promisesNamespace);
      }
    }
    if (entry.bindings.length === 0) {
      collectDirectRequireApis(tokens, entry.module, apis, lines, source);
    }
  }
  if (apis.size === 0) return null;
  return {
    path,
    line: Math.min(...lines),
    kind: "filesystem-capability",
    modules: [...modules].sort(),
    apis: [...apis].sort(),
  };
}

function collectNamespaceApis(source, local, apis, lines, promisesModule) {
  const apiPattern = [...destructiveFilesystemApis].map(escapeRegExp).join("|");
  const propertyPattern = promisesModule
    ? new RegExp(`\\b${escapeRegExp(local)}\\s*(?:\\.\\s*|\\[\\s*["'])(?<api>${apiPattern})(?:["']\\s*\\])?\\s*\\(`, "g")
    : new RegExp(`\\b${escapeRegExp(local)}\\s*(?:\\.\\s*|\\[\\s*["'])(?<api>${apiPattern})(?:["']\\s*\\])?\\s*\\(`, "g");
  for (const match of source.matchAll(propertyPattern)) {
    apis.add(match.groups.api);
    lines.push(lineNumber(source, match.index));
  }
  if (!promisesModule) {
    const promisesPattern = new RegExp(`\\b${escapeRegExp(local)}\\s*\\.\\s*promises\\s*\\.\\s*(?<api>${apiPattern})\\s*\\(`, "g");
    for (const match of source.matchAll(promisesPattern)) {
      apis.add(match.groups.api);
      lines.push(lineNumber(source, match.index));
    }
  }
}

function collectDirectRequireApis(tokens, module, apis, lines, source) {
  for (let index = 0; index < tokens.length; index += 1) {
    const parsedRequire = parseCommonJSRequire(tokens, index);
    if (!parsedRequire || parsedRequire.module !== module) continue;
    let apiIndex = parsedRequire.endIndex + 1;
    if ((module === "node:fs" || module === "fs") && tokens[apiIndex]?.value === "." && tokens[apiIndex + 1]?.value === "promises") {
      apiIndex += 2;
    }
    if (tokens[apiIndex]?.value !== ".") continue;
    const api = tokens[apiIndex + 1];
    if (api?.kind === "identifier" && destructiveFilesystemApis.has(api.value) && tokens[apiIndex + 2]?.value === "(") {
      apis.add(api.value);
      lines.push(lineNumber(source, tokens[index].start));
    }
  }
}

function patchEvidenceFor(source, imports, tokens) {
  const reasons = [];
  if (/\bglobal(?:This)?\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=\s*(?!=)/.test(source)) reasons.push("global-assignment");
  if (/\b[A-Za-z_$][\w$]*\s*\.\s*prototype\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=\s*(?!=)/.test(source)) reasons.push("prototype-assignment");
  const aliases = new Set();
  for (const entry of imports.filter((candidate) => candidate.runtime && monitoredModulePattern.test(candidate.module))) {
    for (const binding of entry.bindings) {
      if (binding.typeOnly) continue;
      if (binding.type === "namespace" || (binding.type === "named" && binding.imported === "promises")) aliases.add(binding.local);
    }
  }
  for (const alias of aliases) {
    const target = escapeRegExp(alias);
    const assignment = new RegExp(`\\b${target}\\s*(?:\\.\\s*[A-Za-z_$][\\w$]*|\\[[^\\]]+\\])+\\s*=\\s*(?!=)`);
    if (assignment.test(source)) reasons.push("built-in-assignment");
    const define = new RegExp(`(?:Object|Reflect)\\.definePropert(?:y|ies)\\s*\\(\\s*${target}(?:\\s*\\.\\s*prototype)?\\b`);
    if (define.test(source)) reasons.push("built-in-define-property");
    const assign = new RegExp(`Object\\.assign\\s*\\(\\s*${target}(?:\\s*\\.\\s*prototype)?\\b`);
    if (assign.test(source)) reasons.push("built-in-object-assign");
  }
  reasons.push(...directRequirePatchEvidence(tokens));
  return reasons;
}

function directRequirePatchEvidence(tokens) {
  const reasons = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const target = parseStaticRequireMember(tokens, index);
    if (!target || !monitoredModulePattern.test(target.module)) continue;
    if (target.members.length > 0 && tokens[target.endIndex + 1]?.value === "=") {
      reasons.push("built-in-assignment");
    }
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const objectName = tokens[index]?.value;
    const method = tokens[index + 2]?.value;
    if (!["Object", "Reflect"].includes(objectName) || tokens[index + 1]?.value !== ".") continue;
    if (!["defineProperty", "defineProperties", "assign"].includes(method) || tokens[index + 3]?.value !== "(") continue;
    const target = parseStaticRequireMember(tokens, index + 4);
    if (!target || !monitoredModulePattern.test(target.module) || tokens[target.endIndex + 1]?.value !== ",") continue;
    reasons.push(method === "assign" ? "built-in-object-assign" : "built-in-define-property");
  }
  return reasons;
}

function analyzeTest(path, source) {
  const readsProductionSource = /\b(?:readFileSync|readFile|readFileText|contentsOfFile)\s*\(/.test(source)
    && /(?:\.\.\/)+(?:mac-helper|Companion|Sources)\/|(?:mac-helper|Companion|Sources)\/[^"'`\s]+\.(?:js|mjs|cjs|ts|mts|cts|swift|m)$/.test(source);
  if (!readsProductionSource) return null;
  const assertionPattern = /assert\.(?:match|doesNotMatch|ok|equal|strictEqual|deepEqual|notEqual)|\.(?:includes|indexOf)\s*\(/;
  return {
    path,
    line: lineNumber(source, source.search(/\b(?:readFileSync|readFile|readFileText|contentsOfFile)\s*\(/)),
    assertions: assertionPattern.test(source) ? ["implementation-text-or-layout"] : ["production-source-read"],
  };
}

function packageEntrypointsFor(root, trackedFiles, read) {
  if (!trackedFiles.includes("package.json")) return [];
  const packageJSON = JSON.parse(read("package.json"));
  const entries = [];
  for (const [name, target] of Object.entries(packageJSON.bin || {})) entries.push({ kind: "bin", name, path: target, exists: trackedFiles.includes(normalizePackagePath(target)) });
  if (typeof packageJSON.main === "string") entries.push({ kind: "main", name: "main", path: packageJSON.main, exists: trackedFiles.includes(normalizePackagePath(packageJSON.main)) });
  for (const [name, target] of Object.entries(packageJSON.exports || {})) {
    if (typeof target === "string") entries.push({ kind: "exports", name, path: target, exists: trackedFiles.includes(normalizePackagePath(target)) });
  }
  return entries;
}

function workflowBadgesFor(root, files, read) {
  const workflowFiles = new Set(files.filter((file) => file.startsWith(".github/workflows/") && /\.ya?ml$/.test(file)).map((file) => basename(file)));
  const entries = [];
  const badgePattern = /https:\/\/github\.com\/([^/]+)\/([^/]+)\/actions\/workflows\/([^/?"']+)(?:\/badge\.svg)?/g;
  for (const file of files.filter((candidate) => markdownPattern.test(candidate))) {
    const source = read(file);
    for (const match of source.matchAll(badgePattern)) {
      entries.push({
        path: file,
        line: lineNumber(source, match.index),
        repository: `${match[1]}/${match[2]}`,
        workflow: match[3],
        exists: workflowFiles.has(match[3]),
      });
    }
  }
  return entries;
}

function normalizeTrackedFiles(root, trackedFiles) {
  if (trackedFiles) return [...new Set(trackedFiles.map((file) => file.split(sep).join("/")).filter(Boolean))].sort();
  const result = spawnSync("git", ["-C", root, "ls-files", "-z"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ls-files failed: ${result.stderr || result.stdout}`);
  return String(result.stdout).split("\0").filter(Boolean).sort();
}

export function resolveBaseCommit(root, baselineCommit, options = {}) {
  const headCommit = options.headCommit || gitOutput(root, ["rev-parse", "HEAD"]).trim();
  assertCommitExists(root, headCommit);
  const eventPath = options.eventPath || process.env.GITHUB_EVENT_PATH;
  if (eventPath) {
    const eventBase = resolveEventBase(root, eventPath, headCommit, options.eventName || process.env.GITHUB_EVENT_NAME);
    if (eventBase) return eventBase;
  }
  for (const candidate of ["refs/remotes/origin/main", "refs/heads/main", "main"]) {
    const result = spawnSync("git", ["-C", root, "merge-base", headCommit, candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) {
      const base = result.stdout.trim();
      return base === headCommit ? parentCommit(root, headCommit) : validateRelevantBase(root, base, headCommit, "local merge-base");
    }
  }
  return validateRelevantBase(root, baselineCommit, headCommit, "declared baseline fallback");
}

function resolveEventBase(root, eventPath, headCommit, eventName) {
  let event;
  try {
    event = JSON.parse(readFileSync(eventPath, "utf8"));
  } catch (error) {
    throw new Error(`GITHUB_EVENT_PATH could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!event || typeof event !== "object" || Array.isArray(event)) {
    throw new Error("GITHUB_EVENT_PATH must contain a JSON object");
  }
  const pullRequestEvent = eventName === "pull_request" || event.pull_request !== undefined;
  const pushEvent = eventName === "push" || Object.prototype.hasOwnProperty.call(event, "before");
  if (pullRequestEvent) {
    const base = event.pull_request?.base?.sha;
    if (!base) throw new Error("pull_request event metadata is missing pull_request.base.sha");
    return validateRelevantBase(root, base, headCommit, "pull_request.base.sha");
  }
  if (pushEvent) {
    const base = event.before;
    if (!base) throw new Error("push event metadata is missing before");
    return validateRelevantBase(root, base, headCommit, "push.before", { requireAncestor: true });
  }
  return null;
}

function validateRelevantBase(root, base, headCommit, source, options = {}) {
  if (!/^[0-9a-f]{40}$/.test(base || "") || /^0+$/.test(base)) {
    throw new Error(`${source} must be a non-zero full 40-character commit SHA`);
  }
  assertCommitExists(root, base);
  if (base === headCommit) throw new Error(`${source} must not equal the checked HEAD`);
  if (options.requireAncestor && !isAncestor(root, base, headCommit)) {
    throw new Error(`${source} is not an ancestor of the checked HEAD`);
  }
  const mergeBase = spawnSync("git", ["-C", root, "merge-base", base, headCommit], { encoding: "utf8" });
  if (mergeBase.status !== 0 || !mergeBase.stdout.trim()) {
    throw new Error(`${source} is unrelated to the checked HEAD`);
  }
  return base;
}

function isAncestor(root, ancestor, descendant) {
  return spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", ancestor, descendant], { encoding: "utf8" }).status === 0;
}

function parentCommit(root, commit) {
  const result = spawnSync("git", ["-C", root, "rev-parse", `${commit}^1`], { encoding: "utf8" });
  if (result.status !== 0 || !result.stdout.trim()) throw new Error(`checked HEAD has no parent for local history comparison: ${commit}`);
  return validateRelevantBase(root, result.stdout.trim(), commit, "local parent", { requireAncestor: true });
}

function readPolicyAtCommit(root, commit) {
  const result = spawnSync("git", ["-C", root, "show", `${commit}:${policyRepositoryPath}`], { encoding: "utf8" });
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

function assertCommitExists(root, commit) {
  if (!/^[0-9a-f]{40}$/.test(commit || "")) throw new Error("baselineCommit must be a full 40-character commit SHA");
  const result = spawnSync("git", ["-C", root, "cat-file", "-e", `${commit}^{commit}`], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`baselineCommit does not resolve to a commit: ${commit}`);
}

function gitOutput(root, args) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function canonicalModule(module) {
  return module === "child_process" ? "node:child_process" : module;
}

function isDeclaredProductionPath(file) {
  return productionJavaScriptPattern.test(file)
    || productionTypeScriptPattern.test(file)
    || unsupportedNodeTypeScriptPattern.test(file)
    || productionSwiftPattern.test(file);
}

function isExcluded(file) {
  if (isDeclaredProductionPath(file)) return false;
  return excludedRootPatterns.some((pattern) => pattern.test(file));
}

function languageFor(file) {
  const extension = extname(file);
  if (extension === ".swift") return "swift";
  if ([".ts", ".mts", ".cts", ".tsx"].includes(extension)) return "typescript";
  return "javascript";
}

function lineCount(source) {
  if (source.length === 0) return 0;
  return source.endsWith("\n") ? source.split("\n").length - 1 : source.split("\n").length;
}

function lineNumber(source, offset) {
  return source.slice(0, Math.max(0, offset || 0)).split("\n").length;
}

function countByPath(entries) {
  return entries.reduce((counts, entry) => {
    counts[entry.path] = (counts[entry.path] || 0) + 1;
    return counts;
  }, {});
}

function compareEvidence(a, b) {
  return a.path.localeCompare(b.path) || (a.line || 0) - (b.line || 0) || JSON.stringify(a).localeCompare(JSON.stringify(b));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePackagePath(value) {
  return value.replace(/^\.\//, "");
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
