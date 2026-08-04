#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "../..");
const policyPath = join(scriptDirectory, "baseline-policy.json");
const MAX_PRODUCTION_LINES_WITHOUT_ADR = 800;
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
const productionTypeScriptPattern = /^(?:mac-helper\/(?:src|bin)\/).+\.ts$/;
const productionSwiftPattern = /^(?:Companion\/SwiftSimCompanion|Sources)\/.+\.swift$/;
const testPattern = /^(?:test|benchmarks\/test|Companion\/SwiftSimCompanionTests)\/.+/;
const architectureInventoryTestPath = "test/architectureInventory.test.js";
const markdownPattern = /(?:^|\/)README\.md$|\.md$/;
const preloadRuntimeNamePattern = /(?:preload|runtimeboundary|hardenedruntime|childruntime|fetchboundary|artifactcleanupboundary|devicebuildcapabilityboundary|helperhttpboundary)/i;
const importPattern = /\bimport\s+(?:(?<clause>[\s\S]*?)\s+from\s+)?["'](?<module>node:child_process|node:fs|fs)["']/g;
const sideEffectImportPattern = /\bimport\s+["'](?<module>node:child_process|node:fs|fs)["']/g;
const requirePattern = /\brequire\s*\(\s*["'](?<module>node:child_process|node:fs|fs)["']\s*\)/g;

const pathRules = {
  productionJavaScript: "mac-helper/src/**/*.js and mac-helper/bin/**/*.js; tracked only",
  productionTypeScript: "mac-helper/src/**/*.ts and mac-helper/bin/**/*.ts; tracked only",
  productionSwift: "Companion/SwiftSimCompanion/**/*.swift and Sources/**/*.swift; tracked only",
  tests: "test/**, benchmarks/test/**, and Companion/SwiftSimCompanionTests/**; tracked only; architectureInventory.test.js excluded from source-text metric because it contains intentional scanner fixtures",
  documentation: "tracked Markdown files outside excluded directories",
  excluded: "generated output, dependencies, .git, build products, benchmark results, and fixture directories",
  importScanner: "static ESM import declarations and CommonJS require calls; dynamic imports and computed requires are not classified",
};

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = process.argv[2];
  if (command === "--json") {
    console.log(JSON.stringify(collectInventory(repositoryRoot), null, 2));
  } else if (command === "--check") {
    const result = checkInventory(collectInventory(repositoryRoot), JSON.parse(readFileSync(policyPath, "utf8")));
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
  const productionSwiftFiles = sourceFiles.filter((file) => productionSwiftPattern.test(file));
  const productionSourceFiles = [...productionJavaScriptFiles, ...productionTypeScriptFiles, ...productionSwiftFiles].sort();
  const contents = new Map();
  const read = (file) => {
    if (!contents.has(file)) contents.set(file, readFileSync(join(root, file), "utf8"));
    return contents.get(file);
  };

  const productionFileDetails = productionSourceFiles.map((file) => ({
    path: file,
    language: languageFor(file),
    lines: lineCount(read(file)),
  }));
  const productionJavaScriptDetails = productionJavaScriptFiles.map((file) => analyzeJavaScriptModule(file, read(file)));
  const allProductionJavaScript = productionJavaScriptDetails.map((detail) => detail.path);
  const preloadRuntimePatchModules = productionJavaScriptDetails
    .filter((detail) => detail.preloadRuntimeReasons.length > 0)
    .map((detail) => ({ path: detail.path, reasons: detail.preloadRuntimeReasons }));
  const childProcessImports = productionJavaScriptDetails.flatMap((detail) => detail.childProcessImports);
  const destructiveFilesystemImports = productionJavaScriptDetails.flatMap((detail) => detail.destructiveFilesystemImports);
  const directGlobalFetchUses = productionJavaScriptDetails.flatMap((detail) => detail.directGlobalFetchUses);
  const writableJSONDomainStateStores = productionJavaScriptDetails.flatMap((detail) => detail.writableJSONDomainStateStores);
  const sourceTextImplementationTests = sourceFiles
    .filter((file) => testPattern.test(file) && file !== architectureInventoryTestPath && /\.(?:js|mjs|cjs|swift)$/.test(file))
    .map((file) => analyzeTest(file, read(file)))
    .filter(Boolean);
  const packageEntrypoints = packageEntrypointsFor(root, trackedFiles, read);
  const workflowBadgeTargets = workflowBadgesFor(root, sourceFiles, read);

  return {
    schemaVersion: 1,
    pathRules,
    productionFileCounts: {
      javascript: productionJavaScriptFiles.length,
      typescript: productionTypeScriptFiles.length,
      swift: productionSwiftFiles.length,
      total: productionSourceFiles.length,
    },
    productionFiles: productionFileDetails.sort((a, b) => a.path.localeCompare(b.path)),
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
      productionJavaScriptFiles: allProductionJavaScript.length,
    },
  };
}

export function checkInventory(inventory, policy) {
  const violations = [];
  const baselineModules = new Set(policy.preloadRuntimePatchModules || []);
  const allowedModules = new Set(policy.allowlists?.preloadRuntimePatchModules || []);
  for (const module of inventory.preloadRuntimePatchModules) {
    if (!baselineModules.has(module.path) && !allowedModules.has(module.path)) {
      violations.push(`new preload/runtime patch module ${module.path}`);
    }
  }

  compareImporterCounts(
    violations,
    "child-process importer",
    inventory.childProcessImports,
    policy.childProcessImporters || {},
    policy.allowlists?.childProcessImporters || {},
  );
  compareImporterCounts(
    violations,
    "destructive filesystem importer",
    inventory.destructiveFilesystemImports,
    policy.destructiveFilesystemImporters || {},
    policy.allowlists?.destructiveFilesystemImporters || {},
  );
  compareImporterCounts(
    violations,
    "source-text implementation test",
    inventory.sourceTextImplementationTests,
    policy.sourceTextImplementationTests || {},
    policy.allowlists?.sourceTextImplementationTests || {},
  );

  const baselineOversized = new Set(policy.oversizedProductionFiles || []);
  const allowedOversized = new Set(Object.keys(policy.allowlists?.oversizedProductionFiles || {}));
  for (const file of inventory.productionFiles.filter((entry) => entry.lines > MAX_PRODUCTION_LINES_WITHOUT_ADR)) {
    if (!baselineOversized.has(file.path) && !allowedOversized.has(file.path)) {
      violations.push(`new production file exceeds ${MAX_PRODUCTION_LINES_WITHOUT_ADR} lines without an ADR allowlist entry: ${file.path}`);
    }
  }

  for (const badge of inventory.workflowBadgeTargets.filter((entry) => !entry.exists)) {
    violations.push(`stale workflow badge target ${badge.path}:${badge.line} -> ${badge.workflow}`);
  }

  return { inventory, violations };
}

function compareImporterCounts(violations, label, entries, baselineCounts, allowlist) {
  const currentCounts = countByPath(entries);
  for (const [path, count] of Object.entries(currentCounts)) {
    const baseline = Number(baselineCounts[path] || 0);
    const allowed = Number(allowlist[path] || 0);
    if (count > baseline + allowed) violations.push(`new ${label} call site(s) in ${path}: baseline ${baseline}, current ${count}`);
  }
}

function analyzeJavaScriptModule(path, source) {
  const imports = scanImports(path, source);
  const childProcessImports = imports.filter((entry) => entry.module === "node:child_process").map((entry) => ({
    path, line: entry.line, kind: entry.kind, bindings: entry.bindings,
  }));
  const destructiveFilesystemImports = imports
    .filter((entry) => entry.module === "node:fs" || entry.module === "fs")
    .flatMap((entry) => destructiveApisForImport(path, source, entry));
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
  const writesJSON = /\b(?:appendFile|appendFileSync|rename|renameSync|writeFile|writeFileSync)\s*\(/.test(source) && source.includes("JSON.stringify");
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
  const patchEvidence = [
    [/\bglobal(?:This)?\.[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?function/, "global-assignment"],
    [/\b[A-Za-z_$][\w$]*\.prototype\.[A-Za-z_$][\w$]*\s*=\s*/, "prototype-assignment"],
    [/\b(?:fs|childProcess)\.[A-Za-z_$][\w$]*\s*=\s*(?:async\s+)?function/, "built-in-assignment"],
  ].filter(([pattern]) => pattern.test(source));
  if (patchEvidence.length > 0) preloadRuntimeReasons.push(...patchEvidence.map(([, reason]) => reason));
  return {
    path,
    childProcessImports,
    destructiveFilesystemImports,
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
  const namespace = prefix.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
  return namespace ? [{ type: "namespace", local: namespace[1] }] : [];
}

function destructiveApisForImport(path, source, entry) {
  const results = [];
  for (const binding of entry.bindings) {
    if (binding.type === "named" && destructiveFilesystemApis.has(binding.imported)) {
      results.push({ path, line: entry.line, kind: entry.kind, module: entry.module, api: binding.imported });
    }
    if (binding.type === "namespace") {
      const expression = new RegExp(`\\b${escapeRegExp(binding.local)}\\s*\\.\\s*(${[...destructiveFilesystemApis].join("|")})\\s*\\(`, "g");
      for (const match of source.matchAll(expression)) {
        results.push({ path, line: lineNumber(source, match.index), kind: entry.kind, module: entry.module, api: match[1] });
      }
    }
  }
  if (entry.bindings.length === 0) {
    const direct = new RegExp(`${escapeRegExp(entry.module)}["'\\s)]*\\.\\s*(${[...destructiveFilesystemApis].join("|")})\\s*\\(`, "g");
    for (const match of source.matchAll(direct)) results.push({ path, line: lineNumber(source, match.index), kind: entry.kind, module: entry.module, api: match[1] });
  }
  return results;
}

function analyzeTest(path, source) {
  const readsProductionSource = /\b(?:readFileSync|readFile|readFileText|contentsOfFile)\s*\(/.test(source)
    && /(?:\.\.\/)+(?:mac-helper|Companion|Sources)\/|(?:mac-helper|Companion|Sources)\/[^"'`\s]+\.(?:js|swift|m)$/.test(source);
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

function isExcluded(file) {
  return file.split("/").some((segment) => excludedDirectories.has(segment)) || file.startsWith("benchmarks/results/");
}

function languageFor(file) {
  const extension = extname(file);
  if (extension === ".swift") return "swift";
  if (extension === ".ts") return "typescript";
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
