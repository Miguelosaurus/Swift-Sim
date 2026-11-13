import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validStateNames } from "./liveStatefulOrigins.js";
import { normalizeReplacementProof, replacementCoverageDigest } from "./replacementProof.js";
import { NodeAtomicFileStore, ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";
import { NodeArtifactStore } from "./infrastructure/nodeArtifactStore.js";

const SOURCE = fileURLToPath(new URL("../resources/FullCallableGenerator.swift", import.meta.url));
const INPUT_LIMIT = 8 * 1024 * 1024;
const OUTPUT_LIMIT = 12 * 1024 * 1024;
const VERSION = "full-callable-v1";

// Process execution is an explicit infrastructure port; this module neither
// creates a helper/engine nor loads a generated library.
export function createFullCallableCompiler({ runner, cacheRoot, resourcePath = SOURCE, files = new NodeAtomicFileStore(), artifacts = new NodeArtifactStore() } = {}) {
  if (typeof runner?.runSync !== "function" || !isAbsolute(cacheRoot || "")) throw new TypeError("An explicit command runner and absolute compiler cache are required.");
  function run(executable, args, { input, timeoutMs = 30_000 } = {}) {
    const result = runner.runSync({ executable, args,
      environment: { inherit: ["PATH", "HOME", "TMPDIR", "DEVELOPER_DIR"], overrides: {}, unset: ["SDKROOT"] },
      ...(input === undefined ? {} : { input: typeof input === "string" ? Buffer.from(input) : input }),
      policy: { timeoutMs, outputLimitBytes: OUTPUT_LIMIT, processGroup: "inherit", acceptedExitCodes: args[0] === "--full-callable-generator-v1" ? [0, 1] : [0] } });
    if (result?.code === 1 && !result.error && !result.timedOut && args[0] === "--full-callable-generator-v1"
      && typeof result.stderr === "string" && result.stderr.startsWith("full-callable generator rejected:")) throw unsupported();
    if (result?.code !== 0 || result.error || result.timedOut || typeof result.stdout !== "string" || Buffer.byteLength(result.stdout) > OUTPUT_LIMIT) {
      throw unsupported(result?.timedOut ? "FULL_CALLABLE_COMPILER_TIMEOUT" : "FULL_CALLABLE_COMPILER_UNAVAILABLE");
    }
    return result.stdout;
  }
  function executable() {
    const source = privateRegularFile(resourcePath, { ownerOnly: false, trustedResource: true, maxBytes: 256 * 1024 });
    const compiler = run("/usr/bin/xcrun", ["--find", "swiftc"]).trim();
    if (!isAbsolute(compiler) || !compiler.endsWith("/bin/swiftc") || /[\r\n\0]/.test(compiler)) throw unsupported();
    const compilerVersion = run(compiler, ["--version"]).trim();
    const hostSDK = run("/usr/bin/xcrun", ["--sdk", "macosx", "--show-sdk-path"]).trim();
    if (!isAbsolute(hostSDK) || /[\r\n\0]/.test(hostSDK)) throw unsupported();
    const compilerStats = lstatSync(compiler);
    if (!compilerStats.isFile() && !compilerStats.isSymbolicLink()) throw unsupported();
    const fingerprint = hash(JSON.stringify([VERSION, hash(source), compiler, compilerVersion, hostSDK,
      String(compilerStats.dev), String(compilerStats.ino), compilerStats.size, compilerStats.mtimeMs]));
    ensurePrivateDirectory(cacheRoot);
    const target = join(cacheRoot, fingerprint);
    ensurePrivateDirectory(target);
    const binary = join(target, "generator");
    const receipt = join(target, "generator.json");
    if (existsSync(binary) || existsSync(receipt)) {
      try {
        const bytes = privateRegularFile(binary);
        const metadata = JSON.parse(privateRegularFile(receipt, { maxBytes: 4096 }));
        if (metadata.fingerprint === fingerprint && metadata.sourceDigest === hash(source) && metadata.binaryDigest === hash(bytes)
          && (lstatSync(binary).mode & 0o100) !== 0) return binary;
      } catch { /* An invalid owned cache is not executable authority. */ }
      throw unsupported("FULL_CALLABLE_CACHE_INVALID");
    }
    const staged = join(target, `generator-${randomUUID()}`);
    const host = resolve(dirname(compiler), "../lib/swift/host");
    try {
      run(compiler, [resourcePath, "-sdk", hostSDK, "-I", host, "-L", host, "-module-cache-path", join(cacheRoot, "module-cache"), "-Xlinker", "-rpath", "-Xlinker", host, "-o", staged], { timeoutMs: 60_000 });
      const bytes = privateRegularFile(staged, { ownerOnly: false });
      // Concurrent publishers never overwrite an existing cache entry. The
      // compile itself is side-effect-free and admission uses the final digest.
      if (existsSync(binary) || existsSync(receipt)) throw unsupported("FULL_CALLABLE_CACHE_CONFLICT");
      artifacts.writeSync(artifacts.resolveContained(target, binary), bytes, { mode: 0o700, replace: false });
      files.writeJSONSync(receipt, { version: 1, fingerprint, sourceDigest: hash(source), binaryDigest: hash(bytes) },
        { mode: 0o600, createParentMode: 0o700, replace: false, syncDirectory: true });
      return binary;
    } finally { if (existsSync(staged) && !lstatSync(staged).isSymbolicLink()) artifacts.removeTreeSync(artifacts.resolveContained(target, staged)); }
  }
  function generate(input) {
    input = { ...input, generation: input?.generation || randomUUID().replaceAll("-", "") };
    validateInput(input);
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded) > INPUT_LIMIT) throw unsupported();
    let result;
    try { result = JSON.parse(run(executable(), ["--full-callable-generator-v1"], { input: encoded })); }
    catch (error) { if (/^(?:FULL_CALLABLE_|QUEUED_MECHANISM_UNSUPPORTED$)/.test(error?.code || "")) throw error; throw unsupported("FULL_CALLABLE_GENERATOR_INVALID"); }
    validateGeneration(result, input);
    result.resourceDigest = compilerResourceDigest(resourcePath);
    return result;
  }
  function instrument(input) {
    if (!Array.isArray(input?.files) || input.files.length > 2048 || input.files.some(file =>
      !isAbsolute(file.path || "") || typeof file.source !== "string")
      || new Set(input.files.map(file => file.path)).size !== input.files.length
      || (input.lowerConstants !== undefined && typeof input.lowerConstants !== "boolean")) throw unsupported();
    const encoded = JSON.stringify(input);
    if (Buffer.byteLength(encoded) > INPUT_LIMIT) throw unsupported();
    let result;
    try { result = JSON.parse(run(executable(), ["--instrument-stateful-v1"], { input: encoded })); }
    catch { throw unsupported("FULL_CALLABLE_INSTRUMENTATION_INVALID"); }
    if (result?.schemaVersion !== 1 || result.capability !== "stateful-overlay-v1" || !Array.isArray(result.files)
      || result.files.length > input.files.length || result.files.some(file => !input.files.some(value => value.path === file.path)
        || typeof file.source !== "string" || !Array.isArray(file.owners) || file.owners.length > 1024
        || file.owners.some(owner => typeof owner !== "string" || owner.length > 256)
        || (file.constants !== undefined && !validNameIndex({ [file.path]: file.constants })))) throw unsupported();
    return { ...result, resourceDigest: compilerResourceDigest(resourcePath) };
  }
  // One SwiftSyntax pass per edit set; the same structural rule as generate().
  function classify(files) {
    if (!Array.isArray(files) || !files.length || files.length > 64 || files.some(file => typeof file?.path !== "string"
      || typeof file.before !== "string" || typeof file.after !== "string"
      || Buffer.byteLength(file.before) > 1024 * 1024 || Buffer.byteLength(file.after) > 1024 * 1024)) throw unsupported();
    let result;
    try { result = JSON.parse(run(executable(), ["--classify-v1"], { input: JSON.stringify({ files }) })); }
    catch (error) { if (/^FULL_CALLABLE_/.test(error?.code || "")) throw error; throw unsupported("FULL_CALLABLE_GENERATOR_INVALID"); }
    const routes = ["hot-reload", "rebuild-required", "no-change"];
    if (result?.schemaVersion !== 1 || result.capability !== "classify-v1" || !Array.isArray(result.files) || result.files.length !== files.length
      || result.files.some(file => !routes.includes(file?.route) || !/^[A-Z][A-Z0-9_]{1,79}$/.test(file.reasonCode || "")
        || typeof file.reason !== "string" || file.reason.length > 200)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
    return result.files;
  }
  function inspectCoverage({ dylibPath, generation, moduleName }) {
    validateGeneration(generation);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(moduleName || "")) throw unsupported();
    const bytes = privateRegularFile(dylibPath, { ownerOnly: false, maxBytes: 64 * 1024 * 1024 });
    const symbols = run("/usr/bin/xcrun", ["nm", "-j", "-U", dylibPath]).trim().split(/\r?\n/).filter(Boolean);
    const groups = new Map();
    for (const symbol of symbols.filter(value => /(?:TI|TX)$/.test(value))) {
      const key = symbol.slice(0, -2); const value = groups.get(key) || new Set(); value.add(symbol.slice(-2)); groups.set(key, value);
    }
    if (groups.size > 512 || [...groups.values()].some(kinds => !kinds.has("TX"))) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
    const variables = [...groups.keys()].map(key => `${key}TX`);
    const demangled = variables.length ? run("/usr/bin/xcrun", ["swift-demangle", "--compact"], { input: variables.join("\n") + "\n" }).trim().split(/\r?\n/) : [];
    if (demangled.length !== variables.length || demangled.some(name => !name.startsWith("dynamically replaceable variable for "))) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
    const originalKeys = new Set(symbols.filter(value => value.endsWith("Tx")).map(value => value.slice(0, -2)));
    const originals = (generation.statefulComponents || []).flatMap(component => component.slots.flatMap(slot =>
      (slot.kind === "function" ? ["function"] : slot.accessors).map(accessor => ({ ...slot, owner: component.owner, accessor, seen: false }))));
    const replacementVariables = [];
    const members = generation.members.map(member => ({ ...member, swift: [], objc: [] }));
    for (let index = 0; index < demangled.length; index += 1) {
      const name = demangled[index];
      const normalized = name.replace(/\(([^ ]+) in _[A-Fa-f0-9]+\)/g, "$1");
      if (originalKeys.has(variables[index].slice(0, -2))) {
        const matches = originals.filter(slot => !slot.seen && normalized.startsWith(`dynamically replaceable variable for ${slot.isStatic ? "static " : ""}${moduleName}.${slot.owner}.`)
          && identifierIn(normalized, slot.member.split("(")[0])
          && (slot.accessor === "function" ? !/\.(?:getter|setter) :/.test(normalized) : normalized.includes(`.${slot.accessor} :`)));
        if (matches.length !== 1 || groups.get(variables[index].slice(0, -2)).has("TI")) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
        matches[0].seen = true;
        continue;
      }
      replacementVariables.push(variables[index]);
      const matches = members.filter(member => {
        const owner = member.owner.split(/\s+where\s+/)[0];
        const prefix = owner ? `dynamically replaceable variable for ${member.isStatic ? "static " : ""}(extension in ${moduleName}):${member.targetModule || generation.module}.${owner}.`
          : `dynamically replaceable variable for ${moduleName}.`;
        return normalized.startsWith(prefix) && identifierIn(normalized, member.replacementName);
      });
      if (matches.length !== 1) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
      const member = matches[0];
      const accessor = member.kind === "function" ? "function" : member.accessors.find(value => name.includes(`.${value} :`));
      if (!accessor || member.swift.some(item => item.accessor === accessor)) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
      member.swift.push({ symbol: variables[index], accessor });
    }
    if (originals.some(slot => !slot.seen)) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
    const loadCommands = run("/usr/bin/xcrun", ["otool", "-l", dylibPath]);
    rejectInitializers(loadCommands);
    const metadata = run("/usr/bin/xcrun", ["otool", "-ov", dylibPath]);
    const categories = parseObjCCategories(metadata, { selectorReferences: selectorReferences(loadCommands, metadata) });
    if (categoryCountFromLoadCommands(loadCommands) !== categories.length) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
    const callbacks = [];
    for (const category of categories) {
      const alias = /^__swiftSim_full_g[a-f0-9]{24,64}_f\d+_\d+(?::(?:[A-Za-z_$][A-Za-z0-9_$]*:)*)?$/;
      const replacements = category.methods.filter(method => alias.test(method.selector));
      const consumed = new Set();
      if (!replacements.length || category.methods.length !== replacements.length * 2
        || new Set(category.methods.map(method => method.selector)).size !== category.methods.length) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      for (const replacement of replacements) {
      const originals = category.methods.filter(method => !alias.test(method.selector) && method.encoding === replacement.encoding && method.imp === replacement.imp);
      if (originals.length !== 1 || consumed.has(originals[0].selector)) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      const original = originals[0]; consumed.add(original.selector);
      const replacementIdentifier = replacement.selector.match(/^(__swiftSim_full_g[a-f0-9]{24,64}_f\d+_\d+)(?::|$)/)?.[1];
      const matches = members.filter(member => member.kind === "function" && member.replacementName === replacementIdentifier);
      if (matches.length !== 1 || matches[0].swift.length || matches[0].objc.length) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
      const member = matches[0];
      const classDescription = run("/usr/bin/xcrun", ["swift-demangle", "--compact"], { input: category.classSymbol + "\n" }).trim();
      const owner = classDescription.replace(`type metadata for ${generation.module}.`, "").replace(/\(([^ ]+) in _[A-Fa-f0-9]+\)/g, "$1");
      if (category.classSymbol.startsWith("_OBJC_CLASS_$_")) {
        if (category.className !== category.classSymbol.slice("_OBJC_CLASS_$_".length) || category.className !== member.owner) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      } else {
        if (!classDescription.startsWith(`type metadata for ${generation.module}.`) || owner !== member.owner.split(/\s+where\s+/)[0] || !category.classSymbol.endsWith("CN")) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
        const runtimeName = run("/usr/bin/xcrun", ["swift-demangle", "--remangle-objc-rt"], { input: category.classSymbol.slice(0, -1) + "\n" }).trim();
        if (!runtimeName.startsWith("_TC") || category.className !== "_Tt" + runtimeName.slice(2)) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      }
      // Swift selector spelling can differ from the source labels. The compiler
      // category is authoritative only when its generated selector, exact class,
      // original ABI and shared IMP are all bound to this member/artifact.
      const callback = { class_name: category.className, selector: original.selector,
        replacement_selector: replacement.selector, type_encoding: original.encoding };
      member.objc.push(callback); callbacks.push(callback);
      }
    }
    for (const member of members) {
      const expected = member.kind === "function" ? ["function"] : member.accessors;
      if (member.objc.length === 1 && member.kind === "function") continue;
      if (member.objc.length || expected.length !== member.swift.length || !expected.every(kind => member.swift.some(item => item.accessor === kind))) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
    }
    const replacementProof = normalizeReplacementProof({ version: 3, swift_replacements: replacementVariables.length, objc_callbacks: callbacks });
    return { version: 1, artifactDigest: hash(bytes), replacementProof, coverageDigest: replacementProofDigest(replacementProof),
      changedMemberCount: members.length, members, swiftSymbols: replacementVariables };
  }
  return Object.freeze({ generate, instrument, classify, inspectCoverage });
}

export function replacementProofDigest(proof) { return replacementCoverageDigest(proof); }
export function compilerResourceDigest(resourcePath = SOURCE) { return hash(privateRegularFile(resourcePath, { ownerOnly: false, trustedResource: true, maxBytes: 256 * 1024 })); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function unsupported(code = "QUEUED_MECHANISM_UNSUPPORTED") { return Object.assign(new Error("The live compiler could not prove complete callable replacement coverage. No patch was admitted."), { code }); }
function privateRegularFile(path, { ownerOnly = true, trustedResource = false, maxBytes = OUTPUT_LIMIT } = {}) {
  const stats = lstatSync(path);
  const ownerAllowed = !process.getuid || stats.uid === process.getuid() || (trustedResource && stats.uid === 0 && !(stats.mode & 0o022));
  if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1 || stats.size > maxBytes || !ownerAllowed || (ownerOnly && (stats.mode & 0o077))) throw unsupported("FULL_CALLABLE_FILE_INVALID");
  return readFileSync(path);
}
function ensurePrivateDirectory(path) {
  if (!existsSync(path)) ensureDirectoryModeSync(path, 0o700);
  const stats = lstatSync(path);
  if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o077) || (process.getuid && stats.uid !== process.getuid())) throw unsupported("FULL_CALLABLE_CACHE_INVALID");
}
function validateInput(input) {
  if (!input || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(input.module || "") || !/^[a-f0-9]{24,64}$/.test(input.generation || "") || !Array.isArray(input.files) || !input.files.length || input.files.length > 32) throw unsupported();
  for (const file of input.files) if (typeof file.path !== "string" || typeof file.before !== "string" || typeof file.after !== "string" || Buffer.byteLength(file.before) > 1024 * 1024 || Buffer.byteLength(file.after) > 1024 * 1024) throw unsupported();
  if (input.allowAdditive !== undefined && typeof input.allowAdditive !== "boolean") throw unsupported();
  if (input.allowSharedAdditive !== undefined && (typeof input.allowSharedAdditive !== "boolean" || input.allowAdditive !== true)) throw unsupported();
  if (input.files.some(file => file.isNewFile !== undefined && (typeof file.isNewFile !== "boolean"
    || (file.isNewFile && (input.allowSharedAdditive !== true || (file.installedBaseline ?? file.before) !== ""))))) throw unsupported();
  if (input.moduleSources !== undefined && (input.allowSharedAdditive !== true || !Array.isArray(input.moduleSources)
    || !input.moduleSources.length || input.moduleSources.length > 2048 || new Set(input.moduleSources.map(file => file.path)).size !== input.moduleSources.length
    || input.moduleSources.some(file => !isAbsolute(file.path || "") || typeof file.source !== "string" || Buffer.byteLength(file.source) > 1024 * 1024))) throw unsupported();
  if (input.preserveViewFunctions !== undefined && typeof input.preserveViewFunctions !== "boolean") throw unsupported();
  if (input.allowAddedState !== undefined && (typeof input.allowAddedState !== "boolean" || input.allowAdditive !== true)) throw unsupported();
  if (input.allowAddedState === true && (!Number.isSafeInteger(input.stateGeneration) || input.stateGeneration < 1)) throw unsupported();
  if (input.stateGeneration !== undefined && (input.allowAddedState !== true || !Number.isSafeInteger(input.stateGeneration) || input.stateGeneration < 1)) throw unsupported();
  if (input.allowStatefulAdditive !== undefined && (typeof input.allowStatefulAdditive !== "boolean" || input.allowAdditive !== true)) throw unsupported();
  if (input.statefulOrigins !== undefined && (!Array.isArray(input.statefulOrigins) || input.statefulOrigins.length > 32
    || input.statefulOrigins.some(origin => !isAbsolute(origin?.path || "") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(origin.owner || "")
      || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(origin.module || "") || !/^Replacement(?:[0-9]|[12][0-9]|3[01])\.swift$/.test(origin.sourceFile || "")
      || !/^[a-f0-9]{64}$/.test(origin.layoutDigest || "")
      || (origin.stateNames !== undefined && !validStateNames(origin.stateNames))))) throw unsupported();
  if (input.availableModules !== undefined && (!Array.isArray(input.availableModules) || input.availableModules.length > 128
    || input.availableModules.some(name => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))) throw unsupported();
  if (input.files.some(file => file.installedBaseline !== undefined && (input.allowAdditive !== true
    || typeof file.installedBaseline !== "string" || Buffer.byteLength(file.installedBaseline) > 1024 * 1024))) throw unsupported();
  if (input.statefulBodies !== undefined && (!input.statefulBodies || typeof input.statefulBodies !== "object" || Array.isArray(input.statefulBodies)
    || Object.entries(input.statefulBodies).some(([path, owners]) => !isAbsolute(path) || !Array.isArray(owners) || owners.length > 1024
      || owners.some(owner => !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(owner))))) throw unsupported();
  if (input.statefulConstants !== undefined && !validNameIndex(input.statefulConstants)) throw unsupported();
}
// Path -> dotted declaration names, as recorded by the Debug overlay build.
export function validNameIndex(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.entries(value).every(([path, names]) => isAbsolute(path) && Array.isArray(names) && names.length <= 1024
      && names.every(name => typeof name === "string" && name.length <= 256 && /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/.test(name)));
}
function validateGeneration(value, input) {
  if (value?.schemaVersion !== 1 || value.capability !== VERSION || !Number.isSafeInteger(value.changedMemberCount) || value.changedMemberCount < 1 || value.changedMemberCount > 512
    || !/^[a-f0-9]{24,64}$/.test(value.generation || "") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.module || "")
    || (input && (input.generation !== value.generation || input.module !== value.module))
    || !Array.isArray(value.sources) || (input && value.sources.length !== input.files.length) || value.sources.some(source => typeof source !== "string")
    || !Array.isArray(value.members) || value.members.length !== value.changedMemberCount) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  const names = new Set();
  if (value.sharedAdditive !== undefined && (typeof value.sharedAdditive !== "boolean"
    || (value.sharedAdditive && ((input && input.allowSharedAdditive !== true) || value.additiveProtocol !== 1)))) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  if (value.additiveProtocol !== undefined && ![0, 1].includes(value.additiveProtocol)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  if (value.constantProtocol !== undefined && (![0, 1].includes(value.constantProtocol)
    || (value.constantProtocol === 1 && input && input.statefulConstants === undefined))) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  if (value.additiveProtocol === 1 && ((input && input.allowAdditive !== true) || value.requiresPrivateScopes !== true
    || !Array.isArray(value.additions) || value.additions.length > 512 || value.additions.some(item => !item
      || typeof item.file !== "string" || !item.file.endsWith(".swift") || typeof item.owner !== "string"
      || typeof item.declaration !== "string" || item.declaration.length > 4096
      || (input && !input.files.some(file => file.path.split("/").at(-1) === item.file))))) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  if (value.refreshStrategy !== undefined && !["remount", "preserve-state-v1"].includes(value.refreshStrategy)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  validateAddedStateGeneration(value, input);
  if (value.statefulComponentProtocol !== undefined && ![0, 1].includes(value.statefulComponentProtocol)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  if (value.statefulComponentProtocol === 1) {
    if ((input && input.allowStatefulAdditive !== true) || value.additiveProtocol !== 1 || value.requiresPrivateScopes !== true
      || !Array.isArray(value.statefulComponents) || !Array.isArray(value.statefulOriginUses)
      || value.statefulComponents.length + value.statefulOriginUses.length > 32) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
    const componentKeys = new Set();
    for (const component of value.statefulComponents) {
      const key = component?.path + "#" + component?.owner;
      if (componentKeys.has(key) || !isAbsolute(component?.path || "") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(component.owner || "")
        || !/^[a-f0-9]{64}$/.test(component.layoutDigest || "") || !Number.isSafeInteger(component.sourceFileIndex)
        || component.sourceFileIndex < 0 || component.sourceFileIndex >= value.sources.length
        || (input && input.files[component.sourceFileIndex]?.path !== component.path)
        || (component.stateNames !== undefined && !validStateNames(component.stateNames))
        || !Array.isArray(component.slots) || !component.slots.length || component.slots.length > 128
        || component.slots.some(slot => !slot || typeof slot.member !== "string" || !slot.member || slot.member.length > 4096
          || !["function", "property", "subscript"].includes(slot.kind) || typeof slot.isStatic !== "boolean"
          || !Array.isArray(slot.accessors) || slot.accessors.some(accessor => !["getter", "setter"].includes(accessor))
          || (slot.kind !== "function" && !slot.accessors.length))) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
      componentKeys.add(key);
    }
    for (const origin of value.statefulOriginUses) {
      const key = origin?.path + "#" + origin?.owner;
      if (componentKeys.has(key) || !origin || !isAbsolute(origin.path || "") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(origin.owner || "")
        || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(origin.module || "") || !/^Replacement(?:[0-9]|[12][0-9]|3[01])\.swift$/.test(origin.sourceFile || "")
        || !/^[a-f0-9]{64}$/.test(origin.layoutDigest || "")
        || (input && !input.statefulOrigins?.some(item => ["path", "owner", "module", "sourceFile", "layoutDigest"].every(field => item[field] === origin[field])))) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
      componentKeys.add(key);
    }
  } else if ((value.statefulComponents?.length || 0) + (value.statefulOriginUses?.length || 0)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  for (const member of value.members) {
    if (!member || !["function", "property", "subscript"].includes(member.kind) || typeof member.isStatic !== "boolean" || typeof member.owner !== "string" || typeof member.member !== "string"
      || !new RegExp(`^__swiftSim_(?:full_g${value.generation}_f\\d+_\\d+|label_g${value.generation}_f\\d+_\\d+_0)$`).test(member.replacementName || "") || names.has(member.replacementName)
      || !Array.isArray(member.accessors) || member.accessors.some(name => !["getter", "setter"].includes(name))
      || (member.kind !== "function" && !member.accessors.length)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
    names.add(member.replacementName);
    const pinned = value.statefulComponentProtocol === 1 && value.statefulOriginUses.some(origin => origin.module === member.targetModule && origin.owner === member.owner
      && origin.path.split("/").at(-1) === member.file);
    if (member.targetModule !== undefined && !pinned) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
    if (input && !pinned && value.refreshStrategy === "preserve-state-v1" && ((member.member !== "body"
      && !((input.allowAdditive === true || input.preserveViewFunctions === true) && member.kind === "function" && !member.isStatic)
      && !(member.kind === "property" && !member.isStatic && value.addedStateOwners?.some(owner => owner.owner === member.owner
        && owner.path.split("/").at(-1) === member.file)))
      || !input.files.some(file => file.path.split("/").at(-1) === member.file && input.statefulBodies?.[file.path]?.includes(member.owner)))) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  }
}
function validateAddedStateGeneration(value, input) {
  const invalid = () => { throw unsupported("FULL_CALLABLE_GENERATOR_INVALID"); };
  if (value.addedStateProtocol !== undefined && ![0, 1].includes(value.addedStateProtocol)) invalid();
  if (value.addedStateProtocol !== 1) {
    if (value.addedStateGeneration !== undefined || (value.addedStateOwners !== undefined
      && (!Array.isArray(value.addedStateOwners) || value.addedStateOwners.length))) invalid();
    return;
  }
  if ((input && (input.allowAddedState !== true || value.addedStateGeneration !== input.stateGeneration))
    || !Number.isSafeInteger(value.addedStateGeneration) || value.addedStateGeneration < 1
    || value.additiveProtocol !== 1 || value.requiresPrivateScopes !== true
    || !Array.isArray(value.addedStateOwners) || !value.addedStateOwners.length || value.addedStateOwners.length > 512) invalid();
  const owners = new Set(), allKeys = new Set();
  for (const owner of value.addedStateOwners) {
    const identity = owner?.path + "#" + owner?.owner;
    if (!owner || !isAbsolute(owner.path || "") || owner.path.length > 4096
      || !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(owner.owner || "") || owners.has(identity)
      || !Array.isArray(owner.fields) || owner.fields.length > 32
      || (input && (!input.files.some(file => file.path === owner.path) || !(input.statefulBodies?.[owner.path]?.includes(owner.owner)
        || input.statefulOrigins?.some(origin => origin.path === owner.path && origin.owner === owner.owner && validStateNames(origin.stateNames)))))) invalid();
    owners.add(identity);
    const names = new Set();
    for (const field of owner.fields) {
      if (!field || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(field.name || "") || names.has(field.name)
        || !/^[a-f0-9]{64}$/.test(field.key || "") || allKeys.has(field.key) || !addedStateType(field.type)) invalid();
      names.add(field.name); allKeys.add(field.key);
    }
  }
}
function addedStateType(value, depth = 0) {
  if (typeof value !== "string" || !value || value.length > 1024 || depth > 16) return false;
  const type = value.replaceAll(/\s+/g, "");
  if (/^(?:Swift\.)?(?:Bool|String|Int(?:8|16|32|64)?|UInt(?:8|16|32|64)?|Float|Double)$/.test(type)) return true;
  if (type.endsWith("?")) return addedStateType(type.slice(0, -1), depth + 1);
  const optional = type.match(/^(?:Swift\.)?Optional<(.+)>$/);
  if (optional) return addedStateType(optional[1], depth + 1);
  if (!type.startsWith("[") || !type.endsWith("]")) return false;
  const inner = type.slice(1, -1); let nesting = 0, separator = -1;
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index];
    if (char === "[" || char === "<") nesting++;
    if (char === "]" || char === ">") nesting--;
    if (nesting < 0) return false;
    if (char === ":" && nesting === 0) { if (separator !== -1) return false; separator = index; }
  }
  if (nesting !== 0) return false;
  return separator === -1 ? addedStateType(inner, depth + 1)
    : addedStateType(inner.slice(0, separator), depth + 1) && addedStateType(inner.slice(separator + 1), depth + 1);
}
function identifierIn(text, identifier) {
  const offset = text.indexOf(identifier);
  return offset >= 0 && !/[A-Za-z0-9_]/.test(text[offset - 1] || "") && !/[A-Za-z0-9_]/.test(text[offset + identifier.length] || "");
}
function rejectInitializers(output) {
  let section = "";
  for (const line of output.split(/\r?\n/)) {
    const name = line.match(/^\s*sectname\s+(\S+)/); if (name) section = name[1];
    if (/^\s*cmd LC_ROUTINES_64\s*$/.test(line)) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
    const size = line.match(/^\s*size\s+0x([0-9a-fA-F]+)/);
    if (size && ["__mod_init_func", "__mod_term_func", "__objc_nlcatlist", "__objc_nlclslist", "__objc_classlist"].includes(section) && BigInt(`0x${size[1]}`) !== 0n) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
  }
}
function categoryCountFromLoadCommands(output) {
  let section = ""; let count = 0;
  for (const line of output.split(/\r?\n/)) {
    const name = line.match(/^\s*sectname\s+(\S+)/); if (name) section = name[1];
    const size = line.match(/^\s*size\s+0x([0-9a-fA-F]+)/);
    if (size && section === "__objc_catlist") {
      const bytes = BigInt(`0x${size[1]}`);
      if (bytes % 8n || bytes > 2048n) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      count += Number(bytes / 8n); section = "";
    }
  }
  return count;
}
function selectorReferences(commands, metadata) {
  const sections = new Map(); let name = ""; let segment = ""; let address = null;
  for (const line of commands.split(/\r?\n/)) {
    const section = line.match(/^\s*sectname\s+(\S+)/); if (section) { name = section[1]; segment = ""; address = null; }
    const seg = line.match(/^\s*segname\s+(\S+)/); if (seg) segment = seg[1];
    const addr = line.match(/^\s*addr\s+0x([0-9a-fA-F]+)/); if (addr) address = BigInt(`0x${addr[1]}`);
    const size = line.match(/^\s*size\s+0x([0-9a-fA-F]+)/);
    if (size && name === "__objc_selrefs") {
      const bytes = BigInt(`0x${size[1]}`);
      if (address === null || bytes % 8n || bytes > 65_536n || sections.has(segment)) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      sections.set(segment, { address, count: Number(bytes / 8n), observed: 0 }); name = "";
    }
  }
  const result = new Map(); let active = null;
  for (const line of metadata.split(/\r?\n/)) {
    if (line.startsWith("Contents of ")) {
      const header = line.match(/^Contents of \(([^,]+),__objc_selrefs\) section$/);
      active = header ? sections.get(header[1]) : null;
      if (header && !active) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      continue;
    }
    if (!active || !line.trim()) continue;
    const value = line.match(/^\s+0x[0-9a-fA-F]+\s+([A-Za-z_$][A-Za-z0-9_$:]*)$/);
    if (!value || active.observed >= active.count) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
    result.set((active.address + BigInt(active.observed * 8)).toString(16), value[1]); active.observed += 1;
  }
  if ([...sections.values()].some(section => section.count !== section.observed)) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
  return result;
}
export function parseObjCCategories(output, { selectorReferences = new Map() } = {}) {
  if (typeof output !== "string" || Buffer.byteLength(output) > OUTPUT_LIMIT) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
  const result = []; let active = false; let current = null; let pending = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("Contents of ")) { active = /,__objc_catlist\) section$/.test(line); current = null; pending = null; continue; }
    if (!active) continue;
    const category = line.match(/^[0-9a-fA-F]+\s+0x[0-9a-fA-F]+\s+(\S+)$/);
    if (category) {
      const symbol = category[1];
      const name = symbol.match(/^__CATEGORY_(.+)_\$_[^\s]+$/) || symbol.match(/^__OBJC_\$_CATEGORY_(.+)_\$_[^\s]+$/);
      if (!name || result.length >= 256) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      current = { className: name[1], classSymbol: "", methods: [], declaredCount: null }; result.push(current); pending = null; continue;
    }
    if (!line.trim()) continue;
    if (!current) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
    const cls = line.match(/^\s+cls\s+0x[0-9a-fA-F]+\s+(\S+)$/); if (cls) { current.classSymbol = cls[1]; continue; }
    if (/^\s+(?:classMethods|protocols|instanceProperties)\s+/.test(line)) {
      if (!/^\s+(?:classMethods|protocols|instanceProperties)\s+0x0\s*$/.test(line)) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      continue;
    }
    const count = line.match(/^\s+count\s+(\d+)$/); if (count) { if (current.declaredCount !== null) throw unsupported(); current.declaredCount = Number(count[1]); continue; }
    const name = line.match(/^\s{8,}name\s+0x[0-9a-fA-F]+(?:\s+\(0x[0-9a-fA-F]+\))?\s+([A-Za-z_$][A-Za-z0-9_$:]*)$/);
    if (name) { if (pending) throw unsupported(); pending = { selector: name[1] }; continue; }
    const indirectName = line.match(/^\s{8,}name\s+0x[0-9a-fA-F]+\s+\(0x([0-9a-fA-F]+)\)\s*$/);
    if (indirectName) {
      const selector = selectorReferences.get(BigInt(`0x${indirectName[1]}`).toString(16));
      if (pending || !selector) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
      pending = { selector }; continue;
    }
    const encoding = line.match(/^\s{8,}types\s+0x[0-9a-fA-F]+(?:\s+\(0x[0-9a-fA-F]+\))?\s+(\S+)$/);
    if (encoding) { if (!pending || pending.encoding) throw unsupported(); pending.encoding = encoding[1]; continue; }
    const imp = line.match(/^\s{8,}imp\s+0x([0-9a-fA-F]+)(?:\s+\(0x([0-9a-fA-F]+)\))?(?:\s+\S+)?$/);
    if (imp) { if (!pending?.encoding) throw unsupported(); pending.imp = (imp[2] || imp[1]).toLowerCase(); current.methods.push(pending); pending = null; continue; }
    if (/^\s{4}name\s+0x[0-9a-fA-F]+\s+\S+$/.test(line)
      || /^\s{4}instanceMethods\s+0x[0-9a-fA-F]+(?:\s+\S+)?$/.test(line)
      || /^\s+entsize\s+(?:12|24)(?:\s+\(relative\))?$/.test(line)) continue;
    throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
  }
  if (pending || result.some(category => !category.classSymbol || category.declaredCount !== category.methods.length || category.methods.some(method => method.selector.length > 512 || method.encoding.length > 512))) throw unsupported("FULL_CALLABLE_OBJC_METADATA_INVALID");
  return result;
}
