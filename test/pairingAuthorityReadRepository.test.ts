import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  PairingAuthorityReader,
  PairingAuthorityState,
  PairingStateReader,
} from "../mac-helper/src/contracts/repository.js";
import {
  normalizePairingAuthorityState,
  PairingAuthorityReadRepository,
} from "../mac-helper/src/persistence/pairingAuthorityReadRepository.js";

const SOURCE_REVISION = digest("legacy-source");
const PROJECTION_HASH = digest("pairing-projection");
const CUTOVER_AT = "2026-08-05T18:00:00.000Z";
const ROLLBACK_EXPIRES_AT = "2026-08-12T18:00:00.000Z";
const CREDENTIAL = Object.freeze({
  token: "pairing-token",
  installationID: "installation-1",
  macName: "Miguel Mac",
  createdAt: "2026-08-05T17:00:00.000Z",
  updatedAt: "2026-08-05T17:30:00.000Z",
});
const INVITATION = Object.freeze({
  id: "invitation-1",
  inviteHash: digest("invitation-token"),
  installationID: CREDENTIAL.installationID,
  clientNonce: null,
  claimed: false,
  createdAt: "2026-08-05T17:40:00.000Z",
  expiresAt: "2026-08-05T18:10:00.000Z",
});

const LEGACY_AUTHORITY: PairingAuthorityState = {
  mode: "legacy",
  sourceRevision: null,
  projectionHash: null,
  cutoverAt: null,
  rollbackExpiresAt: null,
  finalizedAt: null,
  revision: 0,
};
const ROLLBACK_AUTHORITY: PairingAuthorityState = {
  mode: "sqlite-rollback",
  sourceRevision: SOURCE_REVISION,
  projectionHash: PROJECTION_HASH,
  cutoverAt: CUTOVER_AT,
  rollbackExpiresAt: ROLLBACK_EXPIRES_AT,
  finalizedAt: null,
  revision: 1,
};
const FINAL_AUTHORITY: PairingAuthorityState = {
  ...ROLLBACK_AUTHORITY,
  mode: "sqlite-final",
  finalizedAt: ROLLBACK_EXPIRES_AT,
  revision: 2,
};

test("legacy authority routes every read to legacy without exposing a writer", () => {
  const calls: string[] = [];
  let authorityReads = 0;
  const repository = new PairingAuthorityReadRepository({
    authorityReader: authorityReader(() => {
      authorityReads += 1;
      return LEGACY_AUTHORITY;
    }),
    legacyReader: pairingReader("legacy", calls),
    sqliteReader: pairingReader("sqlite", calls),
  });

  assert.deepEqual(repository.read(), {
    credential: CREDENTIAL,
    invitations: [INVITATION],
  });
  assert.deepEqual(repository.getCredential(CREDENTIAL.installationID), CREDENTIAL);
  assert.deepEqual(repository.getInvitation(INVITATION.id), INVITATION);
  assert.deepEqual(repository.findInvitationByInviteHash(INVITATION.inviteHash), INVITATION);

  assert.equal(authorityReads, 4);
  assert.deepEqual(calls, [
    "legacy.read",
    `legacy.getCredential:${CREDENTIAL.installationID}`,
    `legacy.getInvitation:${INVITATION.id}`,
    `legacy.findInvitationByInviteHash:${INVITATION.inviteHash}`,
  ]);
  assert.equal("replace" in repository, false);
});

test("each operation re-reads authority and routes both SQLite modes to SQLite", () => {
  const calls: string[] = [];
  let authority: PairingAuthorityState = ROLLBACK_AUTHORITY;
  let authorityReads = 0;
  const repository = new PairingAuthorityReadRepository({
    authorityReader: authorityReader(() => {
      authorityReads += 1;
      return authority;
    }),
    legacyReader: pairingReader("legacy", calls),
    sqliteReader: pairingReader("sqlite", calls),
  });

  repository.read();
  authority = FINAL_AUTHORITY;
  repository.getCredential(CREDENTIAL.installationID);
  authority = LEGACY_AUTHORITY;
  repository.getInvitation(INVITATION.id);

  assert.equal(authorityReads, 3);
  assert.deepEqual(calls, [
    "sqlite.read",
    `sqlite.getCredential:${CREDENTIAL.installationID}`,
    `legacy.getInvitation:${INVITATION.id}`,
  ]);
});

test("selected backend failure propagates without a dual-read fallback", () => {
  const calls: string[] = [];
  const sqliteReader = pairingReader("sqlite", calls);
  sqliteReader.read = () => {
    calls.push("sqlite.read");
    throw new Error("sqlite unavailable");
  };
  const repository = new PairingAuthorityReadRepository({
    authorityReader: authorityReader(() => ROLLBACK_AUTHORITY),
    legacyReader: pairingReader("legacy", calls),
    sqliteReader,
  });

  assert.throws(() => repository.read(), /sqlite unavailable/);
  assert.deepEqual(calls, ["sqlite.read"]);
});

test("malformed authority fails before either backend is called", () => {
  const calls: string[] = [];
  const legacyReader = pairingReader("legacy", calls);
  const sqliteReader = pairingReader("sqlite", calls);

  for (const authority of [
    { ...LEGACY_AUTHORITY, sourceRevision: SOURCE_REVISION },
    { ...ROLLBACK_AUTHORITY, finalizedAt: ROLLBACK_EXPIRES_AT },
    { ...FINAL_AUTHORITY, finalizedAt: CUTOVER_AT },
    { ...LEGACY_AUTHORITY, revision: "0" },
    { ...LEGACY_AUTHORITY, mode: "unknown" },
  ]) {
    const repository = new PairingAuthorityReadRepository({
      authorityReader: authorityReader(() => authority as unknown as PairingAuthorityState),
      legacyReader,
      sqliteReader,
    });
    assert.throws(() => repository.read());
  }
  assert.deepEqual(calls, []);
});

test("constructor validates narrow authority and distinct complete readers", () => {
  const calls: string[] = [];
  const legacyReader = pairingReader("legacy", calls);
  const sqliteReader = pairingReader("sqlite", calls);

  assert.throws(
    () =>
      new PairingAuthorityReadRepository({
        authorityReader: authorityReader(() => LEGACY_AUTHORITY),
        legacyReader,
        sqliteReader: legacyReader,
      }),
    /must be distinct/,
  );
  assert.throws(
    () =>
      new PairingAuthorityReadRepository({
        authorityReader: authorityReader(() => LEGACY_AUTHORITY),
        legacyReader: {
          read() {
            return { credential: null, invitations: [] };
          },
        } as unknown as PairingStateReader,
        sqliteReader,
      }),
    /must implement getCredential/,
  );
  assert.throws(
    () =>
      new PairingAuthorityReadRepository({
        authorityReader: {} as PairingAuthorityReader,
        legacyReader,
        sqliteReader,
      }),
    /must implement current/,
  );

  const repository = new PairingAuthorityReadRepository({
    authorityReader: authorityReader(() => {
      throw new Error("authority unavailable");
    }),
    legacyReader,
    sqliteReader,
  });
  assert.throws(() => repository.read(), /authority unavailable/);
  assert.deepEqual(calls, []);
});

test("authority normalization returns a canonical immutable copy", () => {
  const mutable = { ...FINAL_AUTHORITY };
  const normalized = normalizePairingAuthorityState(mutable);

  assert.deepEqual(normalized, FINAL_AUTHORITY);
  assert.equal(Object.isFrozen(normalized), true);
  assert.notEqual(normalized, mutable);
  mutable.revision = 9;
  assert.equal(normalized.revision, 2);
  assert.throws(
    () => normalizePairingAuthorityState({ ...ROLLBACK_AUTHORITY, rollbackExpiresAt: CUTOVER_AT }),
    /must follow cutoverAt/,
  );
});

function authorityReader(current: () => PairingAuthorityState): PairingAuthorityReader {
  return { current };
}

function pairingReader(name: string, calls: string[]): PairingStateReader {
  return {
    read() {
      calls.push(`${name}.read`);
      return { credential: CREDENTIAL, invitations: [INVITATION] };
    },
    getCredential(installationID) {
      calls.push(`${name}.getCredential:${installationID}`);
      return CREDENTIAL;
    },
    getInvitation(id) {
      calls.push(`${name}.getInvitation:${id}`);
      return INVITATION;
    },
    findInvitationByInviteHash(inviteHash) {
      calls.push(`${name}.findInvitationByInviteHash:${inviteHash}`);
      return INVITATION;
    },
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
