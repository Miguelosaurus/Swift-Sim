import assert from "node:assert/strict";
import test from "node:test";
import { SessionLockedLegacySnapshotReader } from "../mac-helper/src/persistence/sessionLockedLegacySnapshot.js";

const path = "/state/sessions.json";
const lockRequest = {
  path: `${path}.lock`,
  waitMs: 5000,
  staleAfterMs: 30000,
  ownerMode: 0o600,
};
const raw = JSON.stringify({
  sessions: [
    {
      id: "session-1",
      token: "token-1",
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-1",
      createdAt: "2026-08-14T10:00:00.000Z",
      revision: 77,
      updatedAt: "2026-08-14T11:00:00.000Z",
      stream: { state: "running", pid: 4242, port: 9191 },
      build: { state: "ready" },
      logs: ["runtime"],
    },
  ],
});

function fileStore() {
  const files = new Map([[path, raw]]);
  return {
    files,
    readTextSync(filePath) {
      if (!files.has(filePath)) {
        const error = new Error("missing");
        error.code = "ENOENT";
        throw error;
      }
      return files.get(filePath);
    },
    writeTextSync(filePath, value, options) {
      if (files.has(filePath) && options.replace === false) {
        const error = new Error("exists");
        error.code = "EEXIST";
        throw error;
      }
      files.set(filePath, value);
    },
  };
}

test("locked legacy snapshot projects through the six-field boundary under the exact legacy lock", () => {
  const files = fileStore();
  const calls = [];
  const lockManager = {
    withLockSync(request, operation) {
      calls.push(request);
      return operation();
    },
  };
  const reader = new SessionLockedLegacySnapshotReader({
    fileStore: files,
    lockManager,
    source: { name: "sessions", path, lockRequest },
    backupDirectory: "/backups",
  });

  const locked = reader.withLockedSnapshot((snapshot) => snapshot);
  assert.deepEqual(calls, [lockRequest]);
  assert.deepEqual(locked.snapshot, [
    {
      id: "session-1",
      token: "token-1",
      project: "/tmp/App.xcodeproj",
      scheme: "App",
      simulatorUDID: "SIM-1",
      createdAt: "2026-08-14T10:00:00.000Z",
    },
  ]);
  assert.equal(locked.recordCount, 1);
  assert.equal(locked.backups.length, 1);
  assert.equal(files.files.get(locked.backups[0]), raw);
});
