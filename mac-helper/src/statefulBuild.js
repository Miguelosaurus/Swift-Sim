import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createFullCallableCompiler, validNameIndex } from "./fullCallableCompiler.js";
import { NodeAtomicFileStore, ensureDirectoryModeSync } from "./infrastructure/nodeAtomicFileStore.js";

const DRIVER = fileURLToPath(new URL("../resources/StatefulSwiftDriver.py", import.meta.url));
const OMIT = new Set([".git", ".build", ".swiftpm", ".codex", "DerivedData", "build", "node_modules", "Pods", "Carthage", "SourcePackages"]);
const digest = value => createHash("sha256").update(value).digest("hex");

// One bounded pass during a full Debug build. No watcher, source mutation or
// state snapshots. The compiler itself confirms that the installed SDK opts in.
export function prepareStatefulBuild({ projectPath, root, moduleName, compilerPath, runner, compiler }) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(moduleName || "") || !isAbsolute(compilerPath || "")) return null;
  const base = dirname(resolve(projectPath));
  const files = []; let visited = 0; let bytes = 0; let complete = true;
  function scan(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (++visited > 30_000) throw invalid();
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { if (!OMIT.has(entry.name) && !entry.name.startsWith(".") && !/\.(?:xcodeproj|xcworkspace|app|framework)$/.test(entry.name)) scan(path); }
      else if (entry.isFile() && entry.name.endsWith(".swift")) {
        const stat = lstatSync(path); if (stat.size > 1024 * 1024) { complete = false; continue; }
        // Every file informs the constant-shadowing guard; only candidates can need an overlay.
        files.push({ path, source: readFileSync(path, "utf8") });
      }
    }
  }
  scan(base);
  const candidates = files.filter(file => /\b(?:SwiftUI\.)?View\b|\bstatic\s+let\b/.test(file.source));
  if (!candidates.length) return null;
  for (const file of candidates) if ((bytes += Buffer.byteLength(file.source)) > 7 * 1024 * 1024 || candidates.length > 2048) throw invalid();
  // Constant lowering needs the whole module for its shadowing guard. When that
  // inventory is incomplete, keep view instrumentation and leave constants stored.
  const total = files.reduce((sum, file) => sum + Buffer.byteLength(file.source), 0);
  const lowerConstants = complete && files.length <= 2048 && total <= 7 * 1024 * 1024;
  const generated = (compiler || createFullCallableCompiler({ runner, cacheRoot: join(root, "stateful-compiler-cache") }))
    .instrument({ files: lowerConstants ? files : candidates, lowerConstants });
  if (!generated.files.length) return null;
  const directory = join(root, "stateful-sources"); ensureDirectoryModeSync(directory, 0o700);
  const store = new NodeAtomicFileStore();
  const write = (path, content, mode = 0o600) => store.writeTextSync(path, content, { mode, createParentMode: 0o700, replace: false, syncDirectory: true });
  const wrapperPath = join(directory, "swiftc"); const wrapper = readFileSync(DRIVER, "utf8"); write(wrapperPath, wrapper, 0o700);
  // Swift's integrated driver discovers ABI-emission features relative to the
  // frontend executable, independently of -resource-dir. Preserve that exact
  // toolchain metadata when the frontend lives in this private build directory.
  const featureSource = resolve(dirname(compilerPath), "../share/swift/features.json");
  const featureBytes = readFileSync(featureSource, "utf8");
  if (Buffer.byteLength(featureBytes) > 64 * 1024 || !Array.isArray(JSON.parse(featureBytes).features)) throw invalid();
  const featuresPath = join(root, "share", "swift", "features.json"); write(featuresPath, featureBytes);
  const records = generated.files.map((file, index) => {
    const generatedPath = join(directory, `View${index}.swift`); write(generatedPath, file.source);
    return { path: file.path, sourceDigest: digest(files.find(value => value.path === file.path).source), generatedPath, generatedDigest: digest(file.source), owners: file.owners, constants: file.constants || [] };
  });
  const overlayPath = join(directory, "swift-sim-stateful-overlay.json");
  const overlay = JSON.stringify({ version: 0, "case-sensitive": true, "use-external-names": false,
    roots: records.map(file => ({ type: "file", name: file.path, "external-contents": file.generatedPath })) });
  write(overlayPath, overlay);
  const manifestPath = join(directory, "manifest.json");
  const manifest = { version: 1, moduleName, compilerPath, resourceDigest: generated.resourceDigest,
    wrapperPath, wrapperDigest: digest(wrapper), overlayPath, overlayDigest: digest(overlay),
    featuresPath, featuresDigest: digest(featureBytes), files: records };
  write(manifestPath, JSON.stringify(manifest));
  return { wrapperPath, overlayPath, manifestPath, resourceDirectory: resolve(dirname(compilerPath), "../lib/swift"), count: records.length };
}

// Called only for a compiler-captured overlay. Every generated input is part of
// resume provenance; the immutable index also binds patch normalization later.
export function inspectStatefulBuild(overlayPath, sourcePaths) {
  const directory = dirname(resolve(overlayPath));
  const manifestPath = join(directory, "manifest.json"); const usagePath = join(directory, "usage.json");
  const bytes = privateBytes(manifestPath); const manifestDigest = digest(bytes); const manifest = JSON.parse(bytes);
  const usage = JSON.parse(privateBytes(usagePath));
  if (manifest.version !== 1 || manifest.overlayPath !== overlayPath || usage.version !== 1
    || usage.manifestDigest !== manifestDigest || usage.moduleName !== manifest.moduleName || usage.active !== true
    || !Array.isArray(manifest.files) || manifest.files.length > 2048
    || digest(privateBytes(overlayPath)) !== manifest.overlayDigest
    || manifest.featuresPath !== resolve(directory, "../share/swift/features.json")
    || digest(privateBytes(manifest.featuresPath)) !== manifest.featuresDigest
    || manifest.wrapperPath !== join(directory, "swiftc") || digest(privateBytes(manifest.wrapperPath)) !== manifest.wrapperDigest) throw invalid();
  const inputs = [manifestPath, overlayPath, usagePath, manifest.wrapperPath, manifest.featuresPath]; const bodies = {}; const constants = {};
  for (const file of manifest.files) {
    if (dirname(file.generatedPath) !== directory || !/^View\d+\.swift$/.test(file.generatedPath.slice(directory.length + 1))
      || !isAbsolute(file.path) || realpathSync(file.path) !== file.path || !Array.isArray(file.owners)
      || file.owners.some(owner => !/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(owner))
      || digest(privateBytes(file.generatedPath)) !== file.generatedDigest
      || (file.constants !== undefined && !validNameIndex({ [file.path]: file.constants }))) throw invalid();
    inputs.push(file.generatedPath);
    if (sourcePaths.has(file.path)) {
      if (digest(readFileSync(file.path)) !== file.sourceDigest) throw invalid();
      bodies[file.path] = file.owners;
      if (file.constants?.length) constants[file.path] = file.constants;
    }
  }
  return { inputs, index: { version: 1, manifestPath, manifestDigest, moduleName: manifest.moduleName, bodies, constants } };
}

export function statefulBodyIndex(index, moduleName) {
  if (!index) return { bodies: {}, constants: {}, digest: "legacy" };
  // Original source files may now contain the edit. Immutable generated build
  // inputs, rather than current source text, establish the installed ABI.
  const bytes = privateBytes(index.manifestPath); const manifest = JSON.parse(bytes);
  if (index.version !== 1 || manifest.version !== 1 || index.moduleName !== moduleName || manifest.moduleName !== moduleName
    || digest(bytes) !== index.manifestDigest || !Array.isArray(manifest.files)) throw invalid();
  const bodies = {};
  for (const [path, owners] of Object.entries(index.bodies || {})) {
    const file = manifest.files.find(value => value.path === path);
    if (!file || JSON.stringify(owners) !== JSON.stringify(file.owners)
      || dirname(file.generatedPath) !== dirname(index.manifestPath)
      || digest(privateBytes(file.generatedPath)) !== file.generatedDigest) throw invalid();
    bodies[path] = owners;
  }
  // Constants recorded for the installed binary; the manifest digest binds them.
  const constants = {};
  for (const [path, names] of Object.entries(index.constants || {})) {
    const file = manifest.files.find(value => value.path === path);
    if (!file || JSON.stringify(names) !== JSON.stringify(file.constants)) throw invalid();
    constants[path] = names;
  }
  return { bodies, constants, digest: index.manifestDigest };
}

function privateBytes(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.mode & 0o077 || stat.size > 8 * 1024 * 1024
    || (process.getuid && stat.uid !== process.getuid())) throw invalid();
  return readFileSync(path);
}
function invalid() { return Object.assign(new Error("The state-preserving Debug compiler inputs changed or could not be verified."), { code: "STATEFUL_BUILD_INVALID" }); }
