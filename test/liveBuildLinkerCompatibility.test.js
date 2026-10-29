import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyLiveBuildLinkerCompatibility } from "../mac-helper/src/liveBuildLinkerCompatibility.js";

const image = "/private/project/App.app/App.debug.dylib";
const hidden = "0000000000001000 (__TEXT,__text) non-external (was a private external) _native_hidden";
const exported = "0000000000001000 (__TEXT,__text) external _native_exported";
const imports = (...rows) => `${image} [arm64]:\n    -imports:\n${rows.join("\n")}`;
const selfImport = (symbol, flags = "") => `  0x0012 ${symbol} ${flags} (from <this-image>)`;

function runner(importOutput, symbolOutput = "", calls = []) {
  return async (command, args, options) => {
    calls.push({ command, args, timeoutMs: options.timeoutMs, cancelPath: options.cancelPath });
    const output = args[0] === "dyld_info" ? importOutput : symbolOutput;
    for (const line of output.split("\n")) options.onLine(line);
    return { code: 0 };
  };
}

test("a strong self-import of a private native definition blocks a Debug install safely", async () => {
  const calls = [];
  await assert.rejects(
    verifyLiveBuildLinkerCompatibility([image], {
      runCommand: runner(imports(selfImport("_native_hidden")), hidden, calls),
      cancelPath: "/private/cancel",
    }),
    (error) => {
      assert.equal(error.code, "LIVE_LINKER_INCOMPATIBLE");
      assert.equal(error.unsafeImportCount, 1);
      assert.match(error.message, /stopped before packaging/);
      assert.match(error.message, /Debug configuration/);
      assert.doesNotMatch(error.message, /\/private\/|_native_hidden/);
      return true;
    },
  );
  assert.deepEqual(calls.map(({ command, args }) => [command, ...args]), [
    ["xcrun", "dyld_info", "-imports", image],
    ["xcrun", "nm", "-arch", "all", "-m", "-U", image],
  ]);
  assert.ok(calls.every(({ timeoutMs, cancelPath }) => timeoutMs === 30_000 && cancelPath === "/private/cancel"));
});

test("resolved self-imports, ordinary dependencies and weak imports are not rejected", async () => {
  const result = await verifyLiveBuildLinkerCompatibility([image], {
    runCommand: runner(imports(
      selfImport("_native_exported"),
      selfImport("_native_hidden", "[weak-import]"),
      "  0x0013 _dependency_symbol (from Foundation)",
    ), `${hidden}\n${exported}`),
  });
  assert.deepEqual(result, { inspectedImages: 1, unsafeImportCount: 0 });
});

test("a symbol exported by a different architecture cannot mask a private self-import", async () => {
  const universalImports = `${imports(selfImport("_native_hidden"))}\n${image} [x86_64]:\n    -imports:\n${selfImport("_native_hidden")}`;
  const symbolOutput = `${image} (for architecture arm64):\n${hidden}\n${image} (for architecture x86_64):\n0000000000001000 (__TEXT,__text) external _native_hidden`;
  await assert.rejects(
    verifyLiveBuildLinkerCompatibility([image], { runCommand: runner(universalImports, symbolOutput) }),
    (error) => error.code === "LIVE_LINKER_INCOMPATIBLE" && error.unsafeImportCount === 1,
  );
});

test("the same name with an external definition in its own slice is resolved", async () => {
  const result = await verifyLiveBuildLinkerCompatibility([image], {
    runCommand: runner(imports(selfImport("_native_hidden")), `${hidden}\n0000000000001010 (__TEXT,__text) external _native_hidden`),
  });
  assert.equal(result.unsafeImportCount, 0);
});

test("an image without self-imports does not run nm or choose a linker", async () => {
  const calls = [];
  await verifyLiveBuildLinkerCompatibility([image], {
    runCommand: runner(imports("  0x0000 _ordinary_import (from Foundation)"), "", calls),
  });
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(calls), /ld-classic|fuse-ld/);
});

test("inspection tool failure cannot expose paths, stderr or raw diagnostics", async () => {
  await assert.rejects(
    verifyLiveBuildLinkerCompatibility([image], {
      runCommand: async () => ({ code: 1, stderr: `secret output ${image}`, error: "private identity" }),
    }),
    (error) => {
      assert.equal(error.code, "LIVE_LINKER_INSPECTION_FAILED");
      assert.doesNotMatch(error.message, /secret|\/private\/|private identity/);
      return true;
    },
  );
});

test("unknown import formats and excessive lines fail closed", async () => {
  for (const output of ["unrecognized tool output", imports("unknown (from <this-image>)"), imports("x".repeat(17 * 1024))]) {
    await assert.rejects(
      verifyLiveBuildLinkerCompatibility([image], { runCommand: runner(output) }),
      { code: "LIVE_LINKER_INSPECTION_FAILED" },
    );
  }
});

test("missing image inputs or incomplete symbol evidence cannot pass inspection", async () => {
  for (const paths of [[], null, [""], [42]]) {
    await assert.rejects(
      verifyLiveBuildLinkerCompatibility(paths, { runCommand: runner(imports()) }),
      { code: "LIVE_LINKER_INSPECTION_FAILED" },
    );
  }
  for (const output of ["", "unrecognized output", "0000000000001000 (__TEXT,__text) external _different"]) {
    await assert.rejects(
      verifyLiveBuildLinkerCompatibility([image], {
        runCommand: runner(imports(selfImport("_native_hidden")), output),
      }),
      { code: "LIVE_LINKER_INSPECTION_FAILED" },
    );
  }
});

test("build cancellation propagates rather than becoming a linker diagnostic", async () => {
  const cancellationError = Object.assign(new Error("cancelled"), { code: "SWIFT_SIM_BUILD_CANCELLED" });
  await assert.rejects(
    verifyLiveBuildLinkerCompatibility([image], {
      runCommand: async () => ({ code: null, cancellationError }),
    }),
    (error) => error === cancellationError,
  );
});

test("large streamed outputs retain a candidate beyond the command runner tail", async () => {
  const filler = "  0x0001 _ordinary_import (from Foundation)\n".repeat(30_000);
  await assert.rejects(
    verifyLiveBuildLinkerCompatibility([image], {
      runCommand: runner(imports(`${selfImport("_native_hidden")}\n${filler}`), `${hidden}\n${"0000000000001000 (__TEXT,__text) external _unrelated\n".repeat(30_000)}`),
    }),
    { code: "LIVE_LINKER_INCOMPATIBLE" },
  );
});

test("managed Debug builds fail before registration or IPA publication; Release preserves its linker settings", {
  skip: process.platform === "win32",
  timeout: 15_000,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-linker-build-"));
  const project = join(directory, "Example.xcodeproj");
  mkdirSync(project);
  writeFileSync(join(project, "project.pbxproj"), "fixture; real target selection is isolated below");
  writeFileSync(join(directory, "xcodebuild"), `#!${process.execPath}\n${fakeXcodeBuild()}`, { mode: 0o700 });
  writeFileSync(join(directory, "xcrun"), `#!${process.execPath}\nconst tool=process.argv[2];if(tool==='dyld_info')console.log('fixture [arm64]:\\n    -imports:\\n  0x0012 _native_hidden (from <this-image>)');else if(tool==='nm')console.log(${JSON.stringify(hidden)});else process.exit(1);`, { mode: 0o700 });
  const core = fileURLToPath(new URL("../mac-helper/src/deviceBuilderCore.js", import.meta.url));
  const live = fileURLToPath(new URL("../mac-helper/src/liveReload.js", import.meta.url));
  try {
    const invocations = [];
    for (const configuration of ["Debug", "Release"]) {
      const root = join(directory, configuration);
      const script = `
        import { mock } from 'node:test';
        import { writeFileSync } from 'node:fs';
        mock.module(${JSON.stringify(live)}, { namedExports: {
          selectedXcodeApplicationTarget: () => ({ source: 'fixture', targetName: 'Example' }),
          selectedTargetHasLivePackage: () => true,
          withLiveBuildSession: async (_options, body) => body({
            liveSession: { started: true, host: 'example.ts.net' },
            registerLiveBuildResult: async () => { writeFileSync(${JSON.stringify(join(root, "registered"))}, 'registered'); return { registered: 1 }; },
          }),
        }});
        const { runDeviceBuild } = await import(${JSON.stringify(core)});
        const build = { id: 'example', project: ${JSON.stringify(project)}, scheme: 'Example', configuration: ${JSON.stringify(configuration)}, buildSettings: ['OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker'], logs: [], artifacts: {root:${JSON.stringify(root)}}, app: {}, signing: {}, preserveData: true };
        let code;
        try { await runDeviceBuild(build); } catch(error) { code = error.code; }
        console.log(JSON.stringify({ state: build.state, ...(code ? {code} : {}), invocations: build.logs.filter(line => line.startsWith('CAPTURE:')).map(line => JSON.parse(line.slice(8))) }));
      `;
      const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      });
      assert.equal(result.status, 0, result.stderr);
      const { invocations: calls, ...outcome } = JSON.parse(result.stdout.trim());
      invocations.push(...calls);
      if (configuration === "Debug") {
        assert.deepEqual(outcome, { state: "failed", code: "LIVE_LINKER_INCOMPATIBLE" });
        assert.equal(existsSync(join(root, "registered")), false);
        assert.equal(existsSync(join(root, "export", "Example.ipa")), false);
      } else {
        assert.equal(outcome.state, "ready");
      }
    }
    const liveBuild = invocations.find((args) => args.includes("build"));
    const archive = invocations.find((args) => args.includes("archive"));
    assert.ok(liveBuild.includes("OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker -Xlinker -interposable"));
    assert.ok(archive.includes("OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker"));
    assert.equal(archive.includes("OTHER_LDFLAGS=$(inherited) -Xlinker -interposable"), false);
    assert.equal(liveBuild.some((arg) => arg.includes("ld-classic")), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeXcodeBuild() {
  return `
    const { mkdirSync, writeFileSync } = require('node:fs');
    const { join } = require('node:path');
    const args = process.argv.slice(2);
    if(!args.includes('-showBuildSettings')) console.log('CAPTURE:' + JSON.stringify(args));
    const option = key => args[args.indexOf(key)+1];
    if(args.includes('-showBuildSettings')) console.log('Build settings for action build and target Example:\\n    PRODUCT_TYPE = com.apple.product-type.application\\n    WRAPPER_EXTENSION = app\\n    PRODUCT_BUNDLE_IDENTIFIER = com.example.fixture\\n    DEVELOPMENT_TEAM = FIXTURE\\n    CURRENT_PROJECT_VERSION = 1');
    else if(args.includes('build')) {
      const app=join(option('-derivedDataPath'),'Build','Products','Debug-iphoneos','Example.app');
      mkdirSync(app,{recursive:true});writeFileSync(join(app,'Example.debug.dylib'),'fixture');
    } else if(args.includes('-exportArchive')) {
      const path=option('-exportPath');mkdirSync(path,{recursive:true});writeFileSync(join(path,'Example.ipa'),'fixture');
    }
  `;
}
