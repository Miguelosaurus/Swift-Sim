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
const excludedDirectories = new Set([
  ".build", ".git", "DerivedData", "build", "dist", "node_modules", "coverage", "fixtures",
  "__fixtures__", "results",
]);
const productionJavaScriptPattern = /^(?:mac-helper\/(?:src|bin)\/).+\.(?:js|mjs|cjs)$/;
const productionTypeScriptPattern = /^(?:mac-helper\/(?:src|bin)\/).+\.(?:ts|mts|cts)$/;
const unsupportedNodeTypeScriptPattern = /^(?:mac-helper\/(?:src|bin)\/)\S+\.tsx$/;
const productionSwiftPattern = /^(?:Companion\/SwiftSimCompanion|Sources)\/.+\.swift$/;
const testPattern = /^(?:test|benchmarks\/test|Companion\/SwiftSimCompanionTests)\/.+/;
const sourceTextTestExtensionPattern = /\.(?:js|mjs|cjs|ts|mts|cts|tsx|swift)$/;
const markdownPattern = /(?:^|\/)README\.md$|\.md$/;
const preloadRuntimeNamePattern = /(?:preload|runtimeboundary|hardenedruntime|childruntime|fetchboundary|artifactcleanupboundary|devicebuildcapabilityboundary|helperhttpboundary)/i;
const monitoredModulePattern = /^(?:node:)?(?:child_process|fs|fs\/promises)$/;
const importPattern = /\bimport\s+(?:(?<clause>[\s\S]*?)\s+from\s+)?["'](?<module>node:child_process|node:fs\/promises|fs\/promises|node:fs|fs)["']/g;
const sideEffectImportPattern = /\bimport\s+["'](?<module>node:child_process|node:fs\/promises|fs\/promises|node:fs|fs)["']/g;
const requirePattern = /\brequire\s*\(\s*["'](?<module>node:child_process|node:fs\/promises|fs\/promises|node:fs|fs)["']\s*\)/g;
const importEqualsPattern = /\bimport\s+(?<local>[A-Za-z_$][\w$]*)\s*=\s*require\s*\(\s*["'](?<module>node:child_process|node:fs\/promises|fs\/promises|node:fs|fs)["']\s*\)/g;

const pathRules = {
  productionJavaScript: "mac-helper/src/**/*.js and mac-helper/bin/**/*.js; tracked only",
  productionTypeScript: "mac-helper/src/**/*.ts, *.mts, and *.cts; tracked only",
  unsupportedNodeTypeScript: "mac-helper/src/**/*.tsx and mac-helper/bin/**/*.tsx are explicitly prohibited",
  productionSwift: "Companion/SwiftSimCompanion/**/*.swift and Sources/**/*.swift; tracked only",
  tests: "test/**, benchmarks/test/**, and Companion/SwiftSimCompanionTests/**; tracked only",
  documentation: "tracked Markdown files outside excluded directories",
  excluded: "generated output, dependencies, .git, build products, benchmark results, and fixture directories",
  importScanner: "static ESM imports, TypeScript import-equals, and CommonJS require calls; dynamic imports and computed requires are not classified",
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
  const unsupportedNodeFiles = sourceFiles.filter((file) => unsupportedNodeTypeScriptPattern.test(file));
  const productionSwiftFiles = sourceFiles.filter((file) => productionSwiftPattern.test(file));
  const productionNodeFiles = [...productionJavaScriptFiles, ...productionTypeScriptFiles].sort();
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
      swift: productionSwiftFiles.length,
      total: productionSourceFiles.length,
    },
    productionFiles: productionFileDetails.sort((a, b) => a.path.localeCompare(b.path)),
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
      history = createHistoryContext(options.root, normalized.policy);
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

function createHistoryContext(root, policy) {
  const baselineCommit = policy.baselineCommit;
  const baseCommit = resolveBaseCommit(root, baselineCommit);
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
  const imports = scanImports(path, source);
  const childProcessEntries = imports.filter((entry) => entry.module === "node:child_process");
  const childProcessImporter = childProcessEntries.length > 0 ? {
    path,
    line: Math.min(...childProcessEntries.map((entry) => entry.line)),
    kind: "importer-capability",
    modules: [...new Set(childProcessEntries.map((entry) => entry.module))].sort(),
  } : null;
  const destructiveFilesystemImporter = destructiveApisForImports(path, source, imports);
  const directGlobalFetchUses = [];
  for (const match of source.matchAll(/(?<![\w.$])fetch\s*\(/g)) {
    directGlobalFetchUses.push({ path, line: lineNumber(source, match.index), kind: "global-fetch-call" });
  }
  for (const match of source.matchAll(/\bglobal(?:This)?\.fetch\b/g)) {
    directGlobalFetchUses.push({ path, line: lineNumber(source, match.index), kind: match[0] });
  }
  const jsonPathLiterals = [...source.matchAll(/["'`]([^"'`]*\.json)["'`]/g)]
    .map((match) => match[1])
    .filter((value) => !value.endsWith("package.json"))
    .sort();
  const writesJSON = destructiveFilesystemImporter && source.includes("JSON.stringify");
  const writableJSONDomainStateStores = writesJSON
    ? [...new Set(jsonPathLiterals)].map((storePath) => ({ path, line: lineNumber(source, source.indexOf(storePath)), storePath, owner: path }))
    : [];
  const preloadRuntimeReasons = [];
  if (preloadRuntimeNamePattern.test(basename(path))) preloadRuntimeReasons.push("module-name");
  const localImports = [
    ...source.matchAll(/\bimport\s+["'](?<module>\.{1,2}\/[^"']+)["']/g),
    ...source.matchAll(/\bimport\s+[\s\S]*?\s+from\s+["'](?<module>\.{1,2}\/[^"']+)["']/g),
    ...source.matchAll(/\bimport\s*\(\s*["'](?<module>\.{1,2}\/[^"']+)["']\s*\)/g),
  ];
  if (localImports.some((entry) => preloadRuntimeNamePattern.test(basename(entry.groups.module)))) preloadRuntimeReasons.push("imports-preload-or-runtime-boundary");
  const patchEvidence = patchEvidenceFor(source, imports);
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

function scanImports(path, source) {
  const imports = [];
  for (const match of source.matchAll(importPattern)) {
    imports.push({
      path,
      line: lineNumber(source, match.index),
      kind: "esm",
      module: match.groups.module,
      bindings: parseESMBindings(match.groups.clause || ""),
    });
  }
  for (const match of source.matchAll(sideEffectImportPattern)) {
    if (imports.some((entry) => entry.line === lineNumber(source, match.index) && entry.module === match.groups.module)) continue;
    imports.push({ path, line: lineNumber(source, match.index), kind: "esm-side-effect", module: match.groups.module, bindings: [] });
  }
  for (const match of source.matchAll(importEqualsPattern)) {
    imports.push({
      path,
      line: lineNumber(source, match.index),
      kind: "typescript-import-equals",
      module: match.groups.module,
      bindings: [{ type: "namespace", local: match.groups.local }],
    });
  }
  for (const match of source.matchAll(requirePattern)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    const lineEnd = source.indexOf("\n", match.index);
    const statement = source.slice(lineStart, lineEnd === -1 ? source.length : lineEnd);
    imports.push({
      path,
      line: lineNumber(source, match.index),
      kind: "commonjs-require",
      module: match.groups.module,
      bindings: parseRequireBindings(statement, match[0]),
    });
  }
  return imports.sort((a, b) => a.line - b.line || a.module.localeCompare(b.module));
}

function parseESMBindings(clause) {
  const bindings = [];
  const trimmed = clause.trim();
  if (!trimmed) return bindings;
  const namespace = trimmed.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/);
  if (namespace) bindings.push({ type: "namespace", local: namespace[1] });
  const named = trimmed.match(/\{([\s\S]*)\}/);
  if (named) {
    for (const item of named[1].split(",")) {
      const [imported, local] = item.trim().split(/\s+as\s+/);
      if (imported) bindings.push({ type: "named", imported: imported.trim(), local: (local || imported).trim() });
    }
  }
  const defaultBinding = trimmed.split(",")[0].trim();
  if (defaultBinding && /^[A-Za-z_$][\w$]*$/.test(defaultBinding)) bindings.push({ type: "namespace", local: defaultBinding });
  return bindings;
}

function parseRequireBindings(statement, requireExpression) {
  const prefix = statement.slice(0, Math.max(0, statement.indexOf(requireExpression))).trim();
  const destructured = prefix.match(/(?:const|let|var)\s*\{([^}]+)\}\s*=\s*$/);
  if (destructured) {
    return destructured[1].split(",").map((item) => {
      const [imported, local] = item.trim().split(/\s*:\s*/);
      return { type: "named", imported: imported.trim(), local: (local || imported).trim() };
    }).filter((entry) => entry.imported);
  }
  const namespace = prefix.match(/(?:const|let|var|import)\s+([A-Za-z_$][\w$]*)\s*(?:=\s*)?$/);
  return namespace ? [{ type: "namespace", local: namespace[1] }] : [];
}

function destructiveApisForImports(path, source, imports) {
  const apis = new Set();
  const lines = [];
  const modules = new Set();
  for (const entry of imports.filter((candidate) => candidate.module === "node:fs" || candidate.module === "fs" || candidate.module === "node:fs/promises" || candidate.module === "fs/promises")) {
    const promisesModule = entry.module.endsWith("/promises");
    modules.add(entry.module);
    for (const binding of entry.bindings) {
      if (binding.type === "named" && destructiveFilesystemApis.has(binding.imported)) {
        apis.add(binding.imported);
        lines.push(entry.line);
      }
      if (binding.type === "named" && binding.imported === "promises") {
        collectNamespaceApis(source, binding.local, apis, lines, true);
      }
      if (binding.type === "namespace") {
        collectNamespaceApis(source, binding.local, apis, lines, promisesModule);
      }
    }
    if (entry.bindings.length === 0) {
      collectDirectRequireApis(source, entry.module, apis, lines);
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

function collectDirectRequireApis(source, module, apis, lines) {
  const apiPattern = [...destructiveFilesystemApis].map(escapeRegExp).join("|");
  const directPattern = new RegExp(`require\\s*\\(\\s*["']${escapeRegExp(module)}["']\\s*\\)\\s*(?:\\.\\s*promises\\s*\\.\\s*)?(?<api>${apiPattern})\\s*\\(`, "g");
  for (const match of source.matchAll(directPattern)) {
    apis.add(match.groups.api);
    lines.push(lineNumber(source, match.index));
  }
}

function patchEvidenceFor(source, imports) {
  const reasons = [];
  if (/\bglobal(?:This)?\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=\s*(?!=)/.test(source)) reasons.push("global-assignment");
  if (/\b[A-Za-z_$][\w$]*\s*\.\s*prototype\s*(?:\.\s*[A-Za-z_$][\w$]*|\[[^\]]+\])\s*=\s*(?!=)/.test(source)) reasons.push("prototype-assignment");
  const aliases = new Set();
  for (const entry of imports.filter((candidate) => monitoredModulePattern.test(candidate.module))) {
    for (const binding of entry.bindings) {
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

function resolveBaseCommit(root, baselineCommit) {
  for (const candidate of ["refs/remotes/origin/main", "refs/heads/main", "main"]) {
    const result = spawnSync("git", ["-C", root, "merge-base", "HEAD", candidate], { encoding: "utf8" });
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim();
  }
  return baselineCommit;
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

function isExcluded(file) {
  return file.split("/").some((segment) => excludedDirectories.has(segment)) || file.startsWith("benchmarks/results/");
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
