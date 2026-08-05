import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { PairingStateSnapshot } from "../mac-helper/src/contracts/repository.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import {
  normalizePairingStateSnapshot,
  SqlitePairingStateRepository,
} from "../mac-helper/src/persistence/sqlitePairingStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CREDENTIAL = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});
const INVITATION_A = Object.freeze({
  id: "invite-a",
  inviteHash: digest("invite-a"),
  installationID: CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T16:02:00.000Z",
  expiresAt: "2026-08-05T16:12:00.000Z",
});
const INVITATION_B = Object.freeze({
  id: "invite-b",
  inviteHash: digest("invite-b"),
  installationID: CREDENTIAL.installationID,
  clientNonce: "client-nonce",
  claimed: true,
  createdAt: "2026-08-05T16:03:00.000Z",
  expiresAt: "2026-08-05T16:13:00.000Z",
  claimedAt: "2026-08-05T16:04:00.000Z",
});
const BASELINE: PairingStateSnapshot = Object.freeze({
  credential: CREDENTIAL,
  invitations: Object.freeze([INVITATION_A]),
});

async function temporaryDatabasePath(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-sqlite-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "swift-sim.sqlite");
}

function openRepository(path: string) {
  const database = new SwiftSimSqliteDatabase({
    path,
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  return {
    database,
    repository: new SqlitePairingStateRepository(database),
  };
}

test("pairing snapshot persists canonically across reopen", async (t) => {
  const path = await temporaryDatabasePath(t);
  const first = openRepository(path);
  first.repository.replace({
    credential: CREDENTIAL,
    invitations: [INVITATION_B, INVITATION_A],
  });

  assert.equal(
    first.database.health().schemaVersion,
    PAIRING_SQLITE_MIGRATIONS.at(-1)?.version,
  );
  assert.deepEqual(first.repository.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });
  assert.deepEqual(first.repository.getCredential(CREDENTIAL.installationID), CREDENTIAL);
  assert.deepEqual(first.repository.getInvitation(INVITATION_A.id), INVITATION_A);
  assert.deepEqual(
    first.repository.findInvitationByInviteHash(INVITATION_B.inviteHash),
    INVITATION_B,
  );
  first.database.close();

  const reopened = openRepository(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(reopened.repository.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });
});

test("snapshot normalization is deterministic and rejects inconsistent domain state", () => {
  assert.deepEqual(
    normalizePairingStateSnapshot({
      credential: CREDENTIAL,
      invitations: [INVITATION_B, INVITATION_A],
    }),
    {
      credential: CREDENTIAL,
      invitations: [INVITATION_A, INVITATION_B],
    },
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: null,
        invitations: [INVITATION_A],
      }),
    /without a pairing credential/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: CREDENTIAL,
        invitations: [
          {
            ...INVITATION_A,
            installationID: "another-installation",
          },
        ],
      }),
    /belong to the snapshot credential/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: CREDENTIAL,
        invitations: [INVITATION_A, { ...INVITATION_A, inviteHash: digest("duplicate") }],
      }),
    /Duplicate pairing id/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: CREDENTIAL,
        invitations: [INVITATION_A, { ...INVITATION_B, inviteHash: INVITATION_A.inviteHash }],
      }),
    /Duplicate pairing inviteHash/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: CREDENTIAL,
        invitations: [{ ...INVITATION_A, inviteHash: "not-a-digest" }],
      }),
    /lowercase SHA-256 digest/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: CREDENTIAL,
        invitations: [{ ...INVITATION_A, clientNonce: "unexpected" }],
      }),
    /cannot contain claim evidence/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: CREDENTIAL,
        invitations: [{ ...INVITATION_B, claimedAt: INVITATION_B.expiresAt }],
      }),
    /within its active interval/,
  );
  assert.throws(
    () =>
      normalizePairingStateSnapshot({
        credential: { ...CREDENTIAL, updatedAt: "2026-08-05T15:59:00.000Z" },
        invitations: [],
      }),
    /updatedAt cannot precede createdAt/,
  );
});

test("invalid replacement is rejected before the persisted snapshot changes", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.replace(BASELINE);

  assert.throws(
    () =>
      stores.repository.replace({
        credential: null,
        invitations: [INVITATION_A],
      }),
    /without a pairing credential/,
  );
  assert.deepEqual(stores.repository.read(), BASELINE);
});

test("replacement rolls back credential and invitation changes after a late SQLite failure", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.replace(BASELINE);
  stores.database.exec(`CREATE TRIGGER reject_blocked_pairing_invitation
    BEFORE INSERT ON pairing_invitations
    WHEN NEW.id = 'blocked-second'
    BEGIN
      SELECT RAISE(ABORT, 'blocked pairing invitation');
    END`);

  const rotatedCredential = {
    ...CREDENTIAL,
    token: "rotated-token",
    updatedAt: "2026-08-05T16:05:00.000Z",
  };
  assert.throws(
    () =>
      stores.repository.replace({
        credential: rotatedCredential,
        invitations: [
          {
            ...INVITATION_A,
            id: "allowed-first",
            inviteHash: digest("allowed-first"),
          },
          {
            ...INVITATION_A,
            id: "blocked-second",
            inviteHash: digest("blocked-second"),
          },
        ],
      }),
    /blocked pairing invitation/,
  );

  assert.deepEqual(stores.repository.read(), BASELINE);
});

test("an empty snapshot atomically removes credential and invitations", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openRepository(path);
  t.after(() => stores.database.close());
  stores.repository.replace({
    credential: CREDENTIAL,
    invitations: [INVITATION_A, INVITATION_B],
  });

  stores.repository.replace({ credential: null, invitations: [] });

  assert.deepEqual(stores.repository.read(), { credential: null, invitations: [] });
  assert.equal(stores.repository.getCredential(CREDENTIAL.installationID), null);
  assert.equal(stores.repository.getInvitation(INVITATION_A.id), null);
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
