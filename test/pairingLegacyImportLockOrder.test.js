import assert from "node:assert/strict";
import test from "node:test";
import { PairingLegacyImportCoordinator } from "../mac-helper/src/persistence/pairingLegacyImport.js";

const CREDENTIAL = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});

test("pairing legacy locks use locale-independent bytewise path order", () => {
  const lockOrder = [];
  let pairingState = { credential: null, invitations: [] };
  const checkpoints = new Map();
  const coordinator = new PairingLegacyImportCoordinator({
    pairingRepository: {
      read() {
        return pairingState;
      },
      replace(snapshot) {
        pairingState = snapshot;
      },
    },
    checkpointRepository: {
      get(source) {
        return checkpoints.get(source) ?? null;
      },
      upsert(checkpoint) {
        checkpoints.set(checkpoint.source, checkpoint);
      },
    },
    fileStore: {
      readTextSync(path) {
        if (path === "/credential.json") return JSON.stringify(CREDENTIAL);
        if (path === "/invitations.json") return "[]";
        throw new Error(`Unexpected read: ${path}`);
      },
      writeTextSync() {},
    },
    lockManager: {
      withLockSync(request, operation) {
        lockOrder.push(request.path);
        return operation();
      },
    },
    credentialSource: {
      name: "pairing.json",
      path: "/credential.json",
      lockRequest: {
        path: "/Z.lock",
        waitMs: 0,
        staleAfterMs: 60_000,
        ownerMode: 0o600,
      },
    },
    invitationSource: {
      name: "pairing-invites.json",
      path: "/invitations.json",
      lockRequest: {
        path: "/a.lock",
        waitMs: 0,
        staleAfterMs: 60_000,
        ownerMode: 0o600,
      },
    },
    backupDirectory: "/backups",
    now: () => "2026-08-05T18:00:00.000Z",
  });

  coordinator.run();

  assert.deepEqual(lockOrder, ["/Z.lock", "/a.lock"]);
});
