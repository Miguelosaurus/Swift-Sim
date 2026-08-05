import assert from "node:assert/strict";
import { createHash } from "node:crypto";
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
import { PairingLegacyImportApplier } from "../mac-helper/src/persistence/pairingLegacyImport.js";
import {
  PairingLockedLegacySnapshotReader,
  pairingProjectionHash,
} from "../mac-helper/src/persistence/pairingLockedLegacySnapshot.js";

const CREDENTIAL = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});
const INVITATION = Object.freeze({
  id: "invitation-1",
  inviteHash: digest("private-invite"),
  installationID: CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T16:02:00.000Z",
  expiresAt: "2026-08-05T16:12:00.000Z",
});

test("locked snapshot keeps exact legacy bytes protected through import application", () => {
  const harness = createHarness();
  let pairingState: PairingStateSnapshot = { credential: null, invitations: [] };
  const checkpoints = new Map<string, LegacyImportCheckpoint>();
  const applier = new PairingLegacyImportApplier({
    pairingRepository: pairingRepository(
      () => pairingState,
      (snapshot) => {
        pairingState = snapshot;
      },
    ),
    checkpointRepository: checkpointRepository(checkpoints),
    now: () => "2026-08-05T18:00:00.000Z",
  });

  const result = harness.reader.withLockedSnapshot((locked) => {
    assert.deepEqual(harness.activeLocks, ["/Z.lock", "/a.lock"]);
    assert.equal(Object.isFrozen(locked), true);
    assert.equal(Object.isFrozen(locked.snapshot), true);
    assert.equal(Object.isFrozen(locked.snapshot.credential), true);
    assert.equal(Object.isFrozen(locked.snapshot.invitations), true);
    assert.equal(Object.isFrozen(locked.snapshot.invitations[0]), true);
    assert.equal(Object.isFrozen(locked.backups), true);
    assert.match(locked.sourceRevision, /^[a-f0-9]{64}$/);
    assert.match(locked.projectionHash, /^[a-f0-9]{64}$/);
    assert.equal(locked.recordCount, 2);
    return applier.apply(locked);
  });

  assert.equal(result.status, "applied");
  assert.deepEqual(pairingState, {
    credential: CREDENTIAL,
    invitations: [INVITATION],
  });
  assert.equal(checkpoints.size, 1);
  assert.deepEqual(harness.activeLocks, []);
  assert.deepEqual(harness.lockEvents, [
    "acquire:/Z.lock",
    "acquire:/a.lock",
    "release:/a.lock",
    "release:/Z.lock",
  ]);
  assert.equal(result.backups.length, 2);
  for (const backup of result.backups) {
    assert.equal(harness.files.has(backup), true);
    assert.ok((harness.backupReads.get(backup) ?? 0) >= 1);
  }
});

test("locked snapshot rejects asynchronous callbacks and always releases locks", () => {
  const harness = createHarness();

  assert.throws(
    () => harness.reader.withLockedSnapshot(async () => "late"),
    /must complete synchronously/,
  );
  assert.deepEqual(harness.lockEvents, []);

  assert.throws(
    () => harness.reader.withLockedSnapshot(() => Promise.resolve("late")),
    /must complete synchronously/,
  );
  assert.deepEqual(harness.activeLocks, []);
  assert.deepEqual(harness.lockEvents, [
    "acquire:/Z.lock",
    "acquire:/a.lock",
    "release:/a.lock",
    "release:/Z.lock",
  ]);

  harness.lockEvents.length = 0;
  assert.throws(
    () =>
      harness.reader.withLockedSnapshot(() => {
        throw new Error("cutover failed");
      }),
    /cutover failed/,
  );
  assert.deepEqual(harness.activeLocks, []);
  assert.deepEqual(harness.lockEvents, [
    "acquire:/Z.lock",
    "acquire:/a.lock",
    "release:/a.lock",
    "release:/Z.lock",
  ]);
});

test("import applier rejects forged locked evidence before SQLite mutation", () => {
  let replacements = 0;
  const applier = new PairingLegacyImportApplier({
    pairingRepository: pairingRepository(
      () => ({ credential: null, invitations: [] }),
      () => {
        replacements += 1;
      },
    ),
    checkpointRepository: checkpointRepository(new Map()),
  });
  const snapshot = { credential: CREDENTIAL, invitations: [INVITATION] };

  assert.throws(
    () =>
      applier.apply({
        snapshot,
        sourceRevision: digest("source"),
        projectionHash: digest("forged-projection"),
        recordCount: 2,
        backups: [],
      }),
    /projectionHash does not match/,
  );
  assert.throws(
    () =>
      applier.apply({
        snapshot,
        sourceRevision: digest("source"),
        projectionHash: pairingProjectionHash(snapshot),
        recordCount: 1,
        backups: [],
      }),
    /recordCount does not match/,
  );
  assert.equal(replacements, 0);
});

function createHarness() {
  const files = new Map<string, string>([
    ["/credential.json", JSON.stringify(CREDENTIAL)],
    ["/invitations.json", JSON.stringify([INVITATION])],
  ]);
  const backupReads = new Map<string, number>();
  const activeLocks: string[] = [];
  const lockEvents: string[] = [];
  const fileStore = memoryFileStore(files, backupReads);
  const lockManager = trackingLockManager(activeLocks, lockEvents);
  const reader = new PairingLockedLegacySnapshotReader({
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
  });
  return { reader, files, backupReads, activeLocks, lockEvents };
}

function pairingRepository(
  read: () => PairingStateSnapshot,
  replace: (snapshot: PairingStateSnapshot) => void,
): PairingStateRepository {
  return {
    read,
    replace,
    getCredential(installationID) {
      const credential = read().credential;
      return credential?.installationID === installationID ? credential : null;
    },
    getInvitation(id) {
      return read().invitations.find((invitation) => invitation.id === id) ?? null;
    },
    findInvitationByInviteHash(inviteHash) {
      return read().invitations.find((invitation) => invitation.inviteHash === inviteHash) ?? null;
    },
  };
}

function checkpointRepository(
  checkpoints: Map<string, LegacyImportCheckpoint>,
): LegacyImportCheckpointRepository {
  return {
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
}

function memoryFileStore(
  files: Map<string, string>,
  backupReads: Map<string, number>,
): AtomicFileStore {
  return {
    async readText(path) {
      return this.readTextSync(path);
    },
    readTextSync(path) {
      if (path.startsWith("/backups/")) {
        backupReads.set(path, (backupReads.get(path) ?? 0) + 1);
      }
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
}

function trackingLockManager(active: string[], events: string[]): LockManager {
  return {
    async acquire(request) {
      return leaseFor(request.path);
    },
    acquireSync(request) {
      return leaseFor(request.path);
    },
    async withLock(request, operation) {
      events.push(`acquire:${request.path}`);
      active.push(request.path);
      try {
        return await operation(leaseFor(request.path));
      } finally {
        assert.equal(active.pop(), request.path);
        events.push(`release:${request.path}`);
      }
    },
    withLockSync(request, operation) {
      events.push(`acquire:${request.path}`);
      active.push(request.path);
      try {
        return operation(leaseFor(request.path));
      } finally {
        assert.equal(active.pop(), request.path);
        events.push(`release:${request.path}`);
      }
    },
  };
}

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

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
