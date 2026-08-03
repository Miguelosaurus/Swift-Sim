#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const roots = ["README.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", "CHANGELOG.md"];

function markdownFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

const documentationRoots = ["docs", "benchmarks", "plugins"];
const docs = documentationRoots.flatMap(markdownFiles).sort();

const failures = [];
for (const file of [...roots, ...docs]) {
  if (!fs.existsSync(file)) {
    failures.push(`${file}: file is missing`);
    continue;
  }

  const source = fs.readFileSync(file, "utf8");
  for (const match of source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].trim();
    if (!target || target.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;

    const relativeTarget = decodeURIComponent(target.split("#", 1)[0]);
    const resolved = path.resolve(path.dirname(file), relativeTarget);
    if (!fs.existsSync(resolved)) failures.push(`${file}: broken link to ${target}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`Verified relative links in ${roots.length + docs.length} Markdown files.`);
