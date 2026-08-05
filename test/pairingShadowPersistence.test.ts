import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type {
  PairingCredentialRecord,
  PairingInvitationRecord,
} from "../mac-helper/src/contracts/pairing.js";
import type { PairingInvitationRepository } from "../mac-helper/src/contracts/repository.js";
import { PairingShadowImporter } from "../mac-helper/src/persistence/pairingShadowImporter.js";
import {
  normalizePairingShadowProjection,
  pairingShadowProjectionHash,
} from "../mac-helper/src/persistence/pairingShadowProjection.js";
import { PAIRING_SHADOW_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import {
  SqlitePairingCredentialRepository,
  SqlitePairingInvitationRepository,
} from "../mac-helper/src/persistence/pairingStateRepository.js";
import { SqliteLegacyImportCheckpointRepository } from "../mac-helper/src/persistence/sqliteLegacyImportCheckpointRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const IMPORTED_AT = "2026-08-05T16:15:00.000Z";
const UPDATED_IMPORTED_AT = "2026-08-05T16:16:00.000Z";
const CREDENTIAL: PairingCredentialRecord = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});
const OTHER_CREDENTIAL: PairingCredentialRecord = Object.freeze({
  ...CREDENTIAL,
  token: "other-pairing-token",
  installationID: "installation-2",
});
const INVITATION_A: PairingInvitationRecord = Object.freeze({
  id: "invite-a",
  inviteHash: digest("invite-a"),
  installationID: CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T16:02:00.000Z",
  expiresAt: "2026-08-05T16:12:00.000Z",
});
const INVITATION_B: PairingInvitationRecord = Object.freeze({
  id: "invite-b",
  inviteHash: digest("invite-b"),
  installationID: CREDENTIAL.installationID,
  clientNonce: "client-nonce",
  claimed: true,
  createdAt: "2026-08-05T16:03:00.000Z",
  expiresAt: "2026-08-05T16:13:00.000Z",
  claimedAt: "2026-08-05T16:04:00.000Z",
});

async function temporaryDatabasePath(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-shadow-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "swift-sim.sqlite");
}

function openRepositories(path: string) {
  const database = new SwiftSimSqliteDatabase({
    path,
    migrations: PAIRING_SHADOW_SQLITE_MIGRATIONS,
    now: () => IMPORTED_AT,
  });
  return {
    database,
    credentials: new SqlitePairingCredentialRepository(database),
    invitations: new SqlitePairingInvitationRepository(database),
    checkpoints: new SqliteLegacyImportCheckpointRepository(database),
  };
}

test("pairing repositories persist one normalized installation across reopen", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepositories(path);
  first.database.transaction(() => {
    first.credentials.upsert(CREDENTIAL);
    first.invitations.upsert(INVITATION_B);
    first.invitations.upsert(INVITATION_A);
  });

  assert.deepEqual(first.database.health(), {
    ok: true,
    path,
    integrity: "ok",
    journalMode: "wal",
    foreignKeys: true,
    foreignKeyViolations: 0,
    missingTables: [],
    schemaVersion: 2,
    latestSchemaVersion: 2,
    migrationsApplied: 2,
  });
  assert.deepEqual(first.credentials.list(), [CREDENTIAL]);
  assert.deepEqual(first.invitations.list(), [INVITATION_A, INVITATION_B]);
  assert.deepEqual(
    first.invitations.findByInviteHash(INVITATION_B.inviteHash),
    INVITATION_B,
  );
  assert.throws(
    () => first.credentials.replaceAll([CREDENTIAL, OTHER_CREDENTIAL]),
    /at most one credential/,
  );
  assert.throws(
    () => first.credentials.replaceAll([{ ...CREDENTIAL, token: "" }]),
    /Invalid pairing credential contract/,
  );
  assert.deepEqual(first.credentials.list(), [CREDENTIAL]);
  assert.deepEqual(first.invitations.list(), [INVITATION_A, INVITATION_B]);
  first.database.close();

  const reopened = openRepositories(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.credentials.get(CREDENTIAL.installationID), CREDENTIAL);
  assert.deepEqual(reopened.invitations.get(INVITATION_A.id), INVITATION_A);
});

test("projection ordering is ordinal and independent of input order", () => {
  const invitationZ: PairingInvitationRecord = {
    ...INVITATION_A,
    id: "z",
    inviteHash: digest("z"),
  };
  const invitationUmlaut: PairingInvitationRecord = {
    ...INVITATION_A,
    id: "ä",
    inviteHash: digest("umlaut"),
  };
  const forward = normalizePairingShadowProjection({
    credential: CREDENTIAL,
    invitations: [invitationUmlaut, invitationZ],
  });
  const reversed = normalizePairingShadowProjection({
    credential: CREDENTIAL,
    invitations: [invitationZ, invitationUmlaut],
  });

  assert.deepEqual(
    forward.invitations.map((invitation) => invitation.id),
    ["z", "ä"],
  );
  assert.deepEqual(reversed, forward);
  assert.equal(pairingShadowProjectionHash(reversed), pairingShadowProjectionHash(forward));
});

test("shadow import is transactional, immutable by revision, and exactly idempotent", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepositories(path);
  t.after(() => stores.database.close());
  let clockCalls = 0;
  const importer = new PairingShadowImporter({
    transactionOwner: stores.database,
    credentials: stores.credentials,
    invitations: stores.invitations,
    checkpoints: stores.checkpoints,
    now: () => {
      clockCalls += 1;
      return clockCalls === 1 ? IMPORTED_AT : UPDATED_IMPORTED_AT;
    },
  });

  const first = importer.import({
    source: "pairing-json",
    sourceRevision: "legacy-revision-1",
    credential: CREDENTIAL,
    invitations: [INVITATION_B, INVITATION_A],
  });
  assert.match(first.projectionHash, /^[a-f0-9]{64}$/);
  assert.equal(first.recordCount, 3);
  assert.equal(clockCalls, 1);
  assert.deepEqual(importer.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });

  const repeated = importer.import({
    source: "pairing-json",
    sourceRevision: "legacy-revision-1",
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });
  assert.deepEqual(repeated, first);
  assert.equal(clockCalls, 1);

  assert.throws(
    () =>
      importer.import({
        source: "pairing-json",
        sourceRevision: "legacy-revision-1",
        credential: CREDENTIAL,
        invitations: [INVITATION_A],
      }),
    /already recorded with a different projection/,
  );
  assert.equal(clockCalls, 1);
  assert.deepEqual(importer.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });
  assert.deepEqual(stores.checkpoints.get("pairing-json"), first);

  const changedRevision = importer.import({
    source: "pairing-json",
    sourceRevision: "legacy-revision-2",
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });
  assert.equal(changedRevision.projectionHash, first.projectionHash);
  assert.equal(changedRevision.importedAt, UPDATED_IMPORTED_AT);
  assert.equal(clockCalls, 2);
  assert.equal(stores.checkpoints.get("pairing-json")?.sourceRevision, "legacy-revision-2");
});

test("same source revision repairs a drifted SQLite shadow without changing its projection", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepositories(path);
  t.after(() => stores.database.close());
  let clockCalls = 0;
  const importer = new PairingShadowImporter({
    transactionOwner: stores.database,
    credentials: stores.credentials,
    invitations: stores.invitations,
    checkpoints: stores.checkpoints,
    now: () => {
      clockCalls += 1;
      return clockCalls === 1 ? IMPORTED_AT : UPDATED_IMPORTED_AT;
    },
  });
  importer.import({
    source: "pairing-json",
    sourceRevision: "legacy-revision-1",
    credential: CREDENTIAL,
    invitations: [INVITATION_A],
  });
  stores.credentials.upsert({ ...CREDENTIAL, token: "drifted-token" });

  const repaired = importer.import({
    source: "pairing-json",
    sourceRevision: "legacy-revision-1",
    credential: CREDENTIAL,
    invitations: [INVITATION_A],
  });

  assert.equal(repaired.importedAt, UPDATED_IMPORTED_AT);
  assert.equal(clockCalls, 2);
  assert.deepEqual(importer.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION_A],
  });
});

test("read-back mismatch rolls back rows and checkpoint evidence", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepositories(path);
  t.after(() => stores.database.close());
  const baselineImporter = new PairingShadowImporter({
    transactionOwner: stores.database,
    credentials: stores.credentials,
    invitations: stores.invitations,
    checkpoints: stores.checkpoints,
    now: () => IMPORTED_AT,
  });
  baselineImporter.import({
    source: "pairing-json",
    sourceRevision: "baseline",
    credential: CREDENTIAL,
    invitations: [INVITATION_A],
  });
  const baselineProjection = baselineImporter.read();
  const baselineCheckpoint = stores.checkpoints.get("pairing-json");

  const corruptingInvitations: PairingInvitationRepository = {
    get: (id) => stores.invitations.get(id),
    findByInviteHash: (inviteHash) => stores.invitations.findByInviteHash(inviteHash),
    upsert: (record) => stores.invitations.upsert(record),
    replaceAll: (records) => stores.invitations.replaceAll(records),
    list: () =>
      stores.invitations.list().map((record, index) =>
        index === 0 ? { ...record, claimed: !record.claimed } : record,
      ),
  };
  const importer = new PairingShadowImporter({
    transactionOwner: stores.database,
    credentials: stores.credentials,
    invitations: corruptingInvitations,
    checkpoints: stores.checkpoints,
    now: () => UPDATED_IMPORTED_AT,
  });

  assert.throws(
    () =>
      importer.import({
        source: "pairing-json",
        sourceRevision: "must-roll-back",
        credential: CREDENTIAL,
        invitations: [INVITATION_B],
      }),
    /projection mismatch/,
  );
  assert.deepEqual(baselineImporter.read(), baselineProjection);
  assert.deepEqual(stores.checkpoints.get("pairing-json"), baselineCheckpoint);
});

test("invalid projections and foreign-key violations fail closed", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepositories(path);
  t.after(() => stores.database.close());
  const importer = new PairingShadowImporter({
    transactionOwner: stores.database,
    credentials: stores.credentials,
    invitations: stores.invitations,
    checkpoints: stores.checkpoints,
  });

  assert.throws(
    () =>
      importer.import({
        source: "pairing-json",
        sourceRevision: "missing-credential",
        credential: null,
        invitations: [INVITATION_A],
      }),
    /without a pairing credential/,
  );
  assert.throws(
    () =>
      importer.import({
        source: "pairing-json",
        sourceRevision: "wrong-installation",
        credential: CREDENTIAL,
        invitations: [{ ...INVITATION_A, installationID: "other-installation" }],
      }),
    /belong to the imported installation/,
  );
  assert.throws(
    () =>
      importer.import({
        source: "pairing-json",
        sourceRevision: "invalid-hash",
        credential: CREDENTIAL,
        invitations: [{ ...INVITATION_A, inviteHash: "not-a-digest" }],
      }),
    /lowercase SHA-256 digest/,
  );
  assert.throws(() => stores.invitations.upsert(INVITATION_A), /FOREIGN KEY/);
  assert.deepEqual(stores.credentials.list(), []);
  assert.deepEqual(stores.invitations.list(), []);
  assert.equal(stores.checkpoints.get("pairing-json"), null);
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
