import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const OMIT = new Set([".git", ".build", "build", "DerivedData", "node_modules", ".swiftpm", "Pods", "xcuserdata", ".DS_Store"]);
const TEXT = /\.(swift|m|mm|h|c|cpp|json|plist|pbxproj|entitlements|xcconfig|xcscheme|resolved|strings|storyboard|xib)$/i;

// Short-lived Mac-only guard around full builds. Never used by hot reload.
function scan(root) {
  const files = new Map(); let textBytes = 0;
  function visit(directory) {
    for (const name of readdirSync(directory).sort()) {
      if (OMIT.has(name)) continue;
      const path = join(directory, name); const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw new Error("Build inputs contain an untracked external link.");
      if (stat.isDirectory()) { visit(path); continue; }
      if (!stat.isFile() || files.size >= 32768) throw new Error("Build input inventory exceeds its limit.");
      const content = TEXT.test(name) && stat.size <= 16 * 1024 * 1024;
      if (content && (textBytes += stat.size) > 128 * 1024 * 1024) throw new Error("Build text inputs exceed their limit.");
      files.set(path, content ? createHash("sha256").update(readFileSync(path)).digest("hex")
        : [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(":"));
    }
  }
  visit(root);
  return files;
}
export function snapshotBuildInputs(root) {
  const before = scan(root);
  return () => {
    const after = scan(root);
    if (before.size !== after.size || [...before].some(([path, value]) => after.get(path) !== value)) {
      throw Object.assign(new Error("Project inputs changed during the build. The build was held; no installation was requested."), { code: "BUILD_INPUTS_CHANGED" });
    }
  };
}
