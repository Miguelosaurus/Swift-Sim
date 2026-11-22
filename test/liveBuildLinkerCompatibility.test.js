import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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

test("a private external retained in the symbol table cannot resolve a self-import", async () => {
  const privateExternal = "0000000000001000 (__TEXT,__text) private external _native_hidden";
  await assert.rejects(
    verifyLiveBuildLinkerCompatibility([image], { runCommand: runner(imports(selfImport("_native_hidden")), privateExternal) }),
    { code: "LIVE_LINKER_INCOMPATIBLE", unsafeImportCount: 1 },
  );
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

test("the scoped driver keeps app interposition and excludes a native archive's private alias", {
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
      int app_consumer(void) { return app_entry(); }
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

    const output = join(directory, "App.app", "App.debug.dylib");
    mkdirSync(dirname(output));
    const driver = scopedDriver(directory, "App.debug.dylib");
    const filelist = join(directory, "App.LinkFileList");
    writeFileSync(filelist, `${join(directory, "app.o")}\n${join(directory, "libnative.a")}\n`);
    const scoped = spawnSync(driver, ["-arch", "arm64", "-miphoneos-version-min=17.0", "-isysroot", xcrun("--sdk", "iphoneos", "--show-sdk-path").trim(),
      "-dynamiclib", "-filelist", filelist, "-Wl,-dead_strip,-interposable,-no_deduplicate", "-o", output], { cwd: directory, encoding: "utf8", timeout: 10_000 });
    assert.equal(scoped.status, 0, scoped.stderr);
    const scopedImports = xcrun("dyld_info", "-imports", output);
    assert.match(scopedImports, /_app_entry\s+\(from <this-image>\)/);
    assert.doesNotMatch(scopedImports, /_native_(?:entry|hidden)\s+\(from <this-image>\)/);

    const inspect = (image) => verifyLiveBuildLinkerCompatibility([join(directory, image)], { runCommand: runBuffered });
    assert.deepEqual(await inspect("plain.dylib"), { inspectedImages: 1, unsafeImportCount: 0 });
    assert.deepEqual(await inspect(output.slice(directory.length + 1)), { inspectedImages: 1, unsafeImportCount: 0 });
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

test("managed Debug requires the scoped link and a passing guard before registration or packaging", {
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
    for (const scenario of ["unsafe-image", "inspection-failed", "scope-missing", "engine-unavailable", "release"]) {
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
            liveSession: { started: ${scenario !== "engine-unavailable"}, host: 'example.ts.net' },
            registerLiveBuildResult: async () => { writeFileSync(${JSON.stringify(join(root, "registered"))}, 'registered'); return { registered: 1 }; },
          }),
        }});
        const { runDeviceBuild } = await import(${JSON.stringify(core)});
        const build = { id: 'example', project: ${JSON.stringify(project)}, scheme: 'Example', configuration: ${JSON.stringify(configuration)}, buildSettings: ['OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker', 'CUSTOM_SETTING=keep'], logs: [], artifacts: {root:${JSON.stringify(root)}}, app: {}, signing: {}, preserveData: true };
        let code;
        try { await runDeviceBuild(build, { nextBuildNumber: () => '2' }); } catch(error) { code = error.code; }
        console.log(JSON.stringify({ state: build.state, code,
          invocations: build.logs.filter(line => line.startsWith('CAPTURE:')).map(line => JSON.parse(line.slice(8))) }));
      `;
      const result = spawnSync(process.execPath, ["--experimental-test-module-mocks", "--input-type=module", "-e", script], {
        encoding: "utf8", timeout: 10_000,
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}`, LINKER_FIXTURE_SCENARIO: scenario },
      });
      assert.equal(result.status, 0, result.stderr);
      const { invocations, state, code } = JSON.parse(result.stdout.trim());
      const actions = invocations.map((args) => args.includes("-exportArchive") ? "export" : args.at(-1));
      const expected = {
        "unsafe-image": { state: "failed", actions: ["build"], code: "LIVE_LINKER_INCOMPATIBLE" },
        "inspection-failed": { state: "failed", actions: ["build"], code: "LIVE_LINKER_INSPECTION_FAILED" },
        "scope-missing": { state: "failed", actions: ["build"], code: "LIVE_LINKER_SCOPE_FAILED" },
        "engine-unavailable": { state: "failed", actions: [], code: "LIVE_BUILD_ENGINE_UNAVAILABLE" },
        release: { state: "ready", actions: ["archive", "export"] },
      }[scenario];
      assert.deepEqual({ state, actions, ...(code ? { code } : {}) }, expected, scenario);
      assert.equal(existsSync(join(root, "registered")), false);
      assert.equal(existsSync(join(root, "export", "Example.ipa")), state === "ready");

      const liveBuild = invocations.find((args) => args.includes("build"));
      if (liveBuild) {
        assert.ok(liveBuild.includes("OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker"));
        assert.ok(liveBuild.includes(`LD=${join(root, "live-linker", "clang")}`));
        assert.ok(liveBuild.includes(`LDPLUSPLUS=${join(root, "live-linker", "clang++")}`));
        assert.equal(liveBuild.some((arg) => arg.includes("-interposable")), false);
      }
      const archive = invocations.find((args) => args.includes("archive"));
      if (archive) {
        assert.ok(archive.includes(configuration));
        assert.ok(archive.includes("CURRENT_PROJECT_VERSION=2"));
        assert.ok(archive.includes("CUSTOM_SETTING=keep"));
        assert.deepEqual(archive.filter((arg) => arg.startsWith("OTHER_LDFLAGS=")), ["OTHER_LDFLAGS=$(inherited) -fuse-ld=custom-debug-linker"]);
        assert.equal(archive.some((arg) => /enable-implicit-dynamic|ENABLE_DEBUG_DYLIB|SWIFT_OPTIMIZATION_LEVEL/.test(arg)), false);
      }
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeXcodeBuild() {
  return `
    const { mkdirSync, realpathSync, writeFileSync } = require('node:fs');
    const { dirname, join } = require('node:path');
    const args = process.argv.slice(2);
    if(!args.includes('-showBuildSettings')) console.log('CAPTURE:' + JSON.stringify(args));
    const option = key => args[args.indexOf(key)+1];
    if(args.includes('-showBuildSettings')) console.log('Build settings for action build and target Example:\\n    PRODUCT_TYPE = com.apple.product-type.application\\n    WRAPPER_EXTENSION = app\\n    FULL_PRODUCT_NAME = Example.app\\n    WRAPPER_NAME = Example.app\\n    EXECUTABLE_NAME = Example\\n    PRODUCT_MODULE_NAME = Example\\n    PRODUCT_BUNDLE_IDENTIFIER = com.example.fixture\\n    DEVELOPMENT_TEAM = FIXTURE\\n    CURRENT_PROJECT_VERSION = 1');
    else if(args.includes('build')) {
      const app=join(option('-derivedDataPath'),'Build','Products','Debug-iphoneos','Example.app');
      const image = join(app,'Example.debug.dylib');
      mkdirSync(app,{recursive:true});writeFileSync(image,'fixture');
      if(process.env.LINKER_FIXTURE_SCENARIO !== 'scope-missing') {
        const linker = args.find(arg => arg.startsWith('LD=')).slice(3);
        writeFileSync(join(dirname(linker),'scoped-output'),realpathSync(image));
      }
    } else if(args.includes('-exportArchive')) {
      const path=option('-exportPath');mkdirSync(path,{recursive:true});writeFileSync(join(path,'Example.ipa'),'fixture');
    }
  `;
}

test("a scoped Swift image loads replacements for functions, accessors and protocol witnesses", {
  skip: process.platform !== "darwin",
  timeout: 45_000,
}, async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-scoped-patch-"));
  const run = (command, ...args) => {
    const result = spawnSync(command, args, { cwd: directory, encoding: "utf8", timeout: 20_000 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    return result.stdout;
  };
  const swift = (...args) => run("xcrun", "swiftc", ...args);
  try {
    writeFileSync(join(directory, "App.swift"), `
      public func count() -> Int { 7 }
      public var score: Int { 8 }
      public protocol Scoring { func current() -> Int }
      public struct Baseline: Scoring {
          public init() {}
          public func current() -> Int { 9 }
      }
      public func appValue() -> [Int] {
          let instance: any Scoring = Baseline()
          return [count(), score, instance.current()]
      }
    `);
    writeFileSync(join(directory, "Patch.swift"), `
      import App
      @_dynamicReplacement(for: count()) func patchedCount() -> Int { 17 }
      @_dynamicReplacement(for: score) var patchedScore: Int { 18 }
      extension Baseline {
          @_dynamicReplacement(for: current()) func patchedCurrent() -> Int { 19 }
      }
    `);
    writeFileSync(join(directory, "Host.swift"), `
      import App
      import Darwin
      print(appValue())
      guard dlopen(CommandLine.arguments[1], RTLD_NOW | RTLD_LOCAL) != nil else {
          fatalError(String(cString: dlerror()))
      }
      print(appValue())
    `);
    swift("-Onone", "-Xfrontend", "-enable-implicit-dynamic", "-enable-library-evolution", "-parse-as-library", "-emit-object",
      "-emit-module", "-emit-module-path", "App.swiftmodule", "-module-name", "App", "App.swift", "-o", "App.o");
    const outputDirectory = join(directory, "App.app");
    const output = join(outputDirectory, "libApp.debug.dylib");
    const filelist = join(directory, "App.LinkFileList");
    mkdirSync(outputDirectory);
    writeFileSync(filelist, `${join(directory, "App.o")}\n`);
    const driver = scopedDriver(directory, "libApp.debug.dylib");
    const runtimeLibrary = join(dirname(run("xcrun", "--find", "swiftc").trim()), "../lib/swift/macosx");
    run(driver, "-dynamiclib", "-filelist", filelist, "-L", runtimeLibrary, "-lswiftCore", "-install_name", "@rpath/libApp.debug.dylib", "-o", output);
    assert.deepEqual(await verifyLiveBuildLinkerCompatibility([output], { runCommand: runBuffered }), { inspectedImages: 1, unsafeImportCount: 0 });

    swift("-Onone", "-emit-library", "-I", ".", "-L", outputDirectory, "-lApp.debug", "Patch.swift", "-o", "Patch.dylib");
    swift("-I", ".", "-L", outputDirectory, "-lApp.debug", "-Xlinker", "-rpath", "-Xlinker", outputDirectory, "Host.swift", "-o", "Host");
    assert.equal(run(join(directory, "Host"), join(directory, "Patch.dylib")).trim(), "[7, 8, 9]\n[17, 18, 19]");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function scopedDriver(directory, image) {
  const root = join(directory, "driver");
  mkdirSync(root);
  writeFileSync(join(root, "target.json"), JSON.stringify({ image, wrapper: "App.app", drivers: {} }));
  const wrapper = join(root, "clang");
  copyFileSync(new URL("../mac-helper/resources/ManagedLiveLinker.py", import.meta.url), wrapper);
  chmodSync(wrapper, 0o700);
  return wrapper;
}

function fakeLinkerInspection(symbol) {
  return `
    const [tool, ...args] = process.argv.slice(2);
    const image = args.at(-1);
    const scenario = process.env.LINKER_FIXTURE_SCENARIO;
    const unsafe = image.endsWith('.debug.dylib') && scenario === 'unsafe-image';
    if (scenario === 'inspection-failed') process.exit(1);
    if (tool === 'dyld_info') {
      console.log('fixture [arm64]:\\n    -imports:');
      if (unsafe) console.log(${JSON.stringify(selfImport(symbol))});
    } else if (tool === 'nm' && unsafe) console.log(${JSON.stringify(hidden.replace("_native_hidden", symbol))});
    else process.exit(1);
  `;
}
