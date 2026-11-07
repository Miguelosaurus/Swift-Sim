import json
from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parents[1]))
import deliver as module


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.options = SimpleNamespace(root=str(self.root / "state"), build_id="build-1", bundle="example.Test",
                                       version="1", build="2", team="TEAM", ipa="fixture.ipa", status=False, device="", expires_at=4102444800)
        self.installs = 0
        self.inventory = [{"bundleIdentifier": "example.Test", "version": "1", "bundleVersion": "1", "teamIdentifier": "TEAM"}]
        self.device = {"identifier": "DEVICE", "hardwareProperties": {"platform": "iOS", "reality": "physical", "udid": "UDID"},
                       "deviceProperties": {"pairingState": "paired"}, "connectionProperties": {"tunnelState": "connected"}}
        self.fail = False
        self.preparer = patch.object(module, "prepare", side_effect=self.prepare)
        self.extractor = patch.object(module, "extract", return_value=self.root / "Test.app")
        self.preparer.start()
        self.extractor.start()

    def tearDown(self):
        self.preparer.stop()
        self.extractor.stop()
        self.scratch.cleanup()

    def prepare(self, ipa, out):
        out.mkdir()
        (out / "manifest.json").write_text(json.dumps({"identity": {"bundle": "example.Test", "version": "1", "build": self.options.build},
                                                       "team": "TEAM", "sha256": "a" * 64, "devices": ["UDID"]}))

    def command(self, args, timeout=12):
        if args == ["list", "devices"]:
            return {"devices": [self.device]}
        if args[:3] == ["device", "info", "apps"]:
            return {"apps": self.inventory}
        if args[:3] == ["device", "install", "app"]:
            self.installs += 1
            if self.fail:
                raise TimeoutError("lost receipt")
            self.inventory = [{"bundleIdentifier": "example.Test", "version": "1", "bundleVersion": self.options.build}]
            return {}
        if args[:3] == ["device", "process", "launch"]:
            return {}
        self.failTest("unexpected command")

    def run_delivery(self):
        return module.deliver(self.options, self.command)

    def test_complete_inventory_duplicate_and_temp_cleanup(self):
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.installs, 1)
        self.assertFalse(list(Path(self.options.root).glob("prepare-*")))

    def test_lost_receipt_restart_and_different_build_cannot_resubmit(self):
        self.fail = True
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.options.build_id = "build-2"
        self.options.build = "3"
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(self.installs, 1)
        self.assertEqual(len(list(Path(self.options.root).glob("prepare-*"))), 1)

    def test_reconcile_inventory_without_second_install(self):
        self.fail = True
        self.run_delivery()
        self.inventory[0]["bundleVersion"] = "2"
        self.options.status = True
        self.assertEqual(self.run_delivery()["state"], "installed-version-observed")
        self.assertEqual(self.installs, 1)
        self.options.status = False
        self.options.build_id = "build-2"
        self.options.build = "3"
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(self.installs, 1)

    def test_retains_old_receipt_after_a_later_build(self):
        self.run_delivery()
        self.options.build_id = "build-2"
        self.options.build = "3"
        self.run_delivery()
        self.options.build_id = "build-1"
        self.options.build = "2"
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.installs, 2)

    def test_unavailable_and_ambiguous_devices_do_not_submit(self):
        self.device["connectionProperties"]["tunnelState"] = "disconnected"
        self.assertEqual(self.run_delivery()["state"], "unavailable")
        self.device["connectionProperties"]["tunnelState"] = "connected"
        def ambiguous(args, timeout=12):
            return {"devices": [self.device, self.device]}
        self.assertEqual(module.deliver(self.options, ambiguous)["state"], "unavailable")
        self.assertEqual(self.installs, 0)

    def test_team_mismatch_and_explicit_device_selection(self):
        self.inventory[0]["teamIdentifier"] = "OTHER"
        self.assertEqual(self.run_delivery()["state"], "unavailable")
        self.options.device = "NOT-THIS-PHONE"
        self.assertEqual(self.run_delivery()["state"], "unavailable")
        self.assertEqual(self.installs, 0)

    def test_failed_durable_fence_never_installs(self):
        with patch.object(module, "save", side_effect=OSError("disk full")):
            with self.assertRaises(OSError):
                self.run_delivery()
        self.assertEqual(self.installs, 0)

    def test_status_has_no_preparation_or_mutations(self):
        self.options.status = True
        with patch.object(module, "prepare", side_effect=AssertionError("unexpected preparation")):
            self.assertEqual(self.run_delivery()["state"], "not-found")
        self.assertEqual(self.installs, 0)

    def test_unknown_journal_schema_preserves_evidence_without_submission(self):
        import hashlib
        root = Path(self.options.root)
        root.mkdir(mode=0o700)
        path = root / (hashlib.sha256(b"TEAM:example.Test").hexdigest() + ".json")
        path.write_text('{"schema": 999, "entries": {}}')
        path.chmod(0o600)
        with self.assertRaises(ValueError):
            self.run_delivery()
        self.assertEqual(self.installs, 0)
        self.assertIn('999', path.read_text())

    def test_lock_prevents_concurrent_submission(self):
        import fcntl
        import hashlib
        root = Path(self.options.root)
        root.mkdir(mode=0o700)
        key = hashlib.sha256(b"TEAM:example.Test").hexdigest()
        with (root / (key + ".lock")).open("w") as lock:
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
            self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(self.installs, 0)


if __name__ == "__main__":
    unittest.main()
