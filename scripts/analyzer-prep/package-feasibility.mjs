#!/usr/bin/env node
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const packagePath = resolve(
  root,
  "tools/swift-analyzer-prep/SwiftSyntaxProbe/Package.swift",
);

const swiftVersion = run("swift", ["--version"]);
const swiftcVersion = run("swiftc", ["--version"]);
const xcrun = run("xcrun", ["--version"]);
const directImport = directSwiftSyntaxImportProbe();
const manifest = run("swift", ["package", "--package-path", packagePath.replace(/\/Package\.swift$/, ""), "dump-package"]);

const result = {
  schemaVersion: 1,
  environment: {
    platform: process.platform,
    arch: process.arch,
  },
  tools: {
    swift: compact(swiftVersion),
    swiftc: compact(swiftcVersion),
    xcrun: compact(xcrun),
  },
  directToolchainImport: {
    available: directImport.status === 0,
    detail: compact(directImport),
  },
  packageManifest: {
    valid: manifest.status === 0,
    detail: compact(manifest),
  },
  conclusions: [
    "A Swift executable can only be considered shippable after its SwiftSyntax dependency is explicit and version-pinned.",
    "Toolchain presence alone is not evidence that SwiftSyntax/SwiftParser are importable.",
    "Normal Swift Sim use must not trigger an unexpected source build; release/Homebrew packaging needs a prebuilt analyzer decision and clean-machine proof.",
    "This probe does not modify production routing or root package policy.",
  ],
};
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

function directSwiftSyntaxImportProbe() {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-analyzer-feasibility-"));
  try {
    const source = join(directory, "Probe.swift");
    const output = join(directory, "probe");
    writeFileSync(source, "import SwiftSyntax\nimport SwiftParser\nprint(\"ok\")\n");
    return run("swiftc", [source, "-o", output]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return {
    status: result.status,
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    errorCode: result.error?.code || "",
  };
}

function compact(result) {
  return {
    status: result.status,
    errorCode: result.errorCode || "",
    output: String(result.stdout || result.stderr || "").trim().slice(0, 4000),
  };
}
