import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  cpSync,
  rmSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
export function signedEngineFixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-signed-engine-"));
  const app = join(root, "InjectionNext.app");
  mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
  writeFileSync(join(root, "main.c"), "int main(void) { return 0; }\n");
  const compile = spawnSync(
    "/usr/bin/xcrun",
    [
      "clang",
      "-arch",
      "arm64",
      join(root, "main.c"),
      "-o",
      join(app, "Contents/MacOS/InjectionNext"),
    ],
    { encoding: "utf8", timeout: 30000 },
  );
  if (compile.status !== 0) throw new Error(compile.stderr);
  writeFileSync(
    join(app, "Contents/Info.plist"),
    '<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.johnholdsworth.InjectionNext</string><key>CFBundleExecutable</key><string>InjectionNext</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>',
  );
  const sign = spawnSync("/usr/bin/codesign", ["--force", "--sign", "-", app], {
    encoding: "utf8",
    timeout: 30000,
  });
  if (sign.status !== 0) throw new Error(sign.stderr);
  const state = join(root, "engine");
  mkdirSync(state, { mode: 0o700 });
  const original = Buffer.from(
    '{"version":"0.4.0","sha256":"' +
      "c".repeat(64) +
      '","sourceRevision":"' +
      "d".repeat(40) +
      '"}\n',
  );
  function reset() {
    rmSync(state, { recursive: true, force: true });
    mkdirSync(state, { mode: 0o700 });
    cpSync(app, join(state, "InjectionNext.app"), { recursive: true });
    writeFileSync(join(state, "manifest.json"), original, { mode: 0o600 });
  }
  reset();
  function archive(tampered = false) {
    const staging = join(root, "pack");
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging);
    const copied = join(staging, "InjectionNext.app");
    cpSync(app, copied, { recursive: true });
    if (tampered)
      writeFileSync(
        join(copied, "Contents/Info.plist"),
        readFileSync(join(copied, "Contents/Info.plist"), "utf8").replace(
          "<string>1</string>",
          "<string>2</string>",
        ),
      );
    const path = join(root, "engine.zip");
    rmSync(path, { force: true });
    const zip = spawnSync(
      "/usr/bin/ditto",
      ["-c", "-k", "--sequesterRsrc", "--keepParent", copied, path],
      { encoding: "utf8", timeout: 30000 },
    );
    if (zip.status !== 0) throw new Error(zip.stderr);
    const bytes = readFileSync(path);
    return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
  }
  return {
    root,
    state,
    original,
    archive,
    reset,
    names: () => readdirSync(state).sort(),
    manifest: () => readFileSync(join(state, "manifest.json")),
    hasCurrent: () => existsSync(join(state, "InjectionNext.app/Contents/MacOS/InjectionNext")),
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}
