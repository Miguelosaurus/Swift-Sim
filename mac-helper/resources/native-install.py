#!/usr/bin/env python3
"""On-demand Xcode install. A durable submission fence forbids an OTA retry."""
import argparse
import fcntl
import fnmatch
import datetime
import hashlib
import json
import os
import plistlib
from pathlib import Path, PurePosixPath
import stat
import shutil
import subprocess
import tempfile
import time
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
            hashed = hashlib.sha256()
            for chunk in iter(lambda: source.read(65536), b""):
                hashed.update(chunk)
            digest = hashed.hexdigest()
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




class Preparation:
    def __init__(self, root):
        self.path = Path(tempfile.mkdtemp(prefix="prepare-", dir=root))
        self.keep = False

    def __fspath__(self):
        return str(self.path)

    def __enter__(self):
        return self

    def __exit__(self, *_):
        if not self.keep:
            shutil.rmtree(self.path)


def private(path, directory=False):
    m = path.lstat()
    if (stat.S_ISLNK(m.st_mode) or m.st_uid != os.getuid() or m.st_mode & 0o077
            or (not stat.S_ISDIR(m.st_mode) if directory else not stat.S_ISREG(m.st_mode))):
        raise ValueError("private_state_required")


def save(path, record):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as f:
        temporary = Path(f.name)
        f.write(json.dumps({"schema": 1, "entries": record}).encode())
        f.flush()
        os.fsync(f.fileno())
    try:
        os.replace(temporary, path)
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        temporary.unlink(missing_ok=True)


def run(args, timeout=12):
    with tempfile.TemporaryDirectory(prefix="swift-sim-xcode-") as scratch:
        output = Path(scratch) / "result.json"
        p = subprocess.run(["/usr/bin/xcrun", "devicectl", *args, "--timeout", str(timeout),
                            "--json-output", str(output)], capture_output=True, timeout=timeout + 3)
        payload = json.loads(output.read_text()) if output.exists() else {}
        if p.returncode or payload.get("info", {}).get("outcome") != "success":
            raise ValueError("developer_connection_unavailable")
        return payload.get("result", {})


def matching(apps, identity):
    return any(a.get("bundleIdentifier") == identity["bundle"]
               and a.get("version") == identity["version"]
               and a.get("bundleVersion") == identity["build"] for a in apps)


def inventory(device, bundle, command):
    return command(["device", "info", "apps", "--device", device, "--bundle-id", bundle]).get("apps", [])


def deliver(options, command=run):
    root = Path(options.root)
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    private(root, True)
    key = hashlib.sha256((options.team + ":" + options.bundle).encode()).hexdigest()
    journal = root / (key + ".json")
    lock = os.open(root / (key + ".lock"), os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return {"state": "unconfirmed", "code": "INSTALL_BUSY"}
        records = {}
        if journal.exists():
            private(journal)
            envelope = json.loads(journal.read_text())
            if not isinstance(envelope, dict) or envelope.get("schema") != 1:
                raise ValueError("invalid_journal")
            records = envelope.get("entries")
            if (not isinstance(records, dict) or len(records) > 128
                    or any(not isinstance(v, dict) or v.get("state") not in
                           ["submitting", "installed", "installed-version-observed"] for v in records.values())):
                raise ValueError("invalid_journal")
            pending = [v for v in records.values() if v.get("state") == "submitting" or v.get("cleanupPending")]
            if len(pending) > 1:
                raise ValueError("invalid_journal")
            old = pending[0] if pending else None
            if old:
                # Even another build cannot bypass an unresolved submission.
                try:
                    apps = inventory(old["device"], old["identity"]["bundle"], command)
                    if not matching(apps, old["identity"]):
                        return {"state": "unconfirmed", "code": "INSTALL_RECONCILE_REQUIRED"}
                    old["state"] = "installed-version-observed"
                    old["observedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                    save(journal, records)
                    if old["buildID"] != options.build_id:
                        return {"state": "unconfirmed", "code": "INSTALL_STAGING_RETAINED"}
                except Exception:
                    return {"state": "unconfirmed", "code": "INSTALL_RECONCILE_REQUIRED"}
            if options.build_id in records:
                return {"state": records[options.build_id]["state"], "buildID": options.build_id,
                        "observedAt": records[options.build_id].get("observedAt")}
        if options.status:
            return {"state": "not-found"}
        records = {k: v for k, v in records.items() if v.get("state") == "submitting" or v.get("cleanupPending")
                   or v.get("expires", float("inf")) + 86400 > time.time()}
        if len(records) >= 128:
            return {"state": "unconfirmed", "code": "INSTALL_HISTORY_FULL"}
        with Preparation(root) as scratch:
            prepared = Path(scratch) / "frozen"
            prepare(Path(options.ipa), prepared)
            manifest = json.loads((prepared / "manifest.json").read_text())
            identity = {"bundle": options.bundle, "version": options.version, "build": options.build}
            if manifest["identity"] != identity or manifest["team"] != options.team:
                raise ValueError("build_identity_mismatch")
            try:
                devices = command(["list", "devices"]).get("devices", [])
            except Exception:
                return {"state": "unavailable", "code": "DEVELOPER_CONNECTION_UNAVAILABLE"}
            eligible = [d for d in devices
                        if d.get("hardwareProperties", {}).get("platform") == "iOS"
                        and d.get("hardwareProperties", {}).get("reality") == "physical"
                        and d.get("hardwareProperties", {}).get("udid") in manifest["devices"]
                        and d.get("deviceProperties", {}).get("pairingState") == "paired"
                        and d.get("connectionProperties", {}).get("tunnelState") == "connected"
                        and (not options.device or options.device in
                             [d.get("identifier"), d.get("hardwareProperties", {}).get("udid")])]
            if len(eligible) != 1:
                return {"state": "unavailable", "code": "NO_UNIQUE_REACHABLE_PHONE"}
            device = eligible[0]["identifier"]
            try:
                before = inventory(device, options.bundle, command)
            except Exception:
                return {"state": "unavailable", "code": "DEVELOPER_CONNECTION_UNAVAILABLE"}
            if matching(before, identity):
                return {"state": "already-matching-version", "buildID": options.build_id,
                        "observedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            # Never replace a different team's existing application identity.
            existing = [a for a in before if a.get("bundleIdentifier") == options.bundle]
            if existing and any(a.get("teamIdentifier") and a.get("teamIdentifier") != options.team for a in existing):
                return {"state": "unavailable", "code": "EXISTING_APP_TEAM_UNCONFIRMED"}
            app = extract(prepared / "signed.ipa", Path(scratch))
            record = {"buildID": options.build_id, "identity": identity, "device": device,
                      "sha256": manifest["sha256"], "state": "submitting", "at": time.time(),
                      "expires": options.expires_at, "staging": str(Path(scratch)), "cleanupPending": True}
            # Once this is durable, ANY failure stays uncertain. No prompt fallback.
            records[options.build_id] = record
            save(journal, records)
            scratch.keep = True
            try:
                command(["device", "install", "app", "--device", device, str(app)], timeout=180)
                if not matching(inventory(device, options.bundle, command), identity):
                    return {"state": "unconfirmed", "code": "INSTALL_RECONCILE_REQUIRED"}
                record["state"] = "installed"
                record["cleanupPending"] = False
                record["observedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                save(journal, records)
                scratch.keep = False
            except Exception:
                return {"state": "unconfirmed", "code": "INSTALL_RECONCILE_REQUIRED"}
            # Launch is best effort, and never retried; installed stays installed.
            opened = False
            try:
                command(["device", "process", "launch", "--device", device, options.bundle])
                opened = True
            except Exception:
                pass
            return {"state": "installed", "buildID": options.build_id, "launchRequested": opened,
                    "observedAt": record["observedAt"]}
    finally:
        os.close(lock)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ["root", "build-id", "bundle", "team", "version", "build", "ipa"]:
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--expires-at", type=float, required=True)
    parser.add_argument("--device", default="")
    parser.add_argument("--status", action="store_true")
    try:
        result = deliver(parser.parse_args())
    except Exception:
        # Pre-submission failure may use the normal foreground/link handoff.
        # A saved submitting fence is rechecked on every subsequent invocation.
        result = {"state": "unconfirmed", "code": "DIRECT_INSTALL_UNAVAILABLE"}
    print(json.dumps(result))
