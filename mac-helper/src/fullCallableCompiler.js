import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
      policy: { timeoutMs, outputLimitBytes: OUTPUT_LIMIT, processGroup: "inherit", acceptedExitCodes: [0] } });
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
      run(compiler, [resourcePath, "-sdk", hostSDK, "-I", host, "-L", host, "-Xlinker", "-rpath", "-Xlinker", host, "-o", staged], { timeoutMs: 60_000 });
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
    const members = generation.members.map(member => ({ ...member, swift: [], objc: [] }));
    for (let index = 0; index < demangled.length; index += 1) {
      const name = demangled[index];
      const normalized = name.replace(/\(([^ ]+) in _[A-Fa-f0-9]+\)/g, "$1");
      const matches = members.filter(member => {
        const owner = member.owner.split(/\s+where\s+/)[0];
        const prefix = owner ? `dynamically replaceable variable for ${member.isStatic ? "static " : ""}(extension in ${moduleName}):${generation.module}.${owner}.`
          : `dynamically replaceable variable for ${moduleName}.`;
        return normalized.startsWith(prefix) && identifierIn(normalized, member.replacementName);
      });
      if (matches.length !== 1) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
      const member = matches[0];
      const accessor = member.kind === "function" ? "function" : member.accessors.find(value => name.includes(`.${value} :`));
      if (!accessor || member.swift.some(item => item.accessor === accessor)) throw unsupported("FULL_CALLABLE_COVERAGE_INCOMPLETE");
      member.swift.push({ symbol: variables[index], accessor });
    }
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
    const replacementProof = normalizeReplacementProof({ version: 3, swift_replacements: variables.length, objc_callbacks: callbacks });
    return { version: 1, artifactDigest: hash(bytes), replacementProof, coverageDigest: replacementProofDigest(replacementProof),
      changedMemberCount: members.length, members, swiftSymbols: variables };
  }
  return Object.freeze({ generate, inspectCoverage });
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
}
function validateGeneration(value, input) {
  if (value?.schemaVersion !== 1 || value.capability !== VERSION || !Number.isSafeInteger(value.changedMemberCount) || value.changedMemberCount < 1 || value.changedMemberCount > 512
    || !/^[a-f0-9]{24,64}$/.test(value.generation || "") || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.module || "")
    || (input && (input.generation !== value.generation || input.module !== value.module))
    || !Array.isArray(value.sources) || (input && value.sources.length !== input.files.length) || value.sources.some(source => typeof source !== "string")
    || !Array.isArray(value.members) || value.members.length !== value.changedMemberCount) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
  const names = new Set();
  for (const member of value.members) {
    if (!member || !["function", "property", "subscript"].includes(member.kind) || typeof member.isStatic !== "boolean" || typeof member.owner !== "string" || typeof member.member !== "string"
      || !new RegExp(`^__swiftSim_(?:full_g${value.generation}_f\\d+_\\d+|label_g${value.generation}_f\\d+_\\d+_0)$`).test(member.replacementName || "") || names.has(member.replacementName)
      || !Array.isArray(member.accessors) || member.accessors.some(name => !["getter", "setter"].includes(name))
      || (member.kind !== "function" && !member.accessors.length)) throw unsupported("FULL_CALLABLE_GENERATOR_INVALID");
    names.add(member.replacementName);
  }
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
