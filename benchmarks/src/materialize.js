import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { readMutation, resolveSafePath, sha256File } from "./corpus.js";

export function materializeCase({ fixtureRoot, corpusRoot, benchmarkCase }) {
  const sourceRoot = resolve(fixtureRoot);
  const runRoot = mkdtempSync(join(tmpdir(), "swift-sim-benchmark-case-"));
  const beforeRoot = join(runRoot, "before");
  const afterRoot = join(runRoot, "after");
  cpSync(sourceRoot, beforeRoot, { recursive: true, force: true });
  cpSync(sourceRoot, afterRoot, { recursive: true, force: true });
  validateBaselineHashes(sourceRoot, benchmarkCase.baselineHashes || {}, benchmarkCase.id);

  const patchPath = resolveSafePath(corpusRoot, benchmarkCase.mutation);
  const patch = readMutation(corpusRoot, benchmarkCase.mutation);
  const patchFile = join(runRoot, `${benchmarkCase.id}.patch`);
  writeFileSync(patchFile, patch, { mode: 0o600 });
  const applied = spawnSync("git", ["apply", "--whitespace=nowarn", "--unsafe-paths", patchFile], {
    cwd: afterRoot,
    encoding: "utf8",
    timeout: 30_000,
  });
  if (applied.status !== 0) {
    throw new Error(`Mutation ${benchmarkCase.id} did not apply: ${String(applied.stderr || applied.stdout).trim()}`);
  }

  const changes = parsePatchFiles(patch, beforeRoot, afterRoot);
  return {
    runRoot,
    beforeRoot,
    afterRoot,
    patchPath,
    changes,
  };
}

export function parsePatchFiles(patch, beforeRoot, afterRoot) {
  const changes = [];
  const lines = String(patch).split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index].match(/^diff --git a\/(.+) b\/(.+)$/);
    if (!header) continue;
    const beforeRelative = normalizePatchPath(header[1]);
    const afterRelative = normalizePatchPath(header[2]);
    const oldHeader = lines.slice(index + 1, index + 4).find((line) => line.startsWith("--- ")) || "";
    const newHeader = lines.slice(index + 1, index + 6).find((line) => line.startsWith("+++ ")) || "";
    const fileAdded = oldHeader.startsWith("--- /dev/null");
    const fileDeleted = newHeader.startsWith("+++ /dev/null");
    const path = fileAdded ? afterRelative : beforeRelative;
    const extension = extname(path).toLowerCase();
    changes.push({
      path,
      kind: extension === ".swift" ? "swift" : "resource",
      status: fileAdded ? "added" : fileDeleted ? "deleted" : "modified",
      beforePath: fileAdded ? "" : join(beforeRoot, beforeRelative),
      afterPath: fileDeleted ? "" : join(afterRoot, afterRelative),
    });
  }
  if (changes.length === 0) throw new Error("Mutation patch contains no git diff file entries.");
  return changes;
}

function validateBaselineHashes(sourceRoot, hashes, caseID) {
  for (const [path, expected] of Object.entries(hashes)) {
    const absolute = resolveSafePath(sourceRoot, path);
    if (!existsSync(absolute)) throw new Error(`Baseline file ${path} is missing for ${caseID}.`);
    const actual = sha256File(absolute);
    if (actual !== expected) {
      throw new Error(`Baseline hash mismatch for ${caseID}: ${path}.`);
    }
  }
}

function normalizePatchPath(value) {
  const path = String(value).split(/\t/, 1)[0];
  return path.replace(/^a\//, "").replace(/^b\//, "");
}
