#!/usr/bin/env python3
"""On-demand, authenticated refresh of one private phone's pairing port. Never installs."""
import argparse
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time


class RefreshError(Exception):
    pass


def command(args, timeout):
    # dns-sd is a task-owned, bounded query, not a background watcher.
    process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        output, _ = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.terminate()
        try:
            output, _ = process.communicate(timeout=1)
        except subprocess.TimeoutExpired:
            process.kill()
            output, _ = process.communicate()
    return output[:65536].decode("utf-8", errors="replace")


def advertised_ports(run):
    browse = run(["/usr/bin/dns-sd", "-B", "_remotepairing._tcp", "local."], 3)
    names = []
    for line in browse.splitlines():
        fields = line.split(maxsplit=6)
        if len(fields) == 7 and fields[1] == "Add" and fields[6] not in names:
            names.append(fields[6])
        if len(names) == 4:
            break
    ports = []
    for name in names:
        resolved = run(["/usr/bin/dns-sd", "-L", name, "_remotepairing._tcp", "local."], 2)
        match = re.search(r"can be reached at [^\s:]+:(\d+)", resolved)
        if match:
            port = int(match.group(1))
            if 0 < port < 65536 and port not in ports:
                ports.append(port)
    return ports


def refresh(installer, prepared, peer_path, state, run=command):
    metadata = peer_path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o077:
        raise RefreshError("requires_private_peer_config")
    with peer_path.open("rb") as source:
        original = source.read(65537)
    if len(original) > 65536:
        raise RefreshError("invalid_peer_config")
    peer = json.loads(original)
    if set(peer) != {"host", "port", "udid", "pairing_file"}:
        raise RefreshError("invalid_peer_config")
    temporary = None
    deadline = time.monotonic() + 30
    try:
        with tempfile.NamedTemporaryFile(dir=peer_path.parent, prefix=".endpoint-", delete=False) as file:
            temporary = Path(file.name)

        def inspect(candidate):
            temporary.write_text(json.dumps(candidate))
            # Contact only the explicit phone's Tailnet address, never a discovered
            # LAN address. Native code checks its pinned peer and exact device ID.
            args = [str(installer), "inspect", str(prepared), str(temporary), str(state), "--execute"]
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise RefreshError("endpoint_refresh_timed_out")
            text = run(args, min(8, remaining))
            try:
                return json.loads(text)
            except (ValueError, TypeError):
                return {"ok": False, "state": "endpoint_inspection_incomplete"}

        current = inspect(peer)
        if current.get("ok") is True and current.get("state") == "installer-reachable":
            return {"ok": True, "state": "endpoint-already-verified", "changed": False}
        if current.get("state") not in {
            "pairing_connection_refused", "pairing_connection_timed_out",
            "pairing_port_unreachable", "connection_timeout", "endpoint_inspection_incomplete",
        }:
            raise RefreshError("endpoint_verification_failed")
        for port in advertised_ports(run):
            if port == peer["port"]:
                continue
            candidate = dict(peer, port=port)
            result = inspect(candidate)
            if result.get("ok") is not True or result.get("state") != "installer-reachable":
                continue
            with peer_path.open("rb") as source:
                unchanged = source.read(65537) == original
            if not unchanged:
                raise RefreshError("peer_config_changed")
            with temporary.open("wb") as file:
                file.write((json.dumps(candidate, indent=2) + "\n").encode())
                file.flush()
                os.fsync(file.fileno())
            os.replace(temporary, peer_path)
            parent = os.open(peer_path.parent, os.O_RDONLY)
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
            return {"ok": True, "state": "endpoint-refreshed-and-verified", "changed": True}
        raise RefreshError("no_verified_endpoint_found")
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--installer", required=True, type=Path)
    parser.add_argument("--prepared", required=True, type=Path)
    parser.add_argument("--peer", required=True, type=Path)
    parser.add_argument("--state", required=True, type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    if not args.execute:
        print(json.dumps({"ok": False, "state": "explicit_execute_required"}))
        raise SystemExit(1)
    try:
        result = refresh(args.installer.resolve(), args.prepared, args.peer, args.state)
    except RefreshError as error:
        result = {"ok": False, "state": str(error)}
    except Exception:
        result = {"ok": False, "state": "endpoint_refresh_failed"}
    print(json.dumps(result))
    if not result["ok"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
