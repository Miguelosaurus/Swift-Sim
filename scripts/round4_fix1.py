#!/usr/bin/env python3
from pathlib import Path

path = Path("Companion/SwiftSimCompanion/SwiftSimCompanionApp.swift")
text = path.read_text()
old = '''    private static func savePendingHistory(_ history: [PendingCredential]) {
        let defaults = UserDefaults.standard
        guard !history.isEmpty else {
            defaults.removeObject(forKey: pendingHistoryKey)
            return
        }
        if let data = try? JSONEncoder().encode(history) {
            defaults.set(data, forKey: pendingHistoryKey)
        }
    }
'''
new = '''    private static func savePendingHistory(_ history: [PendingCredential]) {
        let defaults = UserDefaults.standard
        guard !history.isEmpty else {
            if defaults.object(forKey: pendingHistoryKey) != nil {
                defaults.removeObject(forKey: pendingHistoryKey)
            }
            return
        }
        if let data = try? JSONEncoder().encode(history),
           defaults.data(forKey: pendingHistoryKey) != data {
            defaults.set(data, forKey: pendingHistoryKey)
        }
    }
'''
if old not in text:
    raise SystemExit("Missing savePendingHistory block")
path.write_text(text.replace(old, new, 1))
