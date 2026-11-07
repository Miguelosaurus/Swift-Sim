"""One-shot Swift Sim adapter for the unchanged, pinned iCTRL client."""
from __future__ import annotations
import argparse
import base64
import contextlib
import fcntl
import hashlib
import importlib.util
import io
import ipaddress
import json
import math
import os
from pathlib import Path
import re
import secrets
import socket
import stat
import sys
import time
import urllib.request
import uuid

VERSION = "1.98.16"
LEGACY_BOUNDED_VERSION = "1.98.16-swiftsim.1"
BOUNDED_VERSION = "1.98.16-swiftsim.2"
DURATIONS = [5, 10, 30, 60]
MAX_FILE = 64 * 1024
BUNDLE = re.compile(r"[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+\Z")
GUIDANCE = {
    "NOT_CONFIGURED": "App testing is optional. Install/open the separately signed runner, then use app-control pair.",
    "UNAVAILABLE": "Open the phone runner and check Tailscale. A developer image must be available; silent startup is not supported.",
    "PRIVATE_STATE_REQUIRED": "Use regular, owner-only files and a private app-control directory; symlinks are not accepted.",
    "INVALID_OPTIONS": "Run swift-sim app-control help for the supported options.",
    "PAIRING_REQUIRED": "Open the runner and pair this Mac. Approve only the client you requested on the phone.",
    "UPDATE_REQUIRED": "This integration qualifies iCTRL 1.98.16 with protocol v1. Use the qualified runner; no automatic update was performed.",
    "DEVICE_CHANGED": "The runner identity differs from the selected phone. No app input was sent.",
    "SESSION_BUSY": "Another local testing session owns this phone. Finish that session before opening another.",
    "SESSION_REQUIRED": "Use the session returned by app-control open. Close an expired session before starting another.",
    "FOREGROUND_REQUIRED": "The selected app is not confirmed in front, or the phone is locked. Return to the app, then inspect it again.",
    "OBSERVATION_REQUIRED": "Inspect the app again; coordinates, typing and scrolling require a fresh, unused observation.",
    "ELEMENT_UNAVAILABLE": "The matching native control is missing or not tappable. Inspect the selected app before choosing another target.",
    "ACTION_UNCONFIRMED": "Input may have happened. Inspect the selected app before deciding what to do; do not repeat the input automatically.",
    "CAPTURE_UNAVAILABLE": "An app-only image could not be confirmed. No full-screen fallback was saved or returned.",
    "STOP_UNCONFIRMED": "Runner shutdown is unconfirmed. The session is retained; check the phone and close it before starting another.",
    "PROVIDER_INVALID": "The packaged testing client does not match its pinned source. Reinstall Swift Sim before using app control.",
    "PHONE_LOCKED": "Unlock your iPhone before starting app testing.",
    "CONNECTION_UNCONFIRMED": "Open App Testing in Swift Sim and tap Start App Testing. If it closes immediately, check Apple developer support before reinstalling. A closed connection alone does not identify the cause.",
    "SESSION_ENDING": "This phone testing session is ending. Let it stop, then tap Start App Testing for a fresh session; reconnecting does not extend its deadline.",
    "REQUEST_REQUIRED": "This testing request is missing, expired, or belongs to another phone or Mac pairing. Start a new request; no input was sent.",
    "APPROVAL_REQUIRED": "Allow this exact testing request in Swift Sim before the agent uses the phone.",
    "BOUNDED_SETUP_REQUIRED": "Update the optional testing runner with app-control setup --reinstall using this phone's existing signing settings. Adjustable approval requires Swift Sim App Testing 1.98.16-swiftsim.2.",
}

class ControlError(Exception):
    def __init__(self, code): self.code = code

def fail(code): raise ControlError(code)

def private_read(path):
    path = Path(path)
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, "rb") as file:
            info = os.fstat(file.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077 or info.st_size > MAX_FILE:
                fail("PRIVATE_STATE_REQUIRED")
            return json.loads(file.read(MAX_FILE + 1))
    except ControlError: raise
    except Exception: fail("PRIVATE_STATE_REQUIRED")

def private_write(path, value):
    path = Path(path)
    temporary = path.with_name(path.name + "." + secrets.token_hex(8))
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(fd, "w") as file:
            json.dump(value, file); file.flush(); os.fsync(file.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists(): temporary.unlink()

def check_root(root, create=False):
    # Check ancestors before mkdir so a redirected optional state root is never followed.
    for part in reversed([root, *root.parents]):
        if part.is_symlink(): fail("PRIVATE_STATE_REQUIRED")
    if not root.exists():
        if not create: return False
        root.mkdir(mode=0o700, parents=True)
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        fail("PRIVATE_STATE_REQUIRED")
    return True

@contextlib.contextmanager
def exclusive(root, wait_seconds=0):
    fd = os.open(root / "operation.lock", os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077 or info.st_uid != os.getuid(): fail("PRIVATE_STATE_REQUIRED")
        deadline = time.monotonic() + wait_seconds
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline: fail("SESSION_BUSY")
                time.sleep(0.05)
        yield
    finally: os.close(fd)

def endpoint(host, port):
    try:
        ip = ipaddress.ip_address(host)
        if not (ip in ipaddress.ip_network("100.64.0.0/10") if ip.version == 4 else ip in ipaddress.ip_network("fd7a:115c:a1e0::/48")):
            fail("INVALID_OPTIONS")
        if not 1 <= int(port) <= 65535: fail("INVALID_OPTIONS")
        return f"[{ip}]:{port}" if ip.version == 6 else f"{ip}:{port}"
    except (ValueError, TypeError): fail("INVALID_OPTIONS")

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs): return None

class Provider:
    def __init__(self, root, profile):
        directory = Path(__file__).parent / "vendor"
        metadata = json.loads((directory / "provenance.json").read_text())
        source = directory / "ictrl_rpc.py"
        if hashlib.sha256(source.read_bytes()).hexdigest() != metadata["sha256"]: fail("PROVIDER_INVALID")
        spec = importlib.util.spec_from_file_location("swift_sim_ictrl", source)
        self.client = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.client)
        self.client.STORE = str(root / "credentials.json")
        self.host = endpoint(profile["host"], profile["port"])
        # Tailnet requests never use an ambient HTTP proxy or follow redirects.
        self.client._opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def call(self, method, params=None):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            value = self.client.call(self.host, method, params or {}, timeout=12, store_key="swift-sim")
        if not isinstance(value, dict) or value.get("error") or not isinstance(value.get("result"), dict): fail("UNAVAILABLE")
        return value["result"]

    def pair(self):
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            return self.client.pair(self.host, "Swift Sim App Testing", plain=False, timeout=85, store_key="swift-sim")

def phone_lifetime(value):
    if value.get("server_version") not in [LEGACY_BOUNDED_VERSION, BOUNDED_VERSION]: return None
    if "swift_sim_lifetime_v1" not in value.get("capabilities", []): fail("UPDATE_REQUIRED")
    lifetime = value.get("swift_sim_lifetime", {})
    seconds = lifetime.get("seconds_remaining")
    adjustable = value.get("server_version") == BOUNDED_VERSION
    maximum = 3600 if adjustable else 600
    duration = lifetime.get("duration_seconds") if adjustable else 600
    if adjustable and ("swift_sim_duration_v1" not in value.get("capabilities", []) or isinstance(duration, bool) or duration not in [m * 60 for m in DURATIONS]): fail("UPDATE_REQUIRED")
    if lifetime.get("maximum_seconds") != maximum or isinstance(seconds, bool) or not isinstance(seconds, (float, int)) or not math.isfinite(seconds) or not 0 <= seconds <= duration:
        fail("UPDATE_REQUIRED")
    if seconds < 5: fail("SESSION_ENDING")
    return seconds

def validate_provider_info(value):
    if value.get("server_version") not in [VERSION, LEGACY_BOUNDED_VERSION, BOUNDED_VERSION] or value.get("protocol_version") != 1: fail("UPDATE_REQUIRED")
    if not {"envelope_v1", "remote_ui", "find_element_ref", "stop_server"}.issubset(value.get("capabilities", [])): fail("UPDATE_REQUIRED")
    phone_lifetime(value)

def checked_info(provider, profile, foreground=None):
    value = provider.call("device_info")
    validate_provider_info(value)
    if value.get("device_id") != profile.get("deviceId"): fail("DEVICE_CHANGED")
    if foreground is not None:
        system = value.get("system", {})
        if system.get("screen_locked") is not False or system.get("foreground_app") != foreground: fail("FOREGROUND_REQUIRED")
    return value

def settling_feedback(result):
    # Project existing action telemetry only: no extra RPC, capture, wait or hint execution.
    value = result.get("settle")
    if not isinstance(value, dict) or type(value.get("stable")) is not bool:
        return {"status": "unavailable"}
    feedback = {"status": "settled" if value["stable"] else "unconfirmed"}
    for source, target in [("screen_changed", "screenChanged"), ("continuous_motion", "continuousMotion"),
                           ("small_change_near_tap", "smallChangeNearTap")]:
        if type(value.get(source)) is bool: feedback[target] = value[source]
    waited = value.get("waited_ms")
    if type(waited) is int and 0 <= waited <= 60_000: feedback["waitedMs"] = waited
    return feedback

def observation(provider, profile, session, root, text_filter=None):
    info = checked_info(provider, profile, session["app"])
    params = {"bundle_id": session["app"], "visible_only": True, "max_elements": 120, "max_children": 100}
    if text_filter: params["filter"] = {"text": text_filter}
    value = provider.call("page_source", params)
    if value.get("bundle_id") != session["app"]: fail("FOREGROUND_REQUIRED")
    checked_info(provider, profile, session["app"])
    source = value.get("source")
    if not isinstance(source, str): fail("UNAVAILABLE")
    session["observation"] = {"id": secrets.token_hex(12), "at": time.time(), "used": False,
        "kind": "tree", "digest": hashlib.sha256(source.encode()).hexdigest(), "width": info.get("point_width"), "height": info.get("point_height")}
    private_write(root / "session.json", session)
    channel = value.get("channel", {})
    return {"app": session["app"], "observation": session["observation"]["id"], "source": source[:12000],
        "truncated": bool(value.get("truncated") or len(source) > 12000), "coordinateSpace": "points",
        "channel": channel.get("recommended", "tree"), "keyboardVisible": value.get("keyboard", {}).get("visible")}

def use_observation(session, identifier):
    obs = session.get("observation", {})
    age = time.time() - obs.get("at", 0)
    if not identifier or obs.get("id") != identifier or obs.get("used") or not 0 <= age <= 60: fail("OBSERVATION_REQUIRED")
    obs["used"] = True
    return obs

def session_for(root, identifier, allow_expired=False):
    path = root / "session.json"
    if not path.exists(): fail("SESSION_REQUIRED")
    session = private_read(path)
    if not identifier or not secrets.compare_digest(str(session.get("id", "")), identifier): fail("SESSION_REQUIRED")
    if not allow_expired and time.time() >= session["expiresAt"]: fail("SESSION_REQUIRED")
    return session

def read_profile(root):
    if not (root / "profile.json").exists(): fail("NOT_CONFIGURED")
    value = private_read(root / "profile.json")
    if value.get("schemaVersion") != 1: fail("NOT_CONFIGURED")
    endpoint(value.get("host"), value.get("port"))
    if not isinstance(value.get("deviceId"), str) or not 1 <= len(value["deviceId"]) <= 128: fail("NOT_CONFIGURED")
    records = private_read(root / "credentials.json")
    record = records.get("swift-sim", {})
    try:
        key = bytes.fromhex(record["key"])
        if len(key) != 32 or record["tok"] != hashlib.sha256(key).digest()[:4].hex(): fail("PAIRING_REQUIRED")
    except (KeyError, ValueError, TypeError): fail("PAIRING_REQUIRED")
    return value

def parse(args):
    parser = argparse.ArgumentParser(add_help=False, exit_on_error=False)
    parser.add_argument("command", choices=["pair", "configure", "status", "check", "open", "screen", "tap", "type", "scroll", "screenshot", "close", "request-create", "request-get", "request-approve", "request-cancel"])
    for option in ["host", "key-file", "record", "device-id", "app", "session", "filter", "text", "text-file", "type", "observation", "direction", "request", "authority", "audience", "name"]:
        parser.add_argument("--" + option)
    for option in ["port", "minutes"]: parser.add_argument("--" + option, type=int)
    for option in ["x", "y"]: parser.add_argument("--" + option, type=float)
    for option in ["clear", "submit"]: parser.add_argument("--" + option, action="store_true")
    try:
        with contextlib.redirect_stderr(io.StringIO()): return parser.parse_args(args)
    except (argparse.ArgumentError, SystemExit): fail("INVALID_OPTIONS")

def testing_request(root, a, provider_factory=Provider):
    path = root / "request.json"
    now = time.time()
    if not a.authority or not re.fullmatch(r"[a-f0-9]{64}", a.authority): fail("REQUEST_REQUIRED")
    value = private_read(path) if path.exists() else None
    if value and a.command in ["request-get", "request-cancel"] and a.request == value.get("id") and a.authority == value.get("authority") and (not a.audience or a.audience == value.get("audience")) and value.get("state") in ["closed", "cancelled"]:
        if a.command == "request-cancel": value["state"] = "cancelled"
        return {"outcome": "request-" + value["state"], "request": {k: value[k] for k in ["id", "app", "name", "expiresAt", "state", "minutes"] if k in value}, "maximumSeconds": 3600}
    active = value and value.get("authority") == a.authority and value.get("createdAt", now + 1) <= now < value.get("expiresAt", 0) and value.get("state") in ["pending", "approved", "consumed"]
    if a.command == "request-create":
        if (root / "session.json").exists() or active: fail("SESSION_BUSY")
        installed = private_read(root / "installation.json") if (root / "installation.json").exists() else {}
        if installed.get("version") != BOUNDED_VERSION: fail("BOUNDED_SETUP_REQUIRED")
        profile = read_profile(root)
        if not a.app or not BUNDLE.fullmatch(a.app) or a.app.startswith("com.apple.") or not a.name or not 1 <= len(a.name) <= 80: fail("INVALID_OPTIONS")
        try: uuid.UUID(a.audience)
        except (ValueError, TypeError, AttributeError): fail("INVALID_OPTIONS")
        value = {"id": str(uuid.uuid4()), "app": a.app, "name": a.name, "authority": a.authority,
            "audience": a.audience, "deviceId": profile["deviceId"], "createdAt": now, "expiresAt": now + 300, "state": "pending"}
        private_write(path, value)
    else:
        if not active or (a.request and value["id"] != a.request) or (a.app and value["app"] != a.app) or (a.audience and value["audience"] != a.audience): fail("REQUEST_REQUIRED")
        if a.command == "request-approve":
            if a.audience != value["audience"]: fail("REQUEST_REQUIRED")
            minutes = 10 if a.minutes is None else a.minutes
            if minutes not in DURATIONS: fail("INVALID_OPTIONS")
            if value["state"] != "pending" and minutes != value.get("minutes", 10): fail("REQUEST_REQUIRED")
            if value["state"] == "pending":
                value["state"] = "approved"
                value["minutes"] = minutes
                private_write(path, value)
        elif a.command == "request-cancel":
            if value["state"] in ["approved", "consumed"]:
                session = private_read(root / "session.json") if (root / "session.json").exists() else {}
                if session and session.get("request") != value["id"]: fail("SESSION_BUSY")
                if value["state"] == "consumed" and not session: fail("REQUEST_REQUIRED")
                profile = read_profile(root)
                if profile["deviceId"] != value["deviceId"]: fail("DEVICE_CHANGED")
                close_runner(provider_factory(root, profile), profile, root, allow_unleased=True)
            value["state"] = "cancelled"
            private_write(path, value)
    return {"outcome": "request-" + value["state"], "request": {k: value[k] for k in ["id", "app", "name", "expiresAt", "state", "minutes"] if k in value}, "maximumSeconds": 3600}

def close_runner(provider, profile, root, allow_unleased=False):
    session = private_read(root / "session.json") if (root / "session.json").exists() else {}
    if not session and not allow_unleased: fail("SESSION_REQUIRED")
    try: provider.call("config", {"stop_server": True})
    except BaseException: pass
    closed = False
    for _ in range(8):
        try:
            with socket.create_connection((profile["host"], profile["port"]), timeout=0.4): pass
        except ConnectionRefusedError: closed = True; break
        except OSError: break
        time.sleep(0.2)
    if not closed: fail("STOP_UNCONFIRMED")
    if session.get("request") and (root / "request.json").exists():
        request = private_read(root / "request.json")
        if request.get("id") == session["request"]:
            request["state"] = "closed"
            private_write(root / "request.json", request)
    if (root / "session.json").exists(): (root / "session.json").unlink()
    return {"outcome": "session-closed", "runnerStopped": True}

def execute(args, root, provider_factory=Provider):
    a = parse(args)
    allowed = {
        "pair": {"host", "port"}, "configure": {"host", "port", "key_file", "record", "device_id"},
        "status": set(), "check": set(), "open": {"app", "minutes", "request", "authority"}, "screen": {"session", "filter"},
        "tap": {"session", "text", "type", "observation", "x", "y"},
        "type": {"session", "text", "text_file", "observation", "clear", "submit"},
        "scroll": {"session", "observation", "direction"}, "screenshot": {"session"}, "close": {"session"},
        "request-create": {"app", "name", "authority", "audience"}, "request-get": {"app", "request", "authority", "audience"},
        "request-approve": {"request", "authority", "audience", "minutes"}, "request-cancel": {"request", "authority", "audience"},
    }
    if any(k != "command" and v is not None and v is not False and k not in allowed[a.command] for k,v in vars(a).items()): fail("INVALID_OPTIONS")
    if not root.is_absolute(): fail("INVALID_OPTIONS")
    if not check_root(root, create=a.command in ["pair", "configure"]):
        if a.command == "status": return {"outcome": "disabled", "configured": False, "backgroundWorker": False}
        fail("NOT_CONFIGURED")
    with exclusive(root, wait_seconds=30 if a.command in ["request-cancel", "close"] else 0):
        if a.command.startswith("request-"): return testing_request(root, a, provider_factory)
        if a.command == "status":
            configured = (root / "profile.json").exists()
            if configured: read_profile(root)
            session = private_read(root / "session.json") if (root / "session.json").exists() else None
            return {"outcome": "configured" if configured else "disabled", "configured": configured,
                "backgroundWorker": False, "phoneConnection": "not-probed", "sessionActive": bool(session),
                "sessionExpired": bool(session and time.time() >= session["expiresAt"]),
                "provider": "ictrl", "version": VERSION}
        if a.command in ["pair", "configure"]:
            if (root / "session.json").exists(): fail("SESSION_BUSY")
            if (root / "profile.json").exists(): fail("INVALID_OPTIONS")
            profile = {"schemaVersion": 1, "host": a.host, "port": a.port or 8200, "deviceId": a.device_id}
            host = endpoint(profile["host"], profile["port"])
            if a.command == "configure":
                if not a.key_file or not isinstance(a.device_id, str) or not 1 <= len(a.device_id) <= 128: fail("INVALID_OPTIONS")
                records = private_read(a.key_file)
                selected = records.get(a.record or host)
                if not isinstance(selected, dict): fail("PAIRING_REQUIRED")
                try:
                    key = bytes.fromhex(selected["key"])
                    if len(key) != 32 or selected["tok"] != hashlib.sha256(key).digest()[:4].hex(): fail("PAIRING_REQUIRED")
                except (KeyError, ValueError, TypeError): fail("PAIRING_REQUIRED")
                # Import one credential, never the caller's complete multi-device store.
                private_write(root / "credentials.json", {"swift-sim": {k: selected[k] for k in ["key", "tok"] if k in selected}})
            else:
                provider = provider_factory(root, profile)
                provider.pair()
                value = provider.call("device_info")
                validate_provider_info(value)
                profile["deviceId"] = value.get("device_id")
            if not isinstance(profile["deviceId"], str) or not 1 <= len(profile["deviceId"]) <= 128: fail("INVALID_OPTIONS")
            private_write(root / "profile.json", profile); read_profile(root)
            return {"outcome": "configured", "configured": True, "provider": "ictrl", "version": VERSION}
        profile = read_profile(root)
        provider = provider_factory(root, profile)
        if a.command == "check":
            try: info = checked_info(provider, profile)
            except ControlError as error:
                if error.code != "UNAVAILABLE": raise
                fail("CONNECTION_UNCONFIRMED")
            except Exception: fail("CONNECTION_UNCONFIRMED")
            if info.get("system", {}).get("screen_locked") is not False: fail("PHONE_LOCKED")
            return {"outcome": "ready", "phoneConnection": "authenticated", "phoneUnlocked": True,
                "inputAuthorized": False, "backgroundWorker": False, "provider": "ictrl", "version": info["server_version"],
                "automaticStopOnPhone": phone_lifetime(info) is not None}
        if a.command == "open":
            if not a.app or not BUNDLE.fullmatch(a.app) or a.app.startswith("com.apple."): fail("INVALID_OPTIONS")
            if (root / "session.json").exists(): fail("SESSION_BUSY")
            minutes = 10 if a.minutes is None else a.minutes
            if not 1 <= minutes <= 60: fail("INVALID_OPTIONS")
            info = checked_info(provider, profile)
            remaining = phone_lifetime(info)
            if a.request:
                saved_command = a.command
                a.command = "request-get"
                testing_request(root, a)
                a.command = saved_command
                request = private_read(root / "request.json")
                if request["state"] != "approved": fail("APPROVAL_REQUIRED")
                if request["deviceId"] != profile["deviceId"]: fail("DEVICE_CHANGED")
                if remaining is None: fail("BOUNDED_SETUP_REQUIRED")
                if info.get("server_version") != BOUNDED_VERSION: fail("BOUNDED_SETUP_REQUIRED")
                chosen = request.get("minutes", 10)
                if a.minutes is not None and a.minutes > chosen: fail("APPROVAL_REQUIRED")
                if info.get("swift_sim_lifetime", {}).get("duration_seconds") != chosen * 60: fail("UPDATE_REQUIRED")
                minutes = chosen if a.minutes is None else a.minutes
            elif a.authority: fail("INVALID_OPTIONS")
            seconds = min(minutes * 60, max(0, remaining - 2)) if remaining is not None else minutes * 60
            session = {"id": secrets.token_hex(16), "app": a.app, "expiresAt": time.time() + seconds,
                "automaticStopOnPhone": remaining is not None}
            if a.request: session["request"] = a.request
            private_write(root / "session.json", session)
            if a.request:
                request["state"] = "consumed"
                request["expiresAt"] = session["expiresAt"]
                private_write(root / "request.json", request)
            try:
                activated = provider.call("activate_app", {"bundle_id": a.app})
                observed = observation(provider, profile, session, root)
            except BaseException:
                # Keep the lease so an uncertain launch still has an owned cleanup path.
                return {"outcome": "needs-user-action", "code": "APP_CONTROL_FOREGROUND_REQUIRED", "session": session["id"],
                    "guidance": GUIDANCE["FOREGROUND_REQUIRED"] + " Use this session to inspect or close."}
            return {"outcome": "session-open", "session": session["id"], "expiresInSeconds": int(seconds),
                "automaticStopOnPhone": remaining is not None, "settling": settling_feedback(activated), **observed}
        session = session_for(root, a.session, allow_expired=a.command == "close")
        if a.command == "close":
            return close_runner(provider, profile, root)
        if a.command == "screen": return {"outcome": "observed", **observation(provider, profile, session, root, a.filter)}
        if a.command == "screenshot":
            info = checked_info(provider, profile, session["app"])
            value = provider.call("screenshot", {"bundle_id": session["app"], "format": "jpeg", "quality": 0.6, "scale": 1})
            if value.get("scope") != "app" or value.get("scoped_to") != session["app"]: fail("CAPTURE_UNAVAILABLE")
            checked_info(provider, profile, session["app"])
            encoded = value.get("data", "")
            if not isinstance(encoded, str) or len(encoded) > 6 * 1024 * 1024: fail("CAPTURE_UNAVAILABLE")
            try: image = base64.b64decode(encoded, validate=True)
            except Exception: fail("CAPTURE_UNAVAILABLE")
            if not image.startswith(b"\xff\xd8") or not image.endswith(b"\xff\xd9") or len(image) > 4 * 1024 * 1024: fail("CAPTURE_UNAVAILABLE")
            scale = value.get("scale")
            if not isinstance(scale, (int, float)) or not math.isfinite(scale) or not 0 < scale <= 3: fail("CAPTURE_UNAVAILABLE")
            session["observation"] = {"id": secrets.token_hex(12), "at": time.time(), "used": False, "kind": "image",
                "width": info.get("point_width"), "height": info.get("point_height")}
            directory = root / "screenshots"; check_root(directory, create=True)
            target = directory / (secrets.token_hex(12) + ".jpg")
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "wb") as file: file.write(image)
            private_write(root / "session.json", session)
            return {"outcome": "captured", "app": session["app"], "path": str(target), "mimeType": "image/jpeg", "bytes": len(image),
                "observation": session["observation"]["id"], "imageScale": scale, "coordinateSpace": "points",
                "pointWidth": info.get("point_width"), "pointHeight": info.get("point_height") }
        checked_info(provider, profile, session["app"])
        before = session.get("observation", {}).get("digest") if session.get("observation", {}).get("kind") == "tree" else None
        params = {"settle": True, "settle_timeout": 1}
        if a.command == "tap" and a.text is not None:
            if a.x is not None or a.y is not None or not 1 <= len(a.text) <= 300: fail("INVALID_OPTIONS")
            found = provider.call("find_element", {"bundle_id": session["app"], "element_id": a.text, "match": "exact",
                **({"element_type": a.type} if a.type else {})})
            if found.get("exists") is not True or found.get("hittable") is not True or not found.get("ref"): fail("ELEMENT_UNAVAILABLE")
            checked_info(provider, profile, session["app"])
            params["ref"] = found["ref"]; method = "tap"
        else:
            obs = use_observation(session, a.observation)
            if a.command == "tap":
                if a.x is None or a.y is None or not all(isinstance(v, (float, int)) and math.isfinite(v) for v in [a.x, a.y, obs.get("width"), obs.get("height")]): fail("INVALID_OPTIONS")
                if not 0 <= a.x <= obs["width"] or not 0 <= a.y <= obs["height"]: fail("INVALID_OPTIONS")
                params.update(x=a.x, y=a.y); method = "tap"
            elif a.command == "type":
                text = a.text
                if a.text_file:
                    if text is not None: fail("INVALID_OPTIONS")
                    # A JSON string file avoids putting sensitive test input in process arguments.
                    text = private_read(a.text_file)
                if not isinstance(text, str) or len(text) > 2000: fail("INVALID_OPTIONS")
                params.update(text=text, clear=a.clear, submit=a.submit); method = "type"
            elif a.command == "scroll":
                directions = {"down": "up", "up": "down", "left": "right", "right": "left"}
                if a.direction not in directions: fail("INVALID_OPTIONS")
                params.update(direction=directions[a.direction], distance=280, velocity="slow"); method = "swipe"
            else: fail("INVALID_OPTIONS")
        session.get("observation", {})["used"] = True
        private_write(root / "session.json", session)
        try: action_result = provider.call(method, params)
        except BaseException: fail("ACTION_UNCONFIRMED")
        try: observed = observation(provider, profile, session, root)
        except BaseException: fail("ACTION_UNCONFIRMED")
        return {"outcome": "input-sent", "sourceChanged": before != session["observation"]["digest"] if before is not None else None,
            "settling": settling_feedback(action_result), **observed}

def main():
    os.umask(0o077)
    try:
        request = json.loads(sys.stdin.read(65536))
        result = execute(request["args"], Path(request["stateRoot"]))
    except ControlError as error:
        result = {"outcome": "needs-user-action", "code": "APP_CONTROL_" + error.code, "guidance": GUIDANCE[error.code]}
    except BaseException:
        # Provider exceptions may contain tokens, addresses or typed text. Never echo them.
        result = {"outcome": "needs-user-action", "code": "APP_CONTROL_UNAVAILABLE", "guidance": GUIDANCE["UNAVAILABLE"]}
    result["schemaVersion"] = 1
    print(json.dumps(result))
    return 1 if result["outcome"] == "needs-user-action" else 0

if __name__ == "__main__": sys.exit(main())
