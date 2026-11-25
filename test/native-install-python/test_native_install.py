import importlib.util
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("native_install", Path(__file__).parents[2] / "mac-helper/resources/native-install.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


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
        self.lose_receipt = False
        self.profile_devices = ["UDID"]
        self.preparer = patch.object(module, "prepare", side_effect=self.prepare)
        self.extractor = patch.object(module, "extract", return_value=self.root / "Test.app")
        self.preparer.start()
        self.extractor.start()

    def tearDown(self):
        self.preparer.stop()
        self.extractor.stop()
        self.scratch.cleanup()

    def prepare(self, ipa, out):
        out.mkdir(mode=0o700)
        (out / "manifest.json").write_text(json.dumps({"identity": {"bundle": "example.Test", "version": "1", "build": self.options.build},
                                                       "team": "TEAM", "sha256": "a" * 64, "devices": self.profile_devices}))
        (out / "manifest.json").chmod(0o400)

    def command(self, args, timeout=12, **kwargs):
        if args == ["list", "devices"]:
            return {"devices": [self.device]}
        if args[:3] == ["device", "info", "apps"]:
            return {"apps": self.inventory}
        if args[:3] == ["device", "install", "app"]:
            self.installs += 1
            if self.lose_receipt:
                raise TimeoutError("lost receipt")
            self.inventory = [{"bundleIdentifier": "example.Test", "version": "1", "bundleVersion": self.options.build}]
            return {}
        if args[:3] == ["device", "process", "launch"]:
            return {}
        self.fail("unexpected command")

    def run_delivery(self):
        return module.deliver(self.options, self.command)

    def test_foreground_observation_is_read_only_and_accepts_same_or_newer_inventory(self):
        self.options.observe = True
        self.inventory[0]["bundleVersion"] = "2"
        self.assertEqual(self.run_delivery()["state"], "not-found", "unbound inventory cannot clear a handoff")
        self.assertFalse(Path(self.options.root).exists())
        self.options.observe = False
        self.inventory[0]["bundleVersion"] = "1"
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.options.observe = True
        journal = next(Path(self.options.root).glob("*.json"))
        original = journal.read_bytes()
        for build, expected in [("1", "not-found"), ("2", "installed-version-observed"), ("3", "installed-version-observed")]:
            self.inventory[0]["bundleVersion"] = build
            result = self.run_delivery()
            self.assertEqual(result["state"], expected)
            self.assertEqual(result.get("boundDeviceVerified", False), expected == "installed-version-observed")
        self.inventory[0]["teamIdentifier"] = "different-fixture"
        self.assertEqual(self.run_delivery()["state"], "not-found")
        self.assertEqual(self.installs, 1)
        self.assertEqual(journal.read_bytes(), original)
        self.options.team = "ANOTHER-TEAM"
        self.assertEqual(self.run_delivery()["state"], "not-found")

    def test_complete_inventory_duplicate_and_temp_cleanup(self):
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.installs, 1)
        self.assertFalse(list(Path(self.options.root).glob("prepare-*")))

    def test_paired_disconnected_coredevice_can_install_an_archive_without_a_running_app(self):
        self.device["deviceProperties"] = {"developerModeStatus": "enabled"}
        self.device["connectionProperties"] = {
            "pairingState": "paired", "tunnelState": "disconnected", "transportType": "localNetwork"}
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.installs, 1)

    def test_disconnected_coredevice_that_cannot_answer_inventory_never_installs(self):
        self.device["deviceProperties"] = {"developerModeStatus": "enabled"}
        self.device["connectionProperties"] = {
            "pairingState": "paired", "tunnelState": "disconnected", "transportType": "localNetwork"}

        def unreachable(args, timeout=12, **kwargs):
            if args[:3] == ["device", "info", "apps"]:
                raise ValueError("developer_connection_unavailable")
            return self.command(args, timeout)

        self.assertEqual(module.deliver(self.options, unreachable)["code"], "DEVELOPER_CONNECTION_UNAVAILABLE")
        self.assertEqual(self.installs, 0)

    def test_lost_receipt_restart_and_different_build_cannot_resubmit(self):
        self.lose_receipt = True
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.options.build_id = "build-2"
        self.options.build = "3"
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(self.installs, 1)
        self.assertEqual(len(list(Path(self.options.root).glob("prepare-*"))), 1)

    def test_reconcile_inventory_without_second_install(self):
        self.lose_receipt = True
        self.run_delivery()
        self.inventory[0]["bundleVersion"] = "2"
        self.options.status = True
        self.assertEqual(self.run_delivery()["state"], "installed-version-observed")
        self.assertEqual(self.installs, 1)
        self.options.status = False
        self.options.build_id = "build-2"
        self.options.build = "3"
        self.lose_receipt = False
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.installs, 2)
        self.assertFalse(list(Path(self.options.root).glob("prepare-*")))

    def test_newer_inventory_resolves_old_uncertainty_and_releases_staging(self):
        self.lose_receipt = True
        self.run_delivery()
        self.inventory[0]["bundleVersion"] = "3"
        self.options.build_id = "build-2"
        self.options.build = "4"
        self.lose_receipt = False
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.assertEqual(self.installs, 2)
        self.assertFalse(list(Path(self.options.root).glob("prepare-*")))
        journal = next(Path(self.options.root).glob("*.json"))
        old = json.loads(journal.read_text())["entries"]["build-1"]
        self.assertEqual(old["state"], "superseded")
        self.assertFalse(old["cleanupPending"])
        self.options.build_id = "build-1"
        self.options.build = "2"
        self.assertEqual(self.run_delivery()["state"], "superseded")
        self.assertEqual(self.installs, 2)

    def test_expiry_does_not_replay_an_unresolved_native_handoff(self):
        self.lose_receipt = True
        self.run_delivery()
        self.options.expires_at = 1
        self.options.build_id = "build-2"
        result = self.run_delivery()
        self.assertEqual(result["code"], "INSTALL_RECONCILE_REQUIRED")
        self.assertEqual(result["nextAction"], "check-status")
        self.assertEqual(self.installs, 1)

    def test_terminal_history_prunes_on_status_reads(self):
        self.run_delivery()
        journal = next(Path(self.options.root).glob("*.json"))
        value = json.loads(journal.read_text())
        value["entries"]["build-1"]["expires"] = 1
        journal.write_text(json.dumps(value))
        self.options.status = True
        self.assertEqual(self.run_delivery()["state"], "not-found")
        self.assertEqual(json.loads(journal.read_text())["entries"], {})
        self.assertEqual(json.loads(journal.read_text())["boundDevice"], "UDID")
        self.assertEqual(self.installs, 1)

    def test_terminal_pruning_does_not_wait_for_an_unresolved_native_handoff(self):
        self.lose_receipt = True
        self.run_delivery()
        journal = next(Path(self.options.root).glob("*.json"))
        value = json.loads(journal.read_text())
        value["entries"]["old-terminal"] = {**value["entries"]["build-1"], "buildID": "old-terminal",
                                              "state": "installed", "cleanupPending": False, "expires": 1}
        journal.write_text(json.dumps(value))
        self.options.status = True
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertEqual(set(json.loads(journal.read_text())["entries"]), {"build-1"})
        self.assertEqual(self.installs, 1)

    def test_unproven_staging_path_is_never_removed(self):
        self.lose_receipt = True
        self.run_delivery()
        journal = next(Path(self.options.root).glob("*.json"))
        value = json.loads(journal.read_text())
        victim = self.root / "preserve"
        victim.mkdir()
        value["entries"]["build-1"]["staging"] = str(victim)
        journal.write_text(json.dumps(value))
        self.inventory[0]["bundleVersion"] = "2"
        self.assertEqual(self.run_delivery()["state"], "unconfirmed")
        self.assertTrue(victim.exists())
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
        self.device["connectionProperties"]["tunnelState"] = "unavailable"
        self.assertEqual(self.run_delivery()["state"], "unavailable")
        self.device["connectionProperties"]["tunnelState"] = "connected"
        def ambiguous(args, timeout=12, **kwargs):
            return {"devices": [self.device, self.device]}
        self.assertEqual(module.deliver(self.options, ambiguous)["state"], "unavailable")
        self.assertEqual(self.installs, 0)

    def test_multiple_profile_eligible_phones_require_and_keep_a_trusted_choice(self):
        other = {**self.device, "identifier": "DEVICE-2",
                 "hardwareProperties": {**self.device["hardwareProperties"], "udid": "UDID-2"},
                 "connectionProperties": {"pairingState": "paired", "tunnelState": "unavailable"}}
        self.profile_devices.append("UDID-2")
        probes = []
        submissions = []
        other_reachable = False

        def two_devices(args, timeout=12, **kwargs):
            if args == ["list", "devices"]:
                return {"devices": [self.device, other]}
            if args[:3] == ["device", "info", "apps"]:
                probes.append(args[4])
                if args[4] in ("DEVICE-2", "UDID-2") and not other_reachable:
                    raise TimeoutError("target still asleep")
            if args[:3] == ["device", "install", "app"]:
                submissions.append(args[4])
            return self.command(args, timeout)

        for state in ["unavailable", "disconnected", "connected"]:
            other["connectionProperties"]["tunnelState"] = state
            result = module.deliver(self.options, two_devices)
            self.assertEqual(result["code"], "INSTALL_DEVICE_SELECTION_REQUIRED")
            self.assertIn("--device", result["message"])
        self.assertEqual(probes, [])
        self.assertEqual(submissions, [])
        self.assertEqual(self.run_delivery()["code"], "INSTALL_DEVICE_SELECTION_REQUIRED",
                         "the signed profile still permits another device omitted from Xcode's list")
        other_reachable = True
        self.options.device = "UDID-2"
        self.assertEqual(module.deliver(self.options, two_devices)["state"], "installed")
        self.assertEqual(probes, ["DEVICE-2", "DEVICE-2"])
        self.options.device = "DEVICE"
        self.assertEqual(module.deliver(self.options, two_devices)["state"], "blocked")
        self.assertEqual(probes, ["DEVICE-2", "DEVICE-2"])
        self.options.device = ""
        self.options.build_id = "build-2"
        self.options.build = "3"
        other_reachable = False
        probes.clear()
        self.assertEqual(module.deliver(self.options, two_devices)["state"], "blocked")
        self.assertEqual(probes, ["DEVICE-2"])
        self.options.observe = True
        self.options.device = "UDID"
        probes.clear()
        self.assertEqual(module.deliver(self.options, two_devices)["state"], "unconfirmed")
        self.assertEqual(probes, ["UDID-2"])
        self.options.observe = False
        self.options.device = ""
        other_reachable = True
        probes.clear()
        self.assertEqual(module.deliver(self.options, two_devices)["state"], "installed")
        self.assertEqual(probes, ["DEVICE-2", "DEVICE-2"])
        self.assertEqual(submissions, ["DEVICE-2", "DEVICE-2"])

    def test_shortened_or_late_inventory_never_proves_absence_or_submits(self):
        for probe_start in [16, 5]:
            ticks = [0]

            def delayed(args, timeout=12, **kwargs):
                ticks[0] = probe_start if args == ["list", "devices"] else 31
                return self.command(args, timeout)

            with patch.object(module.time, "monotonic", side_effect=lambda: ticks[0]):
                self.assertEqual(module.deliver(self.options, delayed)["state"], "unavailable")
            self.assertEqual(self.installs, 0)

    def test_subprocess_cannot_extend_a_probe_past_its_deadline(self):
        with patch.object(module.time, "monotonic", return_value=16), patch.object(module.subprocess, "run") as child:
            with self.assertRaises(TimeoutError):
                module.run(["list", "devices"], deadline=30)
            child.assert_not_called()

    def test_team_mismatch_and_explicit_device_selection(self):
        self.inventory[0]["teamIdentifier"] = "OTHER"
        self.inventory[0]["bundleVersion"] = self.options.build
        self.assertEqual(self.run_delivery()["code"], "EXISTING_APP_TEAM_UNCONFIRMED")
        self.options.device = "NOT-THIS-PHONE"
        self.assertEqual(self.run_delivery()["state"], "unavailable")
        self.assertEqual(self.installs, 0)

    def test_a_receipt_for_the_previous_phone_does_not_confirm_the_new_saved_phone(self):
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.options.build_id = "build-2"
        self.options.build = "3"
        self.options.device = "UDID-2"
        self.profile_devices.append("UDID-2")
        self.device["identifier"] = "DEVICE-2"
        self.device["hardwareProperties"]["udid"] = "UDID-2"
        self.assertEqual(self.run_delivery()["state"], "installed")
        self.options.build_id = "build-1"
        self.options.build = "2"
        self.options.device = ""
        self.assertEqual(self.run_delivery()["code"], "INSTALL_RECEIPT_DEVICE_MISMATCH")
        self.assertEqual(self.installs, 2)

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
