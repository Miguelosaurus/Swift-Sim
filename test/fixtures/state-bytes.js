import { readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, relative, sep } from "node:path";

// State-only inspection for disposable behavioral fixtures. This seam cannot
// read implementation text or files outside the operating system's temp root.
export function readStateBytes(path) {
  if (typeof path !== "string" || !isAbsolute(path)) {
    throw new TypeError("State fixture path must be absolute.");
  }
  const name = basename(path);
  if (/\.(?:[cm]?[jt]sx?|swift|m|h)(?:\.|$)/i.test(name)
      || !/\.json$|\.sqlite(?:-(?:wal|shm))?$|^sentinel$/.test(name)) {
    throw new Error("State fixture reads accept only JSON, SQLite, or sentinel data.");
  }
  const root = realpathSync(tmpdir());
  const target = realpathSync(path);
  const contained = relative(root, target);
  if (!contained || contained === ".." || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error("State fixture reads must remain inside the disposable temp root.");
  }
  if (basename(target) !== name) {
    throw new Error("State fixture reads cannot follow renamed source targets.");
  }
  return readFileSync(target);
}
