#!/usr/bin/env python3
"""Compile/load a Debug-only, versioned native state-sidecar prototype.

No app, simulator, signing, network, stable source or installed service mutation.
Temporary binaries are deleted; --receipt retains exact bounded diagnostics.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument("--receipt", type=Path)
parser.add_argument("--sdk-source", type=Path, help="Optional local InjectionNext checkout for exact-source Release exclusion checks")
args = parser.parse_args()
source = Path(__file__).resolve().parent
receipt = {"kind": "host-native-state-prototype", "physicalDevice": False, "commands": []}

def run(command):
    result = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90)
    receipt["commands"].append({"argv": [str(value) for value in command], "status": result.returncode, "output": result.stdout[-16000:]})
    if result.returncode:
        raise RuntimeError(result.stdout)
    return result.stdout

try:
    receipt["compiler"] = run(["xcrun", "swiftc", "--version"])
    with tempfile.TemporaryDirectory(prefix="swift-sim-state-frontier-") as temporary:
        root = Path(temporary)
        compiler = ["xcrun", "swiftc", "-swift-version", "5", "-module-cache-path", str(root / "modules")]
        gate = ["-DDEBUG", "-DSWIFT_SIM_EXPERIMENTAL_STATE"]
        run(compiler + gate + ["-emit-library", "-emit-module", "-module-name", "FrontierStateBootstrap", str(source / "Bootstrap.swift"), "-emit-module-path", str(root / "FrontierStateBootstrap.swiftmodule"), "-o", str(root / "libFrontierStateBootstrap.dylib")])
        linking = ["-I", str(root), "-L", str(root), "-lFrontierStateBootstrap", "-Xlinker", "-rpath", "-Xlinker", str(root)]
        for version, define in [("v2", []), ("v3", ["-DFRONTIER_V3"]), ("v4", ["-DFRONTIER_V4"]), ("failure", ["-DFRONTIER_FAIL"])]:
            run(compiler + gate + define + ["-emit-library", "-module-name", "FrontierState_" + version] + linking + [str(source / "Component.swift"), "-o", str(root / ("lib" + version + ".dylib"))])
        run(compiler + gate + linking + [str(source / "Host.swift"), "-o", str(root / "host")])
        receipt["native"] = run([str(root / "host"), str(root)])
        assert "FRONTIER_STATE_PASS" in receipt["native"] and "FRONTIER_RESTORATION_PASS" in receipt["native"]
        # Both missing gates must remove the bridge and plugin entrypoints.
        for name, flags in [("release", []), ("debug_without_capability", ["-DDEBUG"]), ("release_with_capability", ["-DSWIFT_SIM_EXPERIMENTAL_STATE"])]:
            library = root / (name + ".dylib")
            run(compiler + flags + ["-emit-library", "-module-name", name, str(source / "Bootstrap.swift"), str(source / "Component.swift"), "-o", str(library)])
            symbols = run(["nm", "-g", str(library)])
            assert "FrontierRegistry" not in symbols and "frontier_install" not in symbols
            executable = root / name
            run(compiler + flags + [str(source / "Host.swift"), "-o", str(executable)])
            assert run([str(executable)]).strip() == "FRONTIER_RELEASE_INERT"
            assert "_dlopen" not in run(["nm", "-u", str(executable)])
        receipt["releaseExclusion"] = ["release", "debug_without_capability", "release_with_capability"]
        repository = source.parents[3]
        live_sources = sorted((repository / "Sources" / "SwiftSimLive").glob("*.swift"))
        assert live_sources
        library = root / "actual-swift-sim-release.dylib"
        run(compiler + ["-DSWIFT_PACKAGE", "-emit-library", "-module-name", "ActualSwiftSimLiveRelease"] + [str(path) for path in live_sources] + ["-o", str(library)])
        symbols = run(["nm", "-g", str(library)])
        for forbidden in ["InjectionSet", "SwiftSimLiveObserver", "SwiftSimDeliveryFeedback", "_dlopen", "_connect", "_socket"]:
            assert forbidden not in symbols, forbidden
        receipt["actualSwiftSimLiveRelease"] = {"sourceFiles": [path.name for path in live_sources], "activeBridgeSymbolsAbsent": True}
        if args.sdk_source:
            sdk = args.sdk_source.resolve()
            sdk_sources = sorted((sdk / "Sources" / "InjectionNext").rglob("*.swift"))
            assert sdk_sources
            sdk_library = root / "actual-sdk-release.dylib"
            run(compiler + ["-DSWIFT_PACKAGE", "-DDEBUG_ONLY", "-emit-library", "-module-name", "ActualInjectionBundleRelease"] + [str(path) for path in sdk_sources] + ["-o", str(sdk_library)])
            sdk_symbols = run(["nm", "-g", str(sdk_library)])
            for forbidden in ["_dlopen", "InjectionSet", "InjectionNext", "SimpleSocket", "_connect", "_socket"]:
                assert forbidden not in sdk_symbols, forbidden
            native = sorted((sdk / "Sources" / "InjectionNextC").glob("*.mm"))
            assert native
            for path in native:
                obj = root / (path.stem + "-release.o")
                run(["xcrun", "clang++", "-DSWIFT_PACKAGE=1", "-DDEBUG_ONLY=1", "-c", str(path), "-o", str(obj)])
                assert not run(["nm", "-g", str(obj)]).strip()
            receipt["actualSdkRelease"] = {"swiftFiles": len(sdk_sources), "nativeFiles": len(native), "activeBridgeSymbolsAbsent": True}
        receipt["passed"] = True
finally:
    if args.receipt:
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(receipt, indent=2) + "\n")
        os.chmod(args.receipt, 0o600)
print(json.dumps({key: value for key, value in receipt.items() if key != "commands"}, indent=2))
