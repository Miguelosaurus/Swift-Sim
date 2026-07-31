#!/usr/bin/env node
import { readdirSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([".git", ".build", "node_modules"]);
const extensions = new Set([".js", ".mjs", ".cjs"]);
const files = [];

visit(root);
files.sort();

const failures = [];
for (const path of files) {
  const result = spawnSync(process.execPath, ["--check", path], {
    encoding: "utf8",
    env: process.env,
  });
  if (result.status === 0) continue;
  failures.push({
    path,
    detail: String(result.stderr || result.stdout || "Syntax check failed.").trim(),
  });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\n${failure.path}\n${failure.detail}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Syntax checked ${files.length} JavaScript files.`);
}

function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.isFile() && extensions.has(extname(entry.name))) files.push(path);
  }
}
