#!/usr/bin/env python3
"""Explicit export only. No managed archive cache and no device/network calls."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from app_metadata import inspect


def digest(value):
    return hashlib.sha256(json.dumps(value, separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()


def export(app, output, expected):
    if not output.is_absolute() or not output.parent.is_dir() or output.exists() or output.is_symlink():
        raise ValueError('NEW_EXPORT_PATH_REQUIRED')
    if output.parent.stat().st_uid != os.getuid():
        raise ValueError('OWNED_EXPORT_DIRECTORY_REQUIRED')
    metadata = inspect(app)
    if digest(metadata['fingerprints']) != expected:
        raise ValueError('XCODE_OUTPUT_CHANGED')
    # The one temporary tree exists only for this explicit export operation.
    total = 0
    for count, path in enumerate(app.rglob('*')):
        if count >= 32768 or path.is_symlink():
            raise ValueError('XCODE_EXPORT_UNSAFE_INPUT')
        if path.is_file():
            total += path.stat().st_size
    if total > 1024**3 or shutil.disk_usage(output.parent).free < total * 3 + 64*1024**2:
        raise ValueError('XCODE_EXPORT_STORAGE_LIMIT')
    with tempfile.TemporaryDirectory(prefix='.swift-sim-export-', dir=output.parent) as scratch:
        payload = Path(scratch) / 'Payload'
        payload.mkdir()
        copied = payload / app.name
        subprocess.run(['/usr/bin/ditto', str(app), str(copied)], check=True, capture_output=True, timeout=120)
        if digest(inspect(copied)['fingerprints']) != expected:
            raise ValueError('XCODE_OUTPUT_CHANGED')
        ipa = Path(scratch) / 'export.ipa'
        subprocess.run(['/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(payload), str(ipa)], check=True, capture_output=True, timeout=120)
        if ipa.stat().st_size > 256*1024**2:
            raise ValueError('XCODE_EXPORT_STORAGE_LIMIT')
        # Hard-link publication is exclusive; never replace a user's export.
        ipa.chmod(0o600)
        with ipa.open('rb') as f:
            os.fsync(f.fileno())
        os.link(ipa, output)
    return dict(outcome='xcode-build-exported', bytes=output.stat().st_size)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--app', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--fingerprints-sha', required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(export(args.app, args.output, args.fingerprints_sha)))
    except Exception as error:
        code = str(error) if isinstance(error, ValueError) else 'XCODE_EXPORT_UNAVAILABLE'
        print(json.dumps(dict(outcome='needs-user-action', code=code)))
        raise SystemExit(1)
