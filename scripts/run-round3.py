#!/usr/bin/env python3
from pathlib import Path
import runpy

path = Path("scripts/apply-round3.py")
text = path.read_text()
text = text.replace("devicePageMatch", "deviceWebMatch")
text = text.replace(
    "re.subn(pattern, replacement, text, count=1, flags=re.S)",
    "re.subn(pattern, lambda _match: replacement, text, count=1, flags=re.S)",
)
patched = Path("scripts/.apply-round3-runtime.py")
patched.write_text(text)
try:
    runpy.run_path(str(patched), run_name="__main__")
    app = Path("Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift")
    source = app.read_text()
    old = '''    private static func clearPreviousPendingTransaction() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: previousPendingAccountKey)
        defaults.removeObject(forKey: previousPendingPairingIDKey)
    }
'''
    new = '''    private static func clearPreviousPendingTransaction() {
        let defaults = UserDefaults.standard
        if defaults.object(forKey: previousPendingAccountKey) != nil {
            defaults.removeObject(forKey: previousPendingAccountKey)
        }
        if defaults.object(forKey: previousPendingPairingIDKey) != nil {
            defaults.removeObject(forKey: previousPendingPairingIDKey)
        }
    }
'''
    if old not in source:
        raise SystemExit("Missing clearPreviousPendingTransaction block")
    source = source.replace(old, new, 1)
    early_cleanup = '''        if let previousPending, previousPending != stagedAccount {
            deleteToken(account: previousPending)
        }
        clearPreviousPendingTransaction()
        return true
'''
    retained = '''        // Keep the prior staged transaction reachable until this new pairing
        // is either committed or cancelled. Reconciliation deletes it only
        // after the new metadata becomes authoritative.
        return true
'''
    if early_cleanup not in source:
        raise SystemExit("Missing early previous-pairing cleanup block")
    app.write_text(source.replace(early_cleanup, retained, 1))
finally:
    patched.unlink(missing_ok=True)
