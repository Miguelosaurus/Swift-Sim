import importlib.util
import json
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest.mock import patch
import datetime
import xml.etree.ElementTree as ET
sys.path.insert(0, str(Path(__file__).parents[2] / 'mac-helper/optional/xcode-import'))
import app_metadata
import scheme


class XcodeTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.app = self.root / 'App.app'
        self.app.mkdir()
        (self.app / '_CodeSignature').mkdir()
        (self.app / '_CodeSignature/CodeResources').write_bytes(b'signature fixture')
        info = dict(CFBundleExecutable='App', CFBundleIdentifier='example.app', CFBundleVersion='42',
                    CFBundleShortVersionString='1', CFBundleSupportedPlatforms=['iPhoneOS'])
        (self.app / 'Info.plist').write_bytes(plistlib.dumps(info))
        (self.app / 'embedded.mobileprovision').write_bytes(b'profile fixture')
        image = struct.pack('<IIIIIIII', 0xfeedfacf, 0x100000c, 0, 2, 1, 24, 0, 0) + struct.pack('<II', 0x1b, 24) + uuid.uuid4().bytes
        for name in ['App', 'App.debug.dylib']:
            (self.app / name).write_bytes(image)
        self.project = self.root / 'App.xcodeproj'
        self.scheme = self.project / 'xcshareddata/xcschemes/App.xcscheme'
        self.scheme.parent.mkdir(parents=True)
        self.scheme.write_text('<Scheme version="1.7"><BuildAction><BuildActionEntries><BuildActionEntry><BuildableReference BuildableName="App.app" BlueprintIdentifier="APP" BlueprintName="App" ReferencedContainer="container:App.xcodeproj"/></BuildActionEntry></BuildActionEntries><PostActions><ExecutionAction><ActionContent title="User action" scriptText="echo preserve"/></ExecutionAction></PostActions></BuildAction><LaunchAction buildConfiguration="Debug"/></Scheme>')
        self.executable = self.root / 'swift sim'
        self.executable.write_text('#!/bin/sh\necho "$1" >> "$HOOK_TEST_LOG"\n')
        self.executable.chmod(0o700)

    def tearDown(self):
        self.scratch.cleanup()

    def signing(self, args):
        if '--entitlements' in args:
            return plistlib.dumps({'application-identifier':'PREFIX.example.app', 'com.apple.developer.team-identifier':'TEAM', 'get-task-allow':True})
        if args[0] == '/usr/bin/security':
            return plistlib.dumps({'TeamIdentifier':['TEAM'], 'ApplicationIdentifierPrefix':['PREFIX'], 'ProvisionedDevices':['fixture'],
                'Entitlements':{'application-identifier':'PREFIX.example.*'}, 'ExpirationDate':datetime.datetime(2099,1,1)})
        return b''

    def test_inspection_is_metadata_only_and_rejects_changed_or_unsigned_inputs(self):
        before = sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*'))
        with patch.object(app_metadata, 'command', side_effect=self.signing):
            metadata = app_metadata.inspect(self.app)
        self.assertEqual(metadata['binaryIdentity']['build_number'], '42')
        self.assertEqual(len(metadata['fingerprints']), 5)
        self.assertEqual(before, sorted(str(p.relative_to(self.root)) for p in self.root.rglob('*')))
        with patch.object(app_metadata, 'command', side_effect=ValueError('SIGNATURE_OR_PROFILE_INVALID')):
            with self.assertRaises(ValueError):
                app_metadata.inspect(self.app)
        (self.app / 'App').unlink()
        (self.app / 'App').symlink_to(self.root / 'outside')
        with patch.object(app_metadata, 'command', side_effect=self.signing):
            with self.assertRaises(ValueError):
                app_metadata.inspect(self.app)

    def test_hook_is_idempotent_preserves_user_actions_and_removes_only_its_actions(self):
        backup = self.root / 'private'
        kwargs = dict(backup_root=backup)
        self.assertTrue(scheme.update(self.project, 'App', self.executable, **kwargs)['changed'])
        first = self.scheme.read_bytes()
        self.assertFalse(scheme.update(self.project, 'App', self.executable, **kwargs)['changed'])
        self.assertEqual(first, self.scheme.read_bytes())
        root = ET.fromstring(first)
        actions = root.findall('./BuildAction/PostActions/ExecutionAction/ActionContent')
        self.assertEqual(len(actions), 2)
        self.assertTrue(any(a.get('title') == 'User action' for a in actions))
        import os
        log = self.root / 'hook.log'
        env = dict(os.environ, CONFIGURATION='Debug', PLATFORM_NAME='iphoneos', TARGET_BUILD_DIR=str(self.root), FULL_PRODUCT_NAME='App.app', PROJECT_FILE_PATH=str(self.project), HOOK_TEST_LOG=str(log))
        for location in ['PreActions', 'PostActions']:
            contents = root.findall('./BuildAction/' + location + '/ExecutionAction/ActionContent')
            script = next(a.get('scriptText') for a in contents if a.get('title', '').startswith(scheme.TITLE))
            subprocess.run(['/bin/sh', '-c', script], env=env, check=True)
            subprocess.run(['/bin/sh', '-c', script], env=dict(env, SWIFT_SIM_MANAGED_BUILD='1'), check=True)
            subprocess.run(['/bin/sh', '-c', script], env=dict(env, PLATFORM_NAME='iphonesimulator'), check=True)
            subprocess.run(['/bin/sh', '-c', script], env=dict(env, CONFIGURATION='Release'), check=True)
        self.assertEqual(log.read_text().splitlines(), ['xcode-build-start','import-xcode-build'])
        self.assertEqual(len(list(backup.glob('*.original.xcscheme'))), 1)
        scheme.update(self.project, 'App', self.executable, remove=True, **kwargs)
        root = ET.fromstring(self.scheme.read_bytes())
        self.assertEqual(len(root.findall('./BuildAction/PostActions/ExecutionAction')), 1)
        self.assertEqual(len(root.findall('./BuildAction/PreActions/ExecutionAction')), 0)

    def test_hook_repairs_missing_preaction_and_bad_executable_leaves_scheme_unchanged(self):
        kwargs = dict(backup_root=self.root / 'private')
        scheme.update(self.project, 'App', self.executable, **kwargs)
        tree = ET.fromstring(self.scheme.read_bytes())
        tree.find('BuildAction').remove(tree.find('./BuildAction/PreActions'))
        self.scheme.write_bytes(ET.tostring(tree))
        self.assertTrue(scheme.update(self.project, 'App', self.executable, **kwargs)['changed'])
        self.assertEqual(len(ET.fromstring(self.scheme.read_bytes()).findall('./BuildAction/PreActions/ExecutionAction')), 1)
        before = self.scheme.read_bytes()
        with self.assertRaisesRegex(ValueError, "SWIFT_SIM_EXECUTABLE_REQUIRED"):
            scheme.update(self.project, 'App', self.root / 'missing', **kwargs)
        self.assertEqual(self.scheme.read_bytes(), before)

    def test_export_rejects_overwrite_and_drift_and_cleans_failed_temporary_copy(self):
        spec = importlib.util.spec_from_file_location('xcode_export', Path(__file__).parents[2] / 'mac-helper/optional/xcode-import' / 'export.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        output = self.root / 'result.ipa'
        output.write_bytes(b'preserve')
        with self.assertRaisesRegex(ValueError, 'NEW_EXPORT_PATH_REQUIRED'):
            module.export(self.app, output, 'unused')
        self.assertEqual(output.read_bytes(), b'preserve')
        output.unlink()
        metadata = dict(fingerprints={'Info.plist':'a'*64})
        with patch.object(module, 'inspect', return_value=metadata):
            with self.assertRaisesRegex(ValueError, 'XCODE_OUTPUT_CHANGED'):
                module.export(self.app, output, 'wrong')
            with patch.object(module.subprocess, 'run', side_effect=subprocess.CalledProcessError(1, 'ditto')):
                with self.assertRaises(subprocess.CalledProcessError):
                    module.export(self.app, output, module.digest(metadata['fingerprints']))
        self.assertFalse(output.exists())
        self.assertEqual(list(self.root.glob('.swift-sim-export-*')), [])


if __name__ == '__main__':
    unittest.main()
