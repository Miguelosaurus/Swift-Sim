import datetime
import importlib.util
import json
from pathlib import Path
import plistlib
import stat
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("prepare", Path(__file__).parents[1] / "prepare.py")
prepare = importlib.util.module_from_spec(spec)
spec.loader.exec_module(prepare)


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.ipa = self.root / "source.ipa"
        self.output = self.root / "prepared"

    def tearDown(self):
        self.scratch.cleanup()

    def app(self):
        with zipfile.ZipFile(self.ipa, "w") as z:
            z.writestr("Payload/Test.app/Info.plist", plistlib.dumps({
                "CFBundleIdentifier": "example.Test", "CFBundleVersion": "2",
                "CFBundleShortVersionString": "1.0", "CFBundleSupportedPlatforms": ["iPhoneOS"]}))
            z.writestr("Payload/Test.app/embedded.mobileprovision", b"fixture-not-a-profile")

    def signing(self, expired=False, mismatch=False):
        def run(args):
            if "--verify" in args:
                return b""
            if "--entitlements" in args:
                return plistlib.dumps({"application-identifier": "PREFIX.example.Test",
                                       "com.apple.developer.team-identifier": "WRONG" if mismatch else "TEAM"})
            return plistlib.dumps({"TeamIdentifier": ["TEAM"], "ApplicationIdentifierPrefix": ["PREFIX"],
                                   "ProvisionedDevices": ["synthetic-device"],
                                   "Entitlements": {"application-identifier": "PREFIX.example.*"},
                                   "ExpirationDate": datetime.datetime(2000 if expired else 2099, 1, 1)})
        return run

    def test_frozen_snapshot_manifest_and_original_unchanged(self):
        self.app()
        original = self.ipa.read_bytes()
        with patch.object(prepare, "command", side_effect=self.signing()) as calls:
            result = prepare.prepare(self.ipa, self.output)
        self.assertFalse(result["deviceContacted"])
        self.assertEqual(self.ipa.read_bytes(), original)
        self.assertEqual((self.output / "signed.ipa").read_bytes(), original)
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual(manifest["identity"]["build"], "2")
        self.assertEqual(calls.call_count, 3)
        self.assertIn("--strict", calls.call_args_list[0].args[0])
        self.assertEqual(self.output.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.output / "signed.ipa").stat().st_mode & 0o777, 0o400)
        self.assertEqual(sorted(p.name for p in self.output.iterdir()), ["manifest.json", "signed.ipa"])

    def test_invalid_signatures_and_profiles_leave_no_preparation(self):
        self.app()
        for mock in [self.signing(expired=True), self.signing(mismatch=True)]:
            with patch.object(prepare, "command", side_effect=mock), self.assertRaises(ValueError):
                prepare.prepare(self.ipa, self.output)
            self.assertFalse(self.output.exists())
        with patch.object(prepare, "command", side_effect=ValueError("signature")), self.assertRaises(ValueError):
            prepare.prepare(self.ipa, self.output)
        self.assertFalse(self.output.exists())

    def test_existing_preparation_is_never_overwritten_or_removed(self):
        self.output.mkdir()
        marker = self.output / "preserve"
        marker.write_text("original")
        with self.assertRaises(FileExistsError):
            prepare.prepare(self.ipa, self.output)
        self.assertEqual(marker.read_text(), "original")

    def test_traversal_and_symlinks_are_rejected_without_signer(self):
        for name, mode in [("../outside", 0o100644), ("Payload/Test.app/link", stat.S_IFLNK | 0o777)]:
            with zipfile.ZipFile(self.ipa, "w") as z:
                entry = zipfile.ZipInfo(name)
                entry.external_attr = mode << 16
                z.writestr(entry, "../../outside")
            with patch.object(prepare, "command") as signer, self.assertRaises(ValueError):
                prepare.prepare(self.ipa, self.output)
            signer.assert_not_called()
            self.assertFalse((self.root / "outside").exists())
            self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
