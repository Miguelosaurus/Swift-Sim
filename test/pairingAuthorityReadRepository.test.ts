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

const PREPARATION_ID = digest("pairing-preparation");
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
  preparationID: null,
  sourceRevision: null,
  projectionHash: null,
  cutoverAt: null,
  rollbackExpiresAt: null,
  finalizedAt: null,
  revision: 0,
};
const PREPARING_AUTHORITY: PairingAuthorityState = {
  mode: "legacy-preparing",
  preparationID: PREPARATION_ID,
  sourceRevision: null,
  projectionHash: null,
  cutoverAt: CUTOVER_AT,
  rollbackExpiresAt: ROLLBACK_EXPIRES_AT,
  finalizedAt: null,
  revision: 1,
};
const ROLLBACK_AUTHORITY: PairingAuthorityState = {
  mode: "sqlite-rollback",
  preparationID: PREPARATION_ID,
  sourceRevision: SOURCE_REVISION,
  projectionHash: PROJECTION_HASH,
  cutoverAt: CUTOVER_AT,
  rollbackExpiresAt: ROLLBACK_EXPIRES_AT,
  finalizedAt: null,
  revision: 2,
};
const FINAL_AUTHORITY: PairingAuthorityState = {
  ...ROLLBACK_AUTHORITY,
  mode: "sqlite-final",
  finalizedAt: ROLLBACK_EXPIRES_AT,
  revision: 3,
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

test("preparation remains legacy-readable and every operation refreshes authority", () => {
  const calls: string[] = [];
  const authorities: PairingAuthorityState[] = [
    PREPARING_AUTHORITY,
    ROLLBACK_AUTHORITY,
    FINAL_AUTHORITY,
    LEGACY_AUTHORITY,
  ];
  let authorityReads = 0;
  const repository = new PairingAuthorityReadRepository({
    authorityReader: authorityReader(() => {
      const authority = authorities[authorityReads];
      authorityReads += 1;
      if (!authority) throw new Error("unexpected authority read");
      return authority;
    }),
    legacyReader: pairingReader("legacy", calls),
    sqliteReader: pairingReader("sqlite", calls),
  });

  repository.read();
  repository.getCredential(CREDENTIAL.installationID);
  repository.getInvitation(INVITATION.id);
  repository.findInvitationByInviteHash(INVITATION.inviteHash);

  assert.equal(authorityReads, 4);
  assert.deepEqual(calls, [
    "legacy.read",
    `sqlite.getCredential:${CREDENTIAL.installationID}`,
    `sqlite.getInvitation:${INVITATION.id}`,
    `legacy.findInvitationByInviteHash:${INVITATION.inviteHash}`,
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
    { ...LEGACY_AUTHORITY, preparationID: PREPARATION_ID },
    { ...PREPARING_AUTHORITY, sourceRevision: SOURCE_REVISION },
    { ...PREPARING_AUTHORITY, preparationID: "not-a-hash" },
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

test("authority normalization returns canonical immutable copies for preparation and final state", () => {
  for (const authority of [PREPARING_AUTHORITY, FINAL_AUTHORITY]) {
    const mutable = { ...authority };
    const normalized = normalizePairingAuthorityState(mutable);

    assert.deepEqual(normalized, authority);
    assert.equal(Object.isFrozen(normalized), true);
    assert.notEqual(normalized, mutable);
    mutable.revision = 9;
    assert.equal(normalized.revision, authority.revision);
  }
  assert.throws(
    () => normalizePairingAuthorityState({ ...PREPARING_AUTHORITY, rollbackExpiresAt: CUTOVER_AT }),
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
