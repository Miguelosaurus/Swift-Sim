#!/usr/bin/python3
"""Task-owned Swift frontend shim. Never resident; preserves Xcode's scheduler."""
import fcntl
import hashlib
import json
import os
import shlex
import subprocess
import sys
import tempfile


def digest(data):
    return hashlib.sha256(data).hexdigest()


def execute(executable, args):
    if os.path.basename(executable) == "swift-frontend" and "-c" in args:
        # Preserve the ordinary complete frontend map, including dependencies.
        sys.stderr.write(shlex.join([executable] + args) + "\n")
        sys.stderr.flush()
    os.execv(executable, [executable] + args)


def expand(args, depth=0):
    if depth > 4:
        raise ValueError("response nesting")
    result = []
    for arg in args:
        if arg.startswith("@") and os.path.isfile(arg[1:]):
            with open(arg[1:], "r") as handle:
                text = handle.read(8 * 1024 * 1024 + 1)
            if len(text) > 8 * 1024 * 1024:
                raise ValueError("response size")
            result.extend(expand(shlex.split(text), depth + 1))
        else:
            result.append(arg)
    return result


def main():
    directory = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(directory, "manifest.json"), "rb") as handle:
        encoded = handle.read(8 * 1024 * 1024)
    manifest = json.loads(encoded)
    compiler = manifest["compilerPath"]
    original = sys.argv[1:]
    args = expand(original)
    frontend = "-frontend" in args
    executable = os.path.join(os.path.dirname(compiler), "swift-frontend") if frontend else compiler
    module = args[args.index("-module-name") + 1] if "-module-name" in args else ""
    debug = "-DDEBUG" in args or any(args[i:i + 2] == ["-D", "DEBUG"] for i in range(len(args)))
    if module != manifest["moduleName"] or not debug or "-scan-dependencies" in args:
        execute(executable, original)
    manifest_digest = digest(encoded)
    usage_path = os.path.join(directory, "usage.json")
    # Concurrent architecture invocations cannot disagree about whether source
    # was transformed. An absent SDK API leaves the entire build on legacy mode.
    with open(os.path.join(directory, "usage.lock"), "a") as lock:
        os.chmod(lock.name, 0o600)
        fcntl.flock(lock, fcntl.LOCK_EX)
        if os.path.exists(usage_path):
            with open(usage_path) as handle:
                usage = json.load(handle)
            if usage["manifestDigest"] != manifest_digest:
                raise ValueError("changed compiler manifest")
        else:
            flags = []
            paired = {"-sdk", "-target", "-I", "-F", "-module-cache-path", "-resource-dir", "-swift-version", "-Xcc", "-package-name"}
            i = 0
            while i < len(args):
                arg = args[i]
                if arg in paired and i + 1 < len(args):
                    # Explicit dependency jobs carry PCM-only suppression flags.
                    # The tiny independent API probe uses normal module imports.
                    if arg != "-Xcc" or args[i + 1].startswith(("-fmodule-map-file=", "-I", "-F", "-isystem")):
                        flags.extend(args[i:i + 2])
                    i += 2
                else:
                    if arg.startswith(("-I", "-F")) and len(arg) > 2:
                        flags.append(arg)
                    i += 1
            probe = "import SwiftSimLive\n@MainActor func check() { _ = SwiftSimLive.SwiftSimRefresh() }\n"
            result = subprocess.run([compiler, "-typecheck", "-DDEBUG"] + flags + ["-"], input=probe.encode(),
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
            usage = {"version": 1, "manifestDigest": manifest_digest, "moduleName": module, "active": result.returncode == 0}
            fd, path = tempfile.mkstemp(dir=directory)
            with os.fdopen(fd, "w") as handle:
                json.dump(usage, handle); handle.flush(); os.fsync(handle.fileno())
            os.replace(path, usage_path)
        active = usage["active"]
    if active:
        with open(manifest["overlayPath"], "rb") as handle:
            if digest(handle.read()) != manifest["overlayDigest"]:
                raise ValueError("changed compiler overlay")
        original = original + ["-vfsoverlay", manifest["overlayPath"]]
    execute(executable, original)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        sys.stderr.write("Swift Sim could not verify its private Debug compiler inputs. Retry the build.\n")
        sys.exit(1)
