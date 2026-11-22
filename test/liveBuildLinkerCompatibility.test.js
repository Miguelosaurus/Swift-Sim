import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBuffered } from "../mac-helper/src/deviceBuilderCore.js";
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

test("Apple ld can interpose a private alias from a native archive", {
  skip: process.platform !== "darwin",
  timeout: 30_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-native-link-"));
  const xcrun = (...args) => {
    const result = spawnSync("xcrun", args, { cwd: directory, encoding: "utf8", timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  const clang = (...args) => xcrun("--sdk", "iphoneos", "clang", "-arch", "arm64", "-miphoneos-version-min=17.0", ...args);
  try {
    writeFileSync(join(directory, "app.c"), `
      int native_entry(void);
      int app_entry(void) { return native_entry(); }
    `);
    writeFileSync(join(directory, "table.c"), `
      int native_hidden(void);
      __attribute__((used, section("__DATA,__const"))) int (*const table[])(void) = { native_hidden };
      int native_entry(void) { return table[0](); }
    `);
    writeFileSync(join(directory, "alias.c"), String.raw`
      int native_public(void) { return 7; }
      __asm__(".globl _native_hidden\n.private_extern _native_hidden\n.set _native_hidden, _native_public");
    `);
    clang("-c", "app.c", "table.c", "alias.c");
    xcrun("libtool", "-static", "-o", "libnative.a", "table.o", "alias.o");
    const link = (output, ...flags) => clang("-dynamiclib", "app.o", "libnative.a", "-Wl,-dead_strip,-no_deduplicate", ...flags, "-o", output);
    link("plain.dylib");
    link("live.dylib", "-Wl,-interposable");

    const inspect = (image) => verifyLiveBuildLinkerCompatibility([join(directory, image)], { runCommand: runBuffered });
    assert.deepEqual(await inspect("plain.dylib"), { inspectedImages: 1, unsafeImportCount: 0 });
    const actualImports = xcrun("dyld_info", "-imports", "live.dylib");
    const ld = spawnSync("xcrun", ["ld", "-v"], { encoding: "utf8", timeout: 10_000 });
    // Require the reproduction on the affected linker. Other versions may have fixed the defect.
    if (/PROJECT:ld-1267\b/.test(`${ld.stdout}\n${ld.stderr}`) || /_native_hidden\s+\(from <this-image>\)/.test(actualImports)) {
      assert.match(actualImports, /_native_hidden\s+\(from <this-image>\)/);
      await assert.rejects(inspect("live.dylib"), { code: "LIVE_LINKER_INCOMPATIBLE", unsafeImportCount: 1 });
    } else {
      assert.deepEqual(await inspect("live.dylib"), { inspectedImages: 1, unsafeImportCount: 0 });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("managed Debug retries only confirmed unsafe imports and checks the archive before export", {
  skip: process.platform !== "darwin",
  timeout: 30_000,
}, () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-linker-build-"));
  const project = join(directory, "Example.xcodeproj");
  mkdirSync(project);
  writeFileSync(join(project, "project.pbxproj"), "fixture; real target selection is isolated below");
  writeFileSync(join(directory, "xcodebuild"), `#!${process.execPath}\n${fakeXcodeBuild()}`, { mode: 0o700 });
  const rustSymbol = "__ZN41_$LT$T$u20$as$u20$serde..de..Expected$GT$3fmt17h0bf58741e48d5cbcE";
  writeFileSync(join(directory, "xcrun"), `#!${process.execPath}\n${fakeLinkerInspection(rustSymbol)}`, { mode: 0o700 });
  const core = fileURLToPath(new URL("../mac-helper/src/deviceBuilderCore.js", import.meta.url));
  const live = fileURLToPath(new URL("../mac-helper/src/liveReload.js", import.meta.url));
  try {
    for (const scenario of ["clean-archive", "unsafe-archive", "inspection-failed", "release"]) {
      const configuration = scenario === "release" ? "Release" : "Debug";
      const root = join(directory, scenario);
      const script = `
        import { mock } from 'node:test';
        import { writeFileSync } from 'node:fs';
        mock.module(${JSON.stringify(live)}, { namedExports: {
          liveProjectTargetFromSettings: (_project, settings) => {
            if (settings.PRODUCT_BUNDLE_IDENTIFIER !== 'com.example.fixture') throw Error('resolved settings required before live eligibility');
            return { source: 'fixture', targetName: 'Example' };
          },
          selectedTargetHasLivePackage: () => true,
          withLiveBuildSession: async (_options, body) => body({
            liveSession: { started: true, host: 'example.ts.net' },
            registerLiveBuildResult: async () => { writeFileSync(${JSON.stringify(join(root, "registered"))}, 'registered'); return { registered: 1 }; },
          }),
        }});
        const { runDeviceBuild, publicDeviceBuild } = await import(${JSON.stringify(core)});
        const build = { id: 'example', project: ${JSON.stringify(project)}, scheme: 'Example', configuration: ${JSON.stringify(configuration)}, buildSettings: ['OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker', 'CUSTOM_SETTING=keep'], logs: [], artifacts: {root:${JSON.stringify(root)}}, app: {}, signing: {}, preserveData: true };
        let code;
        try { await runDeviceBuild(build, { nextBuildNumber: () => '2' }); } catch(error) { code = error.code; }
        const { state, app, signing, preserveData, liveReload } = publicDeviceBuild(build);
        console.log(JSON.stringify({ state, code, app, signing, preserveData, liveReload, logs: build.logs,
          invocations: build.logs.filter(line => line.startsWith('CAPTURE:')).map(line => JSON.parse(line.slice(8))) }));
      `;
      const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, LINKER_FIXTURE_SCENARIO: scenario },
      });
      assert.equal(result.status, 0, result.stderr);
      const { invocations, state, code, app, signing, preserveData, liveReload, logs } = JSON.parse(result.stdout.trim());
      const actions = invocations.map((args) => args.includes("-exportArchive") ? "export" : args.at(-1));
      const expected = {
        "clean-archive": { state: "ready", actions: ["build", "archive", "export"] },
        "unsafe-archive": { state: "failed", actions: ["build", "archive"], code: "LIVE_LINKER_INCOMPATIBLE" },
        "inspection-failed": { state: "failed", actions: ["build"], code: "LIVE_LINKER_INSPECTION_FAILED" },
        release: { state: "ready", actions: ["archive", "export"] },
      }[scenario];
      assert.deepEqual({ state, actions, ...(code ? { code } : {}) }, expected, scenario);
      assert.equal(existsSync(join(root, "registered")), false);
      assert.equal(existsSync(join(root, "export", "Example.ipa")), state === "ready");

      const liveBuild = invocations.find((args) => args.includes("build"));
      if (liveBuild) {
        assert.ok(liveBuild.includes("OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker -Xlinker -interposable"));
        assert.equal(liveBuild.some((arg) => arg.includes("ld-classic")), false);
      }
      const archive = invocations.find((args) => args.includes("archive"));
      if (archive) {
        assert.ok(archive.includes(configuration));
        assert.ok(archive.includes("CURRENT_PROJECT_VERSION=2"));
        assert.ok(archive.includes("CUSTOM_SETTING=keep"));
        assert.deepEqual(archive.filter((arg) => arg.startsWith("OTHER_LDFLAGS=")), ["OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker"]);
        assert.equal(archive.some((arg) => /enable-implicit-dynamic|ENABLE_DEBUG_DYLIB|SWIFT_OPTIMIZATION_LEVEL/.test(arg)), false);
      }
      if (scenario === "clean-archive") {
        assert.equal(app.bundleIdentifier, "com.example.fixture");
        assert.equal(app.teamID, "FIXTURE");
        assert.equal(app.build, "2");
        assert.equal(signing.updateSafe, "same-bundle-update");
        assert.equal(preserveData, true);
        assert.equal(liveReload.eligible, false);
        assert.equal(liveReload.compilerReady, false);
        assert.match(liveReload.error, /Hot reload is unavailable/);
        assert.ok(logs.includes("The signed Debug archive passed the linker compatibility check."));
      }
    }
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
    if(args.includes('-showBuildSettings')) console.log('Build settings for action build and target Example:\\n    PRODUCT_TYPE = com.apple.product-type.application\\n    WRAPPER_EXTENSION = app\\n    FULL_PRODUCT_NAME = Example.app\\n    PRODUCT_BUNDLE_IDENTIFIER = com.example.fixture\\n    DEVELOPMENT_TEAM = FIXTURE\\n    CURRENT_PROJECT_VERSION = 1');
    else if(args.includes('build')) {
      const app=join(option('-derivedDataPath'),'Build','Products','Debug-iphoneos','Example.app');
      mkdirSync(app,{recursive:true});writeFileSync(join(app,'Example.debug.dylib'),'fixture');
    } else if(args.includes('archive')) {
      const app=join(option('-archivePath'),'Products','Applications','Example.app');
      mkdirSync(app,{recursive:true});
      writeFileSync(join(app,'Info.plist'),'<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.example.fixture</string><key>CFBundleExecutable</key><string>Example</string></dict></plist>');
      writeFileSync(join(app,'Example'),'fixture');
      writeFileSync(join(app,'Example.debug.dylib'),'fixture');
    } else if(args.includes('-exportArchive')) {
      const path=option('-exportPath');mkdirSync(path,{recursive:true});writeFileSync(join(path,'Example.ipa'),'fixture');
    }
  `;
}

function fakeLinkerInspection(symbol) {
  return `
    const [tool, ...args] = process.argv.slice(2);
    const image = args.at(-1);
    const scenario = process.env.LINKER_FIXTURE_SCENARIO;
    const unsafe = image.endsWith('.debug.dylib') && (!image.includes('.xcarchive/') || scenario === 'unsafe-archive');
    if (scenario === 'inspection-failed') process.exit(1);
    if (tool === 'dyld_info') {
      console.log('fixture [arm64]:\\n    -imports:');
      if (unsafe) console.log(${JSON.stringify(selfImport(symbol))});
    } else if (tool === 'nm' && unsafe) console.log(${JSON.stringify(hidden.replace("_native_hidden", symbol))});
    else process.exit(1);
  `;
}
