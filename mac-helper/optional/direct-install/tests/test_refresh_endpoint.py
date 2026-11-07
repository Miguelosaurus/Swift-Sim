import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("refresh_endpoint", Path(__file__).parents[1] / "refresh_endpoint.py")
endpoint = importlib.util.module_from_spec(spec)
spec.loader.exec_module(endpoint)


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory()
        self.root = Path(self.scratch.name)
        self.peer = self.root / "peer.json"
        self.original = {"host": "100.64.0.2", "port": 53032, "udid": "synthetic-device", "pairing_file": "/private/pinned-fixture.plist"}
        self.peer.write_text(json.dumps(self.original))
        self.peer.chmod(0o600)
        self.calls = []

    def tearDown(self):
        self.scratch.cleanup()

    def invoke(self, runner):
        return endpoint.refresh(Path("native-fixture"), Path("prepared-fixture"), self.peer, self.root / "state", run=runner)

    def query(self, args, timeout, success_port=49152):
        self.calls.append(args)
        self.assertLessEqual(timeout, 8)
        if args[0] == "/usr/bin/dns-sd":
            if args[1] == "-B":
                return "12:00:00 Add 2 4 local. _remotepairing._tcp. Synthetic Phone\n12:00:01 Add 2 4 local. _remotepairing._tcp. Other Service\n"
            port = 49152 if args[2] == "Synthetic Phone" else 62001
            return f"service can be reached at synthetic.local.:{port} (interface 4)\n"
        self.assertEqual(args[1], "inspect")
        self.assertEqual(args[-1], "--execute")
        peer = json.loads(Path(args[3]).read_text())
        self.assertEqual({k: v for k, v in peer.items() if k != "port"}, {k: v for k, v in self.original.items() if k != "port"})
        if peer["port"] == success_port:
            return json.dumps({"ok": True, "state": "installer-reachable", "matchingVersion": False})
        return json.dumps({"ok": False, "state": "pairing_connection_refused"})

    def test_advertisement_is_verified_at_explicit_tailnet_peer_before_cache_write(self):
        result = self.invoke(self.query)
        self.assertEqual(result["state"], "endpoint-refreshed-and-verified")
        self.assertEqual(json.loads(self.peer.read_text()), dict(self.original, port=49152))
        self.assertEqual(self.peer.stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.root.iterdir()), [self.peer])
        self.assertTrue(all(c[1] == "inspect" for c in self.calls if c[0] != "/usr/bin/dns-sd"))

    def test_cached_working_endpoint_does_not_start_bonjour(self):
        result = self.invoke(lambda args, timeout: self.query(args, timeout, success_port=53032))
        self.assertFalse(result["changed"])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(json.loads(self.peer.read_text()), self.original)

    def test_unverified_advertisements_preserve_config_and_remove_temporary_file(self):
        original = self.peer.read_bytes()
        with self.assertRaisesRegex(endpoint.RefreshError, "no_verified_endpoint_found"):
            self.invoke(lambda args, timeout: self.query(args, timeout, success_port=-1))
        self.assertEqual(self.peer.read_bytes(), original)
        self.assertEqual(list(self.root.iterdir()), [self.peer])

    def test_concurrent_config_change_is_not_overwritten(self):
        replacement = dict(self.original, port=54321)

        def runner(args, timeout):
            result = self.query(args, timeout)
            if args[0] != "/usr/bin/dns-sd" and json.loads(result).get("ok"):
                self.peer.write_text(json.dumps(replacement))
            return result

        with self.assertRaisesRegex(endpoint.RefreshError, "peer_config_changed"):
            self.invoke(runner)
        self.assertEqual(json.loads(self.peer.read_text()), replacement)
        self.assertEqual(list(self.root.iterdir()), [self.peer])

    def test_authentication_failure_never_re_pairs_or_changes_peer(self):
        calls = []

        def runner(args, timeout):
            calls.append(args)
            return json.dumps({"ok": False, "state": "peer_authentication_failed"})

        with self.assertRaisesRegex(endpoint.RefreshError, "endpoint_verification_failed"):
            self.invoke(runner)
        self.assertEqual(len(calls), 1)
        self.assertEqual(json.loads(self.peer.read_text()), self.original)

    def test_cli_requires_execute_before_any_input_or_network_access(self):
        result = subprocess.run([sys.executable, str(Path(endpoint.__file__)), "--installer", "missing", "--prepared", "missing", "--peer", "missing", "--state", "missing"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["state"], "explicit_execute_required")


if __name__ == "__main__":
    unittest.main()
