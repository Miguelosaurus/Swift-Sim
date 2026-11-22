#!/usr/bin/python3
"""Scope the managed app Debug dylib's interposable symbols at link time."""
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile


def expand_response_files(args, depth=0):
    if depth > 4:
        raise ValueError("nested linker response files")
    for arg in args:
        if arg.startswith("@") and os.path.isfile(arg[1:]):
            with open(arg[1:]) as response:
                contents = response.read(8 * 1024 * 1024 + 1)
            if len(contents) > 8 * 1024 * 1024:
                raise ValueError("oversized linker response file")
            yield from expand_response_files(shlex.split(contents), depth + 1)
        else:
            yield arg


def link_options(args):
    """Read Clang's direct and forwarded linker options without changing them."""
    index = 0
    while index < len(args):
        arg = args[index]
        index += 1
        if arg == "-Xlinker" and index < len(args):
            yield args[index]
            index += 1
        elif arg.startswith("-Wl,"):
            yield from arg[4:].split(",")
        else:
            yield arg


def remove_global_interposition(args):
    """Replace a project-supplied global flag when it reaches the app link."""
    index = 0
    while index < len(args):
        arg = args[index]
        index += 1
        if arg == "-Xlinker" and args[index:index + 1] == ["-interposable"]:
            index += 1
        elif arg.startswith("-Wl,"):
            options = [option for option in arg[4:].split(",") if option != "-interposable"]
            if options:
                yield "-Wl," + ",".join(options)
        elif arg != "-interposable":
            yield arg


def defined_app_symbols(filelist_argument):
    filelist, delimiter, relative_base = filelist_argument.partition(",")
    objects_dir = Path(filelist).resolve().parent
    base = Path(relative_base) if delimiter else Path.cwd()
    with open(filelist) as handle:
        members = handle.read(8 * 1024 * 1024 + 1).splitlines()
    if len(members) > 8192 or sum(map(len, members)) >= 8 * 1024 * 1024:
        raise ValueError("oversized app object list")
    objects = []
    for member in members:
        path = (base / member).resolve()
        # SwiftPM may pass a prelinked .o. Only the app's own object directory
        # can contribute symbols, even if other inputs appear in this file list.
        if path.suffix == ".o" and path.parent == objects_dir:
            objects.append(str(path))

    symbols = set()
    for start in range(0, len(objects), 64):
        result = subprocess.run(
            ["/usr/bin/xcrun", "nm", "-m", "-g", "-U", *objects[start:start + 64]],
            stdout=subprocess.PIPE, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise ValueError("nm could not inspect the app's compiled objects")
        for line in result.stdout.splitlines():
            if not line or line.endswith(":"):
                continue
            definition = re.fullmatch(r"\s*[\da-fA-F]+\s+\([^)]+\)\s+(.*?)\s+(\S+)\s*", line)
            if not definition:
                raise ValueError("unrecognized app object symbol output")
            attributes, symbol = definition.groups()
            if re.search(r"\bexternal\b", attributes) and not re.search(r"\b(?:private |non-)external\b", attributes):
                if any(char in symbol for char in "*?[]"):
                    raise ValueError("app symbol cannot be represented as an exact linker entry")
                symbols.add(symbol)
    if not symbols:
        raise ValueError("app target has no external object definitions")
    return sorted(symbols)


def main():
    path = Path(__file__).resolve()
    config = json.loads((path.parent / "target.json").read_text())
    driver = config["drivers"].get(path.name) or path.name
    command = [driver] if os.path.isabs(driver) else ["/usr/bin/xcrun", driver]
    original = sys.argv[1:]
    args = list(expand_response_files(original))
    output = Path(args[args.index("-o") + 1]).resolve() if "-o" in args else None
    if output is None or output.name != config["image"] or output.parent.name != config["wrapper"]:
        os.execv(command[0], command + original)

    options = list(link_options(args))
    if options.count("-filelist") != 1 or "-interposable_list" in options:
        raise ValueError("app link needs one Xcode LinkFileList and no custom interposable list")
    symbols = defined_app_symbols(options[options.index("-filelist") + 1])
    with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, suffix=".symbols") as symbol_list:
        symbol_list.write("\n".join(symbols) + "\n")
        symbol_list.flush()
        scoped = [*remove_global_interposition(args), "-Xlinker", "-interposable_list", "-Xlinker", symbol_list.name]
        subprocess.run(command + scoped, check=True)
    (path.parent / "scoped-output").write_text(str(output))


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode)
    except (OSError, ValueError, IndexError, subprocess.TimeoutExpired) as error:
        sys.exit(f"[LIVE_LINKER_SCOPE_FAILED] Could not scope the app Debug linker: {error}")
