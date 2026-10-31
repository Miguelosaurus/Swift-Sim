#!/usr/bin/env python3
"""Host-native experiment, never invoked by production delivery or release builds."""
import argparse
import hashlib
import json
import pathlib
import subprocess
import time

HERE = pathlib.Path(__file__).resolve().parent
REPO = HERE.parents[3]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=pathlib.Path)
    parser.add_argument("--swift-version", choices=["5", "6"], default="6")
    args = parser.parse_args()
    out = (args.output or REPO / ".build" / f"async-frontier-{time.time_ns()}").resolve()
    out.mkdir(parents=True, exist_ok=False)
    report = {"schema": 1, "scope": "macOS host native only", "swiftVersion": args.swift_version,
              "steps": [], "complete": False}
    report["sourceSHA256"] = {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                              for p in HERE.iterdir() if p.is_file()}
    for name in ["Baseline.swift", "Runner.swift", "Patch.swift.template", "run.py"]:
        (out / name).write_bytes((HERE / name).read_bytes())
    expected_replacements = (out / "Patch.swift.template").read_text().count("@_dynamicReplacement(")

    def command(label, argv, expected=0):
        if argv[:2] == ["xcrun", "swiftc"] and "--version" not in argv:
            argv = argv[:2] + ["-swift-version", args.swift_version] + argv[2:]
        result = subprocess.run(argv, cwd=out, text=True, stdout=subprocess.PIPE,
                                stderr=subprocess.STDOUT, timeout=120)
        (out / f"{label}.log").write_text(result.stdout)
        report["steps"].append({"label": label, "arguments": argv, "exit": result.returncode,
                                 "expected": expected, "log": f"{label}.log"})
        (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
        if expected is not None and result.returncode != expected:
            raise RuntimeError(f"{label} returned {result.returncode}: {result.stdout[-6000:]}")
        return result.stdout

    baseline = out / "libAsyncFrontierBaseline.dylib"
    command("toolchain", ["xcrun", "swiftc", "--version"])
    command("baseline", ["xcrun", "swiftc", "-emit-library", "-emit-module",
        "-module-name", "AsyncFrontierBaseline", "-enable-private-imports",
        "-Xfrontend", "-enable-implicit-dynamic", str(out / "Baseline.swift"), "-o", str(baseline)])
    patches = []
    for generation in [1, 2]:
        source = out / f"Patch{generation}.swift"
        source.write_text((HERE / "Patch.swift.template").read_text()
                          .replace("@GEN@", str(generation)).replace("@OFFSET@", str(generation * 100)))
        patch = out / f"Patch{generation}.dylib"
        command(f"patch{generation}", ["xcrun", "swiftc", "-emit-library", "-module-name",
            f"AsyncFrontierPatch{generation}", "-I", str(out), "-L", str(out),
            "-lAsyncFrontierBaseline", "-Xfrontend", "-disable-access-control", str(source), "-o", str(patch)])
        symbols = command(f"symbols{generation}", ["nm", "-j", "-U", str(patch)])
        report[f"patch{generation}ReplacementSymbols"] = [s for s in symbols.splitlines() if s.endswith("TX")]
        if len(report[f"patch{generation}ReplacementSymbols"]) != expected_replacements:
            raise RuntimeError("Incomplete replacement record set; no library has been loaded")
        patches.append(patch)
    runner = out / "runner"
    command("runner-build", ["xcrun", "swiftc", "-parse-as-library", "-I", str(out), "-L", str(out),
        "-lAsyncFrontierBaseline", "-Xlinker", "-rpath", "-Xlinker", str(out),
        str(out / "Runner.swift"), "-o", str(runner)])
    result = command("runtime", [str(runner)] + [str(p) for p in patches])
    report["passedChecks"] = [line[5:] for line in result.splitlines() if line.startswith("PASS ")]
    negatives = {
        "parameter-type": "extension AsyncProbe { @_dynamicReplacement(for: work(_:scale:)) private func bad(_ input: String, scale: Int) async throws -> Int { 0 } }",
        "return-type": "extension AsyncProbe { @_dynamicReplacement(for: work(_:scale:)) private func bad(_ input: Int, scale: Int) async throws -> String { \"bad\" } }",
        "async-removed": "extension AsyncProbe { @_dynamicReplacement(for: work(_:scale:)) private func bad(_ input: Int, scale: Int) throws -> Int { 0 } }",
        "throws-removed": "extension AsyncProbe { @_dynamicReplacement(for: work(_:scale:)) private func bad(_ input: Int, scale: Int) async -> Int { 0 } }",
        "generic-narrowed": "extension AsyncProbe { @_dynamicReplacement(for: generic(_:)) private func bad<T: FixedWidthInteger & Sendable>(_ input: T) async -> T { input } }",
        "actor-isolation-removed": "extension ActorProbe { @_dynamicReplacement(for: advance(_:)) nonisolated private func bad(_ input: Int) async -> Int { 0 } }",
        "main-actor-isolation-removed": "extension MainProbe { @_dynamicReplacement(for: advance(_:)) nonisolated private func bad(_ input: Int) async -> Int { 0 } }",
    }
    report["signatureProbes"] = {}
    for label, source_text in negatives.items():
        source = out / f"negative-{label}.swift"
        source.write_text("import AsyncFrontierBaseline\n" + source_text + "\n")
        command(f"negative-{label}", ["xcrun", "swiftc", "-emit-library", "-module-name", "NegativeProbe",
            "-I", str(out), "-L", str(out), "-lAsyncFrontierBaseline", str(source),
            "-o", str(out / f"negative-{label}.dylib")], expected=None)
        report["signatureProbes"][label] = {"compilerRejected": report["steps"][-1]["exit"] != 0,
                                            "loaded": False, "admissible": False}
    # A declaration-shaped input can compile successfully without creating a replacement.
    # Reproduce this failure without admitting the incomplete image to the runtime.
    incomplete = out / "incomplete-subscript.swift"
    incomplete.write_text("""@_private(sourceFile: "Baseline.swift") import AsyncFrontierBaseline
extension AsyncProbe {
    @_dynamicReplacement(for: subscript(_:))
    private subscript(_ index: Int) -> Int { get async { index + 100 } }
}
""")
    incomplete_library = out / "incomplete-subscript.dylib"
    command("incomplete-subscript", ["xcrun", "swiftc", "-emit-library", "-module-name", "IncompleteSubscript",
        "-I", str(out), "-L", str(out), "-lAsyncFrontierBaseline", "-Xfrontend", "-disable-access-control",
        str(incomplete), "-o", str(incomplete_library)])
    incomplete_symbols = command("incomplete-subscript-symbols", ["nm", "-j", "-U", str(incomplete_library)])
    report["incompleteSubscript"] = {"compiled": True, "expectedRecords": 1,
        "actualRecords": len([s for s in incomplete_symbols.splitlines() if s.endswith("TX")]),
        "loaded": False}
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    expected_rejections = {label: label not in ["generic-narrowed", "main-actor-isolation-removed"]
                           for label in negatives}
    if any(report["signatureProbes"][label]["compilerRejected"] != expected
           for label, expected in expected_rejections.items()):
        raise RuntimeError("Compiler signature behavior differs from recorded toolchain; inspect negative logs")
    if report["incompleteSubscript"]["actualRecords"] != 0:
        raise RuntimeError("Compiler subscript behavior changed; requalify the negative experiment")
    report["complete"] = "COMPLETE native async replacement proof" in result
    (out / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"output": str(out), "complete": report["complete"],
                      "passedChecks": len(report["passedChecks"]),
                      "replacementSymbols": [len(report[f"patch{g}ReplacementSymbols"]) for g in [1, 2]]}))


if __name__ == "__main__":
    main()
