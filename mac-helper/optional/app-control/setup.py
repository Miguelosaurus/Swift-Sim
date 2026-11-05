"""Explicit, one-shot setup of the optional development-signed testing runner.

Uses Xcode and the pinned upstream signer. No package manager, new certificate,
account service, agent, app SDK, or background process is installed.
"""
from __future__ import annotations
import argparse
import datetime
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("control", HERE / "control.py")
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)

class SetupError(Exception):
    def __init__(self, code): self.code = code

GUIDANCE = {
    "SELECT_DEVICE": "Use the exact paired iPhone and development team from the project's existing signing setup. The agent handles these values; do not ask the developer to copy identifiers.",
    "SIGNING_REQUIRED": "An unexpired development profile for this iPhone/app and its matching keychain identity are needed. Use the project's existing Apple developer account in Xcode; do not create or rotate certificates automatically.",
    "ASSET_INVALID": "The pinned testing assets could not be verified. No app was installed; do not substitute an unverified download.",
    "BUILD_FAILED": "The optional runner could not be built or signed. Inspect the private setup log; normal Swift Sim delivery is unchanged.",
    "INSTALL_UNCONFIRMED": "iPhone installation is unconfirmed. Inspect the selected device before retrying; initial installation needs a working Apple developer connection, usually the Mac's Wi-Fi.",
    "SETUP_BUSY": "Finish the current app-testing session before changing its installation.",
}

def fail(code): raise SetupError(code)

def digest(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def download(url, expected, maximum):
    with urllib.request.urlopen(url, timeout=30) as response:
        value = response.read(maximum + 1)
    if len(value) > maximum or hashlib.sha256(value).hexdigest() != expected: fail("ASSET_INVALID")
    return value

def unpack_source(data, destination):
    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
        members = archive.getmembers()
        if not members or len(members) > 1000: fail("ASSET_INVALID")
        prefix = members[0].name.split("/")[0] + "/"
        size = 0
        for member in members:
            if member.isdir(): continue
            if not member.name.startswith(prefix): fail("ASSET_INVALID")
            name = Path(member.name[len(prefix):])
            size += member.size
            if name.is_absolute() or ".." in name.parts or not member.isfile() or size > 32 * 1024 * 1024: fail("ASSET_INVALID")
            target = destination / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.extractfile(member).read())

def unpack_ipa(data, destination):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        size = 0
        for item in archive.infolist():
            name = Path(item.filename)
            mode = item.external_attr >> 16
            size += item.file_size
            if name.is_absolute() or ".." in name.parts or stat.S_ISLNK(mode) or size > 64 * 1024 * 1024: fail("ASSET_INVALID")
        archive.extractall(destination)
    apps = list((destination / "Payload").glob("*.app"))
    if len(apps) != 1: fail("ASSET_INVALID")
    return apps[0]

def matching_profile(value, *, device, team, bundle, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    expiry = value.get("ExpirationDate")
    if isinstance(expiry, datetime.datetime) and expiry.tzinfo is None: expiry = expiry.replace(tzinfo=datetime.timezone.utc)
    entitlements = value.get("Entitlements", {})
    appid = entitlements.get("application-identifier", "")
    prefix = team + "."
    if not isinstance(appid, str) or not appid.startswith(prefix): return False
    identifier = appid[len(prefix):]
    covers = identifier == bundle or (identifier.endswith("*") and bundle.startswith(identifier[:-1]))
    return bool(covers and entitlements.get("get-task-allow") is True
        and value.get("TeamIdentifier") == [team] and device in value.get("ProvisionedDevices", [])
        and isinstance(expiry, datetime.datetime) and expiry > now)

def select_profile(explicit, *, device, team, bundle, run=subprocess.run):
    try:
        identities = run(["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"], capture_output=True, timeout=10)
        available = set(re.findall(rb"\b[0-9A-Fa-f]{40}\b", identities.stdout.upper())) if identities.returncode == 0 else set()
    except (OSError, subprocess.TimeoutExpired): available = set()
    if not available: fail("SIGNING_REQUIRED")
    if explicit:
        paths = [Path(explicit).expanduser().absolute()]
    else:
        paths = []
        for folder in ["Library/Developer/Xcode/UserData/Provisioning Profiles", "Library/MobileDevice/Provisioning Profiles"]:
            paths.extend((Path.home() / folder).glob("*.mobileprovision"))
    eligible = []
    for path in paths:
        try:
            if path.is_symlink() or not path.is_file(): continue
            result = run(["/usr/bin/security", "cms", "-D", "-i", str(path)], capture_output=True, timeout=10)
            if result.returncode: continue
            value = plistlib.loads(result.stdout)
            matching_key = any(hashlib.sha1(cert).hexdigest().upper().encode() in available
                for cert in value.get("DeveloperCertificates", []) if isinstance(cert, bytes))
            if matching_key and matching_profile(value, device=device, team=team, bundle=bundle):
                exact = value["Entitlements"]["application-identifier"] == team + "." + bundle
                eligible.append((exact, value["ExpirationDate"], path))
        except (OSError, ValueError, plistlib.InvalidFileException, subprocess.TimeoutExpired): continue
    if not eligible: fail("SIGNING_REQUIRED")
    return max(eligible, key=lambda item: (item[0], item[1]))[2]

def command(args, log, *, cwd=None, timeout=240, code="BUILD_FAILED"):
    try:
        result = subprocess.run(args, stdout=log, stderr=log, cwd=cwd, timeout=timeout,
            env={**os.environ, "COPYFILE_DISABLE": "1"})
    except (OSError, subprocess.TimeoutExpired): fail(code)
    if result.returncode: fail(code)

def execute(args, root):
    parser = argparse.ArgumentParser(add_help=False, exit_on_error=False)
    for name in ["device", "team-id", "bundle-id", "profile"]: parser.add_argument("--" + name)
    parser.add_argument("--reinstall", action="store_true")
    parser.add_argument("--build-only", action="store_true")
    try:
        with c.contextlib.redirect_stderr(io.StringIO()): options = parser.parse_args(args)
    except (argparse.ArgumentError, SystemExit): fail("SELECT_DEVICE")
    if not root.is_absolute(): fail("SELECT_DEVICE")
    c.check_root(root, create=True)
    with c.exclusive(root):
        if (root / "session.json").exists(): fail("SETUP_BUSY")
        prior = c.private_read(root / "installation.json") if (root / "installation.json").exists() else {}
        for supplied, saved in [(options.device, "device"), (options.team_id, "team"), (options.bundle_id, "bundle")]:
            if prior and supplied and supplied != prior.get(saved): fail("SELECT_DEVICE")
        if prior and not options.reinstall and not options.build_only:
            return {"outcome": "setup-recorded", "phoneConnection": "not-probed", "version": prior.get("version"),
                "guidance": "Open an app in Swift Sim, then Test with Agent → Start App Testing. The agent verifies the current connection separately."}
        device = options.device or prior.get("device")
        team = options.team_id or prior.get("team")
        if not isinstance(device, str) or not re.fullmatch(r"[a-fA-F0-9-]{16,64}", device) or not isinstance(team, str) or not re.fullmatch(r"[A-Z0-9]{10}", team): fail("SELECT_DEVICE")
        bundle = options.bundle_id or prior.get("bundle") or f"dev.swiftsim.{team.lower()}.testing.xctrunner"
        if not c.BUNDLE.fullmatch(bundle) or bundle.startswith("com.apple.") or not bundle.endswith(".xctrunner"): fail("SELECT_DEVICE")
        profile = select_profile(options.profile, device=device, team=team, bundle=bundle)
        assets = HERE / "runner"
        manifest = json.loads((assets / "provenance.json").read_text())
        for name, expected in manifest["assets"].items():
            if digest(assets / name) != expected: fail("ASSET_INVALID")
        log_path = root / "setup.log"
        fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid() or info.st_mode & 0o077:
            os.close(fd)
            fail("ASSET_INVALID")
        os.ftruncate(fd, 0)
        with os.fdopen(fd, "w") as log, tempfile.TemporaryDirectory(prefix="setup-", dir=root) as directory:
            work = Path(directory)
            source = work / "source"
            source.mkdir()
            unpack_source(download(manifest["sourceURL"], manifest["sourceSHA256"], 20 * 1024 * 1024), source)
            command(["/usr/bin/patch", "-p1", "--batch", "--forward", "-i", str(assets / "lifetime.patch")], log, cwd=source)
            fingerprint = hashlib.sha256((assets / "provenance.json").read_bytes()).hexdigest()[:16]
            stamp = "swift-sim/" + manifest["upstreamRevision"][:12] + "/" + fingerprint
            (source / "iCTRLKit/BuildStamp.swift").write_text('enum BuildStamp { static let value = "' + stamp + '" }\n')
            shutil.copyfile(assets / "SwiftSimTestingLifetime.swift", source / "iCTRLUITests/SwiftSimTestingLifetime.swift")
            (source / "BuildHost").mkdir()
            shutil.copyfile(assets / "BuildHost.swift", source / "BuildHost/Host.swift")
            shutil.copytree(assets / "SwiftSimTesting.xcodeproj", source / "SwiftSimTesting.xcodeproj")
            command(["xcrun", "xcodebuild", "build-for-testing", "-project", str(source / "SwiftSimTesting.xcodeproj"),
                "-scheme", "SwiftSimTesting", "-configuration", "Debug", "-destination", "generic/platform=iOS",
                "-derivedDataPath", str(work / "DerivedData"), "CODE_SIGNING_ALLOWED=NO",
                "SWIFT_SIM_TESTING_BUNDLE_ID=" + bundle.removesuffix(".xctrunner")], log)
            payload = work / "template"
            app = unpack_ipa(download(manifest["templateURL"], manifest["templateSHA256"], 8 * 1024 * 1024), payload)
            test_bundle = app / "PlugIns/iCTRLUITests.xctest"
            # Keep the pinned release's optional static clients. Rebuilding the
            # Swift bundle must not advertise a client resource it then drops.
            clients = {name: (test_bundle / name).read_bytes() for name in ["ictrl", "ictrl.sh"]}
            shutil.rmtree(test_bundle)
            shutil.copytree(work / "DerivedData/Build/Products/Debug-iphoneos/iCTRLUITests-Runner.app/PlugIns/iCTRLUITests.xctest", test_bundle)
            for name, data in clients.items(): (test_bundle / name).write_bytes(data)
            info = app / "Info.plist"
            value = plistlib.loads(info.read_bytes())
            value.update(CFBundleIdentifier=bundle, CFBundleDisplayName="Swift Sim App Testing", CFBundleVersion="2")
            info.write_bytes(plistlib.dumps(value))
            unsigned = work / "unsigned.ipa"
            with zipfile.ZipFile(unsigned, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                for path in sorted((payload / "Payload").rglob("*")):
                    if path.is_symlink(): fail("ASSET_INVALID")
                    if path.is_file() and not path.name.startswith("._"): archive.write(path, path.relative_to(payload))
            signed = work / "signed.ipa"
            command(["bash", str(source / "Scripts/sign-ipa.sh"), "-i", str(unsigned), "-o", str(signed), "-p", str(profile), "-t", team], log)
            install_app = unpack_ipa(signed.read_bytes(), work / "signed")
            command(["codesign", "--verify", "--deep", "--strict", str(install_app)], log)
            if not options.build_only:
                command(["xcrun", "devicectl", "device", "install", "app", "--device", device, "--timeout", "60",
                    "--json-output", str(work / "install.json"), str(install_app)], log, timeout=75, code="INSTALL_UNCONFIRMED")
                try: installed = json.loads((work / "install.json").read_text())
                except (OSError, ValueError): fail("INSTALL_UNCONFIRMED")
                if installed.get("info", {}).get("outcome") != "success": fail("INSTALL_UNCONFIRMED")
            target = root / "runner-signed.ipa"
            if target.exists() and (target.is_symlink() or not target.is_file()): fail("ASSET_INVALID")
            descriptor, replacement = tempfile.mkstemp(prefix="runner-", suffix=".ipa", dir=root)
            try:
                with os.fdopen(descriptor, "wb") as output, signed.open("rb") as prepared:
                    shutil.copyfileobj(prepared, output)
                    output.flush()
                    os.fsync(output.fileno())
                os.replace(replacement, target)
            finally:
                if os.path.exists(replacement): os.unlink(replacement)
            if not options.build_only:
                c.private_write(root / "installation.json", {"schemaVersion": 1, "version": manifest["version"],
                    "device": device, "team": team, "bundle": bundle, "sha256": digest(target)})
        return {"outcome": "runner-prepared" if options.build_only else "runner-installed", "version": manifest["version"],
            "maximumSeconds": manifest["maximumSeconds"], "launched": False, "backgroundWorker": False,
            "guidance": "Open the app page in Swift Sim → Test with Agent → Start App Testing. Complete the normal iOS approvals if requested; the agent handles private pairing next."}

def main():
    os.umask(0o077)
    try:
        request = json.loads(sys.stdin.read(65536))
        value = execute(request["args"][1:], Path(request["stateRoot"]))
    except SetupError as error:
        value = {"outcome": "needs-user-action", "code": "APP_CONTROL_" + error.code, "guidance": GUIDANCE[error.code]}
    except c.ControlError as error:
        value = {"outcome": "needs-user-action", "code": "APP_CONTROL_" + error.code, "guidance": c.GUIDANCE[error.code]}
    except BaseException:
        value = {"outcome": "needs-user-action", "code": "APP_CONTROL_BUILD_FAILED", "guidance": GUIDANCE["BUILD_FAILED"]}
    value["schemaVersion"] = 1
    print(json.dumps(value))
    return int(value["outcome"] == "needs-user-action")

if __name__ == "__main__": sys.exit(main())
