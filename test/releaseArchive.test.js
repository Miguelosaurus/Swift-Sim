import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-release-archive-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, "source"), caller = join(root, "caller");
  mkdirSync(join(source, "scripts/release"), { recursive: true });
  mkdirSync(caller);
  copyFileSync(new URL("../scripts/release/create-archive.sh", import.meta.url), join(source, "scripts/release/create-archive.sh"));
  writeFileSync(join(source, "package.json"), JSON.stringify({ name: "archive-source", version: "0.6.4", files: ["dist"], scripts: { build: "node build.cjs" } }));
  writeFileSync(join(source, "build.cjs"), 'const fs=require("fs");fs.mkdirSync("dist",{recursive:true});fs.writeFileSync("dist/owner.txt","qualified-source");');
  writeFileSync(join(caller, "package.json"), JSON.stringify({ name: "wrong-caller", version: "0.0.1" }));
  return { source, caller, output: join(root, "release.tar.gz") };
}

test("release archives pack their source checkout even when invoked from another package", t => {
  const f = fixture(t);
  const result = spawnSync("bash", [join(f.source, "scripts/release/create-archive.sh"), "0.6.4", f.output], { cwd: f.caller, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const packed = spawnSync("tar", ["-xOf", f.output, "./package.json"], { encoding: "utf8" });
  assert.equal(packed.status, 0, packed.stderr);
  assert.deepEqual([JSON.parse(packed.stdout).name, JSON.parse(packed.stdout).version], ["archive-source", "0.6.4"]);
  const owner = spawnSync("tar", ["-xOf", f.output, "./dist/owner.txt"], { encoding: "utf8" });
  assert.equal(owner.status, 0, owner.stderr);
  assert.equal(owner.stdout, "qualified-source");
});

test("release archives reject a mismatched version before building or publishing an archive", t => {
  const f = fixture(t);
  const result = spawnSync("bash", [join(f.source, "scripts/release/create-archive.sh"), "0.6.5", f.output], { cwd: f.caller, encoding: "utf8", timeout: 30_000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Release version must match/);
  assert.equal(existsSync(join(f.source, "dist")), false);
  assert.equal(existsSync(f.output), false);
});
