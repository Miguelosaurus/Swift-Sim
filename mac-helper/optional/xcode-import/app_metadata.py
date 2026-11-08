#!/usr/bin/env python3
"""Read a signed development app. No network, copying, or device access."""
import argparse
import datetime
import fnmatch
import hashlib
import json
from pathlib import Path
import plistlib
import stat
import struct
import subprocess


def command(args):
    p = subprocess.run(args, capture_output=True, timeout=30)
    if p.returncode:
        raise ValueError("SIGNATURE_OR_PROFILE_INVALID")
    return p.stdout


def image(path):
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024**3:
        raise ValueError('REGULAR_APP_INPUT_REQUIRED')
    with path.open('rb') as f:
        header = f.read(32)
        if len(header) != 32 or struct.unpack_from('<II', header) != (0xfeedfacf, 0x100000c):
            raise ValueError('ARM64_IMAGE_REQUIRED')
        count, size = struct.unpack_from('<II', header, 16)
        if size > 1024 * 1024 or count > 20000:
            raise ValueError('IMAGE_HEADER_INVALID')
        commands = f.read(size)
    import uuid
    cursor = 0
    found = []
    for _ in range(count):
        kind, width = struct.unpack_from('<II', commands, cursor)
        if width < 8 or cursor + width > len(commands):
            raise ValueError('IMAGE_HEADER_INVALID')
        if kind == 0x1b and width == 24:
            found.append(str(uuid.UUID(bytes=commands[cursor + 8:cursor + 24])))
        cursor += width
    if len(found) != 1:
        raise ValueError('IMAGE_UUID_REQUIRED')
    return found[0]


def fingerprint(path):
    before = path.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise ValueError('REGULAR_APP_INPUT_REQUIRED')
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(65536), b''):
            h.update(chunk)
    after = path.lstat()
    if (before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns):
        raise ValueError('APP_CHANGED_DURING_INSPECTION')
    return h.hexdigest()


def inspect(app):
    if app.is_symlink() or not app.is_dir() or app.suffix != '.app':
        raise ValueError('SIGNED_DEVICE_APP_REQUIRED')
    app = app.resolve()
    info_path = app / 'Info.plist'
    if info_path.is_symlink() or info_path.stat().st_size > 1024**2:
        raise ValueError('APP_METADATA_INVALID')
    info = plistlib.loads(info_path.read_bytes())
    if 'iPhoneOS' not in info.get('CFBundleSupportedPlatforms', []):
        raise ValueError('DEVICE_BUILD_REQUIRED')
    executable = info.get('CFBundleExecutable', '')
    if not executable or Path(executable).name != executable:
        raise ValueError('EXECUTABLE_INVALID')
    command(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)])
    entitlements = plistlib.loads(command(['/usr/bin/codesign', '-d', '--entitlements', ':-', str(app)]))
    profile_path = app / 'embedded.mobileprovision'
    if profile_path.is_symlink() or profile_path.stat().st_size > 4*1024**2:
        raise ValueError('APP_PROFILE_INVALID')
    profile = plistlib.loads(command(['/usr/bin/security', 'cms', '-D', '-i', str(app / 'embedded.mobileprovision')]))
    teams = profile.get('TeamIdentifier', [])
    if len(teams) != 1 or not profile.get('ProvisionedDevices') or entitlements.get('get-task-allow') is not True:
        raise ValueError('DEVELOPMENT_SIGNING_REQUIRED')
    bundle = info.get('CFBundleIdentifier', '')
    app_id = entitlements.get('application-identifier', '')
    if (not bundle or entitlements.get('com.apple.developer.team-identifier') != teams[0]
            or not any(app_id == prefix + '.' + bundle for prefix in profile.get('ApplicationIdentifierPrefix', []))
            or not fnmatch.fnmatchcase(app_id, profile.get('Entitlements', {}).get('application-identifier', ''))):
        raise ValueError('SIGNING_IDENTITY_MISMATCH')
    if profile['ExpirationDate'].replace(tzinfo=datetime.timezone.utc).timestamp() <= datetime.datetime.now(datetime.timezone.utc).timestamp():
        raise ValueError('PROFILE_EXPIRED')
    identity = dict(bundle_id=bundle, bundle_version=info['CFBundleShortVersionString'], build_number=info['CFBundleVersion'],
                    executable_uuid=image(app / executable), debug_dylib_uuid=image(app / (executable + '.debug.dylib')))
    names = ['Info.plist', executable, executable + '.debug.dylib', '_CodeSignature/CodeResources', 'embedded.mobileprovision']
    fingerprints = {name: fingerprint(app / name) for name in names}
    command(['/usr/bin/codesign', '--verify', '--deep', '--strict', str(app)])
    if fingerprints != {name: fingerprint(app / name) for name in names}:
        raise ValueError('APP_CHANGED_DURING_INSPECTION')
    return dict(schema=1, appPath=str(app), binaryIdentity=identity, fingerprints=fingerprints, teamID=teams[0],
                name=info.get('CFBundleDisplayName') or info.get('CFBundleName') or bundle)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(dict(ok=True, metadata=inspect(args.app))))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) and str(error).isupper() else 'XCODE_APP_INSPECTION_FAILED'
        print(json.dumps(dict(ok=False, code=code)))
        raise SystemExit(1)
