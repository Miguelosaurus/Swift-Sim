import assert from "node:assert/strict";
import test from "node:test";
import type {
  LegacyImportCheckpoint,
  LegacyImportCheckpointRepository,
  PairingStateRepository,
  PairingStateSnapshot,
} from "../mac-helper/src/contracts/repository.js";
import type {
  AtomicFileStore,
  AtomicWriteOptions,
  LockLease,
  LockManager,
  LockRequest,
} from "../mac-helper/src/infrastructure/ports.js";
import { PairingLegacyImportCoordinator } from "../mac-helper/src/persistence/pairingLegacyImport.js";

const CREDENTIAL = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});

test("pairing legacy locks use locale-independent bytewise path order", () => {
  const lockOrder: string[] = [];
  let backupReadCount = 0;
  let pairingState: PairingStateSnapshot = { credential: null, invitations: [] };
  const checkpoints = new Map<string, LegacyImportCheckpoint>();
  const files = new Map<string, string>([
    ["/credential.json", JSON.stringify(CREDENTIAL)],
    ["/invitations.json", "[]"],
  ]);

  const pairingRepository: PairingStateRepository = {
    read() {
      return pairingState;
    },
    replace(snapshot) {
      pairingState = snapshot;
    },
    getCredential(installationID) {
      return pairingState.credential?.installationID === installationID
        ? pairingState.credential
        : null;
    },
    getInvitation(id) {
      return pairingState.invitations.find((invitation) => invitation.id === id) ?? null;
    },
    findInvitationByInviteHash(inviteHash) {
      return (
        pairingState.invitations.find((invitation) => invitation.inviteHash === inviteHash) ?? null
      );
    },
  };
  const checkpointRepository: LegacyImportCheckpointRepository = {
    transaction<T>(operation: () => T): T {
      return operation();
    },
    get(source) {
      return checkpoints.get(source) ?? null;
    },
    list() {
      return [...checkpoints.values()];
    },
    upsert(checkpoint) {
      checkpoints.set(checkpoint.source, checkpoint);
    },
  };
  const fileStore: AtomicFileStore = {
    async readText(path) {
      return this.readTextSync(path);
    },
    readTextSync(path) {
      if (path.startsWith("/backups/")) backupReadCount += 1;
      const value = files.get(path);
      if (value === undefined) throw missingFileError(path);
      return value;
    },
    async readJSON(path) {
      return this.readJSONSync(path);
    },
    readJSONSync(path) {
      return JSON.parse(this.readTextSync(path));
    },
    async writeText(path, value, options) {
      this.writeTextSync(path, value, options);
    },
    writeTextSync(path, value, options) {
      writeFile(files, path, value, options);
    },
    async writeJSON(path, value, options) {
      this.writeJSONSync(path, value, options);
    },
    writeJSONSync(path, value, options) {
      writeFile(files, path, JSON.stringify(value), options);
    },
    async remove(path) {
      this.removeSync(path);
    },
    removeSync(path) {
      files.delete(path);
    },
  };
  const lockManager: LockManager = {
    async acquire(request) {
      return leaseFor(request.path);
    },
    acquireSync(request) {
      return leaseFor(request.path);
    },
    async withLock(request, operation) {
      lockOrder.push(request.path);
      return operation(leaseFor(request.path));
    },
    withLockSync(request, operation) {
      lockOrder.push(request.path);
      return operation(leaseFor(request.path));
    },
  };

  const coordinator = new PairingLegacyImportCoordinator({
    pairingRepository,
    checkpointRepository,
    fileStore,
    lockManager,
    credentialSource: {
      name: "pairing.json",
      path: "/credential.json",
      lockRequest: lockRequest("/Z.lock"),
    },
    invitationSource: {
      name: "pairing-invites.json",
      path: "/invitations.json",
      lockRequest: lockRequest("/a.lock"),
    },
    backupDirectory: "/backups",
    now: () => "2026-08-05T18:00:00.000Z",
  });

  coordinator.run();

  assert.deepEqual(lockOrder, ["/Z.lock", "/a.lock"]);
  assert.equal(backupReadCount, 2);
});

function writeFile(
  files: Map<string, string>,
  path: string,
  value: string,
  options: AtomicWriteOptions,
): void {
  if (!options.replace && files.has(path)) {
    const error = new Error(`File already exists: ${path}`) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  files.set(path, value);
}

function missingFileError(path: string): NodeJS.ErrnoException {
  const error = new Error(`File not found: ${path}`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function lockRequest(path: string): LockRequest {
  return {
    path,
    waitMs: 0,
    staleAfterMs: 60_000,
    ownerMode: 0o600,
  };
}

function leaseFor(path: string): LockLease {
  return {
    path,
    ownerPath: `${path}.owner`,
    ownerNonce: `nonce:${path}`,
    async release() {},
    releaseSync() {},
  };
}
