#!/usr/bin/env python3
import json
import pathlib
import subprocess
import time
import copy
import sys
sys.dont_write_bytecode = True
import preflight

here = pathlib.Path(__file__).resolve().parent
out = here.parents[4] / ".build" / f"objc-frontier-{time.time_ns()}"
out.mkdir(parents=True)
report = {"steps": [], "complete": False}
for name in ["Baseline.swift", "Runner.swift", "Patch.swift.template", "run.py", "preflight.py"]:
    (out / name).write_bytes((here / name).read_bytes())

def run(label, args):
    if args[:2] == ["xcrun", "swiftc"]:
        args = args[:2] + ["-swift-version", "6"] + args[2:]
    result = subprocess.run(args, cwd=out, capture_output=True, text=True, timeout=120)
    (out / (label + ".log")).write_text(result.stdout + result.stderr)
    report["steps"].append({"label": label, "args": args, "exit": result.returncode})
    (out / "report.json").write_text(json.dumps(report, indent=2))
    if result.returncode:
        raise RuntimeError(label + ": " + result.stdout + result.stderr)
    return result.stdout

baseline = out / "libObjCFrontierBaseline.dylib"
run("baseline", ["xcrun", "swiftc", "-emit-library", "-emit-module", "-module-name", "ObjCFrontierBaseline",
    "-enable-private-imports", "-Xfrontend", "-enable-implicit-dynamic", str(here / "Baseline.swift"), "-o", str(baseline)])
patches = []
for generation in [1, 2]:
    source = out / f"Patch{generation}.swift"
    source.write_text((here / "Patch.swift.template").read_text().replace("@GEN@", str(generation)).replace("@OFFSET@", str(generation * 100)))
    library = out / f"Patch{generation}.dylib"
    run(f"patch{generation}", ["xcrun", "swiftc", "-emit-library", "-module-name", f"ObjCFrontierPatch{generation}",
        "-I", str(out), "-L", str(out), "-lObjCFrontierBaseline", "-Xfrontend", "-disable-access-control",
        str(source), "-o", str(library)])
    symbols = run(f"symbols{generation}", ["nm", "-j", "-U", str(library)])
    expected = [{"classSymbol": "_$s20ObjCFrontierBaseline13CallbackProbeCN", "selector": "callback:",
                 "replacementSelector": f"frontier_callback_{generation}:", "encoding": "@24@0:8@16"}]
    metadata = preflight.inventory(library)
    validated = preflight.validate(metadata, expected)
    (out / f"preflight{generation}.json").write_text(json.dumps(validated, indent=2))
    (out / f"expected{generation}.json").write_text(json.dumps(expected, indent=2))
    report[f"generation{generation}"] = {"swiftReplacementRecords": len([s for s in symbols.splitlines() if s.endswith("TX")]),
        "objcReplacements": validated["validatedReplacements"], "artifactSHA256": validated["artifactSHA256"]}
    run(f"otool{generation}", ["otool", "-ov", str(library)])
    negatives = []
    for key, bad in [("classSymbol", "wrong-class"), ("selector", "wrongSelector:"), ("encoding", "v@:")]:
        altered = copy.deepcopy(expected)
        altered[0][key] = bad
        try:
            preflight.validate(metadata, altered)
            raise AssertionError("unsafe metadata admitted")
        except preflight.Rejected:
            negatives.append(key)
    changed_imp = copy.deepcopy(metadata)
    changed_imp["categories"][0]["methods"][0]["implementation"] += 4
    try:
        preflight.validate(changed_imp, expected)
        raise AssertionError("mismatched implementation admitted")
    except preflight.Rejected:
        negatives.append("implementation")
    try:
        preflight.validate(metadata, [])
        raise AssertionError("unapproved selectors admitted")
    except preflight.Rejected:
        negatives.append("unapproved-methods")
    truncated = out / f"truncated{generation}.dylib"
    truncated.write_bytes(library.read_bytes()[:50])
    try:
        preflight.inventory(truncated)
        raise AssertionError("truncated artifact admitted")
    except preflight.Rejected:
        negatives.append("truncated-artifact")
    report[f"generation{generation}"]["negativePreflightChecks"] = negatives
    patches.append(str(library))
runner = out / "runner"
run("runner-build", ["xcrun", "swiftc", "-I", str(out), "-L", str(out), "-lObjCFrontierBaseline",
    "-Xlinker", "-rpath", "-Xlinker", str(out), str(here / "Runner.swift"), "-o", str(runner)])
runtime = run("runtime", [str(runner)] + patches)
report["passedChecks"] = [line[5:] for line in runtime.splitlines() if line.startswith("PASS ")]
print(runtime)
report["complete"] = True
(out / "report.json").write_text(json.dumps(report, indent=2))
print(out)
