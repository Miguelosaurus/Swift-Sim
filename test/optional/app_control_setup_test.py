import datetime
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import stat
import tarfile
import tempfile
from types import SimpleNamespace
import unittest
import zipfile
from unittest.mock import patch

path = Path(__file__).resolve().parents[2] / "mac-helper/optional/app-control/setup.py"
spec = importlib.util.spec_from_file_location("setup", path)
s = importlib.util.module_from_spec(spec)
spec.loader.exec_module(s)

class SetupTests(unittest.TestCase):
    def test_profile_selection_requires_its_matching_available_keychain_identity(self):
        certificate = b"fixture certificate"
        value = {"ExpirationDate": datetime.datetime(2099, 1, 1), "TeamIdentifier": ["ABCDEFGHIJ"],
            "ProvisionedDevices": ["selected-phone"], "DeveloperCertificates": [certificate],
            "Entitlements": {"get-task-allow": True, "application-identifier": "ABCDEFGHIJ.dev.fixture.*"}}
        with tempfile.TemporaryDirectory() as directory:
            profile = Path(directory) / "profile.mobileprovision"
            profile.write_bytes(b"CMS fixture supplied by the test transport")
            def run(args, **kwargs):
                data = (hashlib.sha1(certificate).hexdigest().upper().encode()
                    if args[1] == "find-identity" else plistlib.dumps(value))
                return SimpleNamespace(returncode=0, stdout=data)
            self.assertEqual(s.select_profile(str(profile), device="selected-phone", team="ABCDEFGHIJ", bundle="dev.fixture.testing", run=run), profile)
            def missing_key(args, **kwargs):
                return SimpleNamespace(returncode=0, stdout=b"A" * 40 if args[1] == "find-identity" else plistlib.dumps(value))
            with self.assertRaises(s.SetupError):
                s.select_profile(str(profile), device="selected-phone", team="ABCDEFGHIJ", bundle="dev.fixture.testing", run=missing_key)

    def test_signing_refuses_distribution_expiry_wrong_device_team_and_bundle(self):
        now = datetime.datetime(2026, 11, 5, tzinfo=datetime.timezone.utc)
        value = {"ExpirationDate": now + datetime.timedelta(days=10), "TeamIdentifier": ["ABCDEFGHIJ"],
            "ProvisionedDevices": ["selected-phone"], "Entitlements": {
                "get-task-allow": True, "application-identifier": "ABCDEFGHIJ.dev.fixture.*"}}
        match = lambda v: s.matching_profile(v, device="selected-phone", team="ABCDEFGHIJ", bundle="dev.fixture.testing", now=now)
        self.assertTrue(match(value))
        for key, invalid in [("ExpirationDate", now), ("ProvisionedDevices", ["another-phone"]),
                ("TeamIdentifier", ["OTHERTEAM1"])]:
            self.assertFalse(match({**value, key: invalid}))
        for key, invalid in [("get-task-allow", False), ("application-identifier", "ABCDEFGHIJ.dev.other.*")]:
            self.assertFalse(match({**value, "Entitlements": {**value["Entitlements"], key: invalid}}))

    def test_verified_archive_extraction_still_refuses_traversal_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ["../escaped", "/absolute"]:
                data = io.BytesIO()
                with zipfile.ZipFile(data, "w") as archive: archive.writestr(name, b"unexpected")
                with self.assertRaises(s.SetupError): s.unpack_ipa(data.getvalue(), root / "zip")
            data = io.BytesIO()
            with zipfile.ZipFile(data, "w") as archive:
                item = zipfile.ZipInfo("Payload/Runner.app/link")
                item.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(item, "../../outside")
            with self.assertRaises(s.SetupError): s.unpack_ipa(data.getvalue(), root / "symlink")
            data = io.BytesIO()
            with tarfile.open(fileobj=data, mode="w:gz") as archive:
                folder = tarfile.TarInfo("source"); folder.type = tarfile.DIRTYPE; archive.addfile(folder)
                item = tarfile.TarInfo("source/../escaped"); item.size = 1; archive.addfile(item, io.BytesIO(b"x"))
            with self.assertRaises(s.SetupError): s.unpack_source(data.getvalue(), root / "tar")
            self.assertFalse((root / "escaped").exists())

    def test_existing_setup_neither_probes_phone_nor_downloads_or_installs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve() / "optional"
            s.c.check_root(root, create=True)
            s.c.private_write(root / "installation.json", {"schemaVersion": 1, "version": "qualified",
                "device": "selected", "team": "ABCDEFGHIJ", "bundle": "dev.fixture.xctrunner"})
            with patch.object(s, "download", side_effect=AssertionError("network")), patch.object(s.subprocess, "run", side_effect=AssertionError("process")):
                self.assertEqual(s.execute([], root)["outcome"], "setup-recorded")

    def test_active_session_or_identity_change_blocks_setup_before_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve() / "optional"
            s.c.check_root(root, create=True)
            s.c.private_write(root / "session.json", {"id": "another-owner"})
            with self.assertRaises(s.SetupError) as error: s.execute([], root)
            self.assertEqual(error.exception.code, "SETUP_BUSY")
            (root / "session.json").unlink()
            s.c.private_write(root / "installation.json", {"device": "selected", "team": "ABCDEFGHIJ"})
            with self.assertRaises(s.SetupError) as error: s.execute(["--device", "other"], root)
            self.assertEqual(error.exception.code, "SELECT_DEVICE")

    def test_missing_profile_blocks_before_download_build_or_install(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve() / "optional"
            with patch.object(s, "select_profile", side_effect=s.SetupError("SIGNING_REQUIRED")), patch.object(s, "download", side_effect=AssertionError("network")):
                with self.assertRaises(s.SetupError) as error:
                    s.execute(["--device", "0" * 24, "--team-id", "ABCDEFGHIJ"], root)
            self.assertEqual(error.exception.code, "SIGNING_REQUIRED")

if __name__ == "__main__": unittest.main()
