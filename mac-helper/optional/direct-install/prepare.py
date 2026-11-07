#!/usr/bin/env python3
"""Offline only: freeze and validate an existing Xcode-signed IPA. Never contacts a device."""
import argparse
import datetime
import fnmatch
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import subprocess
import tempfile
import zipfile


def command(args):
    result = subprocess.run(args, capture_output=True, timeout=60, check=False)
    if result.returncode:
        raise ValueError("local_signature_or_profile_check_failed")
    return result.stdout


def identity(info):
    keys = {"bundle": "CFBundleIdentifier", "build": "CFBundleVersion",
            "version": "CFBundleShortVersionString"}
    result = {name: info.get(key) for name, key in keys.items()}
    if any(not isinstance(v, str) or not v or len(v) > 255 for v in result.values()):
        raise ValueError("invalid_bundle_identity")
    if "/" in result["bundle"] or "*" in result["bundle"]:
        raise ValueError("invalid_bundle_identity")
    return result


def extract(ipa, destination):
    with zipfile.ZipFile(ipa) as archive:
        entries = archive.infolist()
        if len(entries) > 65536 or sum(e.file_size for e in entries) > 4 * 1024**3:
            raise ValueError("archive_too_large")
        roots = set()
        names = set()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            mode = entry.external_attr >> 16
            if (path.is_absolute() or ".." in path.parts or "\\" in entry.filename
                    or stat.S_ISLNK(mode) or entry.filename in names):
                raise ValueError("unsafe_archive_entry")
            names.add(entry.filename)
            if len(path.parts) >= 2 and path.parts[0] == "Payload" and path.parts[1].endswith(".app"):
                roots.add(path.parts[1])
        if len(roots) != 1:
            raise ValueError("expected_one_app")
        root = roots.pop()
        for entry in entries:
            path = PurePosixPath(entry.filename)
            if len(path.parts) < 2 or path.parts[:2] != ("Payload", root):
                continue
            target = destination.joinpath(*path.parts)
            if entry.is_dir():
                target.mkdir(parents=True, exist_ok=True)
            else:
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open("xb") as output:
                    shutil.copyfileobj(source, output, 65536)
                target.chmod((entry.external_attr >> 16) & 0o777 or 0o600)
        return destination / "Payload" / root


def prepare(ipa, output):
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        frozen = output / "signed.ipa"
        with ipa.open("rb") as source, frozen.open("xb") as target:
            shutil.copyfileobj(source, target, 65536)
            target.flush()
            os.fsync(target.fileno())
        frozen.chmod(0o400)
        with tempfile.TemporaryDirectory(prefix="validate-", dir=output) as scratch:
            app = extract(frozen, Path(scratch))
            info = plistlib.loads((app / "Info.plist").read_bytes())
            app_identity = identity(info)
            if "iPhoneOS" not in info.get("CFBundleSupportedPlatforms", []):
                raise ValueError("not_a_device_app")
            command(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(app)])
            entitlements = plistlib.loads(command([
                "/usr/bin/codesign", "-d", "--entitlements", ":-", str(app)]))
            profile = plistlib.loads(command([
                "/usr/bin/security", "cms", "-D", "-i", str(app / "embedded.mobileprovision")]))
            teams = profile.get("TeamIdentifier", [])
            devices = profile.get("ProvisionedDevices", [])
            if len(teams) != 1 or not devices or not all(isinstance(v, str) for v in devices):
                raise ValueError("requires_registered_device_profile")
            team = teams[0]
            # App identifier prefixes can differ from the team for migrated apps.
            app_id = entitlements.get("application-identifier", "")
            prefixes = profile.get("ApplicationIdentifierPrefix", [])
            if (not any(app_id == prefix + "." + app_identity["bundle"] for prefix in prefixes)
                    or entitlements.get("com.apple.developer.team-identifier") != team
                    or not fnmatch.fnmatchcase(app_id, profile.get("Entitlements", {}).get("application-identifier", ""))):
                raise ValueError("signing_identity_mismatch")
            expiry = profile["ExpirationDate"].replace(tzinfo=datetime.timezone.utc).timestamp()
            if expiry <= datetime.datetime.now(datetime.timezone.utc).timestamp():
                raise ValueError("profile_expired")
        with frozen.open("rb") as source:
            digest = hashlib.file_digest(source, "sha256").hexdigest()
        manifest = {"schema": 1, "sha256": digest, "identity": app_identity,
                    "team": team, "devices": devices, "expires": int(expiry)}
        path = output / "manifest.json"
        path.write_text(json.dumps(manifest, indent=2) + "\n")
        path.chmod(0o400)
        return {"ok": True, "state": "prepared-offline", "deviceContacted": False}
    except Exception:
        # Only this newly-created, task-owned directory is removed.
        shutil.rmtree(output)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ipa", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(prepare(args.ipa, args.output)))
    except Exception:
        # Never include subprocess output, provisioning data, paths, or identifiers.
        print(json.dumps({"ok": False, "state": "offline_preparation_failed", "deviceContacted": False}))
        raise SystemExit(1)


if __name__ == "__main__":
    main()
