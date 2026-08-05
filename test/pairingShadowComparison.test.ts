import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { PairingShadowMismatchObservation } from "../mac-helper/src/contracts/repository.js";
import { PairingShadowComparator } from "../mac-helper/src/persistence/pairingShadowComparison.js";
import { PAIRING_SQLITE_MIGRATIONS } from "../mac-helper/src/persistence/pairingSqliteSchema.js";
import { SqlitePairingShadowMismatchRepository } from "../mac-helper/src/persistence/sqlitePairingShadowMismatchRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const CREDENTIAL = Object.freeze({
  token: "secret-pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T16:00:00.000Z",
  updatedAt: "2026-08-05T16:01:00.000Z",
});
const ROTATED_CREDENTIAL = Object.freeze({
  ...CREDENTIAL,
  token: "rotated-secret-token",
  updatedAt: "2026-08-05T16:05:00.000Z",
});
const INVITATION = Object.freeze({
  id: "private-invitation-id",
  inviteHash: digest("private-invite-token"),
  installationID: CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T16:02:00.000Z",
  expiresAt: "2026-08-05T16:12:00.000Z",
});

async function temporaryDatabasePath(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-pairing-shadow-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  return join(root, "swift-sim.sqlite");
}

function openStores(path: string) {
  const database = new SwiftSimSqliteDatabase({
    path,
    migrations: PAIRING_SQLITE_MIGRATIONS,
  });
  return {
    database,
    repository: new SqlitePairingShadowMismatchRepository(database),
  };
}

test("matching pairing projections produce no durable evidence", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new PairingShadowComparator({
    mismatchRepository: stores.repository,
    now: () => "2026-08-05T18:00:00.000Z",
  });

  const result = comparator.compare({
    surface: "credential",
    key: CREDENTIAL.installationID,
    legacy: CREDENTIAL,
    sqlite: {
      updatedAt: CREDENTIAL.updatedAt,
      createdAt: CREDENTIAL.createdAt,
      macName: CREDENTIAL.macName,
      installationID: CREDENTIAL.installationID,
      token: CREDENTIAL.token,
    },
  });

  assert.equal(result.matched, true);
  assert.equal(result.evidence, null);
  assert.deepEqual(stores.repository.list(), []);
  assert.throws(
    () =>
      comparator.compare({
        surface: "credential",
        key: INVITATION.id,
        legacy: INVITATION,
        sqlite: INVITATION,
      }),
    /pairing credential/,
  );
});

test("mismatches persist deterministic redacted evidence and coalesce observations", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openStores(path);
  let now = "2026-08-05T18:00:00.000Z";
  const comparator = new PairingShadowComparator({
    mismatchRepository: stores.repository,
    now: () => now,
  });

  const first = comparator.compare({
    surface: "credential",
    key: CREDENTIAL.installationID,
    legacy: CREDENTIAL,
    sqlite: ROTATED_CREDENTIAL,
  });
  now = "2026-08-05T18:01:00.000Z";
  const second = comparator.compare({
    surface: "credential",
    key: CREDENTIAL.installationID,
    legacy: CREDENTIAL,
    sqlite: ROTATED_CREDENTIAL,
  });
  now = "2026-08-05T17:59:00.000Z";
  const backwardClock = comparator.compare({
    surface: "credential",
    key: CREDENTIAL.installationID,
    legacy: CREDENTIAL,
    sqlite: ROTATED_CREDENTIAL,
  });

  assert.equal(first.matched, false);
  assert.equal(second.matched, false);
  assert.equal(first.evidence?.mismatchID, second.evidence?.mismatchID);
  assert.equal(backwardClock.evidence?.observationCount, 3);
  assert.equal(backwardClock.evidence?.firstObservedAt, "2026-08-05T18:00:00.000Z");
  assert.equal(backwardClock.evidence?.lastObservedAt, "2026-08-05T18:01:00.000Z");
  const serialized = JSON.stringify(backwardClock.evidence);
  for (const secret of [
    CREDENTIAL.token,
    ROTATED_CREDENTIAL.token,
    CREDENTIAL.macName,
    CREDENTIAL.installationID,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  stores.database.close();

  const reopened = openStores(path);
  t.after(() => reopened.database.close());
  assert.deepEqual(
    reopened.repository.get(backwardClock.evidence!.mismatchID),
    backwardClock.evidence,
  );
  assert.equal(reopened.database.health().schemaVersion, 3);
});

test("null projections match while missing SQLite rows record one redacted mismatch", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const comparator = new PairingShadowComparator({
    mismatchRepository: stores.repository,
    now: () => "2026-08-05T18:00:00.000Z",
  });

  assert.equal(
    comparator.compare({
      surface: "invitation",
      key: INVITATION.id,
      legacy: null,
      sqlite: null,
    }).matched,
    true,
  );
  const missing = comparator.compare({
    surface: "invitation",
    key: INVITATION.id,
    legacy: INVITATION,
    sqlite: null,
  });

  assert.equal(missing.matched, false);
  assert.equal(missing.sqliteProjectionHash, null);
  assert.equal(missing.evidence?.observationCount, 1);
  assert.equal(JSON.stringify(missing.evidence).includes(INVITATION.id), false);
});

test("repository rejects malformed or forged shadow evidence before SQLite mutation", async (t) => {
  const path = await temporaryDatabasePath(t);
  const stores = openStores(path);
  t.after(() => stores.database.close());
  const valid: PairingShadowMismatchObservation = {
    mismatchID: digest("forged"),
    surface: "credential",
    keyHash: digest("installation-1"),
    legacyProjectionHash: digest("legacy"),
    sqliteProjectionHash: digest("sqlite"),
    observedAt: "2026-08-05T18:00:00.000Z",
  };

  assert.throws(() => stores.repository.observe(valid), /does not match/);
  assert.throws(
    () =>
      stores.repository.observe({
        ...valid,
        mismatchID: "not-a-hash",
      }),
    /lowercase SHA-256/,
  );
  assert.throws(
    () =>
      stores.repository.observe({
        ...valid,
        mismatchID: digest("same"),
        legacyProjectionHash: digest("same-projection"),
        sqliteProjectionHash: digest("same-projection"),
      }),
    /different projections/,
  );
  assert.throws(
    () =>
      stores.repository.observe({
        ...valid,
        observedAt: "2026-08-05T18:00:00Z",
      }),
    /canonical UTC timestamp/,
  );
  assert.deepEqual(stores.repository.list(), []);
});

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
