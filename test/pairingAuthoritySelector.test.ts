import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  PairingAuthorityRepository,
  PairingAuthorityState,
  PairingStateRepository,
} from "../mac-helper/src/contracts/repository.js";
import {
  normalizePairingAuthorityState,
  PairingAuthoritySelector,
} from "../mac-helper/src/persistence/pairingAuthoritySelector.js";

const SOURCE_REVISION = digest("legacy-source");
const PROJECTION_HASH = digest("pairing-projection");
const CUTOVER_AT = "2026-08-05T18:00:00.000Z";
const ROLLBACK_EXPIRES_AT = "2026-08-12T18:00:00.000Z";

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

test("selector reads authority once and returns the legacy repository without invoking it", () => {
  const backendCalls: string[] = [];
  const legacyRepository = pairingRepository("legacy", backendCalls);
  const sqliteRepository = pairingRepository("sqlite", backendCalls);
  const mutableAuthority = { ...LEGACY_AUTHORITY };
  let authorityReads = 0;
  const selector = new PairingAuthoritySelector({
    authorityRepository: authorityRepository(() => {
      authorityReads += 1;
      return mutableAuthority;
    }),
    legacyRepository,
    sqliteRepository,
  });

  const selection = selector.select();

  assert.equal(authorityReads, 1);
  assert.equal(selection.target, "legacy");
  assert.equal(selection.repository, legacyRepository);
  assert.deepEqual(backendCalls, []);
  assert.equal(Object.isFrozen(selection), true);
  assert.equal(Object.isFrozen(selection.authority), true);
  assert.notEqual(selection.authority, mutableAuthority);
  mutableAuthority.revision = 9;
  assert.equal(selection.authority.revision, 0);
});

test("both SQLite authority modes select only the SQLite repository", () => {
  for (const authority of [ROLLBACK_AUTHORITY, FINAL_AUTHORITY]) {
    const backendCalls: string[] = [];
    const legacyRepository = pairingRepository("legacy", backendCalls);
    const sqliteRepository = pairingRepository("sqlite", backendCalls);
    const selector = new PairingAuthoritySelector({
      authorityRepository: authorityRepository(() => authority),
      legacyRepository,
      sqliteRepository,
    });

    const selection = selector.select();

    assert.equal(selection.target, "sqlite");
    assert.equal(selection.repository, sqliteRepository);
    assert.deepEqual(selection.authority, authority);
    assert.deepEqual(backendCalls, []);
  }
});

test("selector fails closed for forged authority snapshots before exposing a repository", () => {
  const backendCalls: string[] = [];
  const legacyRepository = pairingRepository("legacy", backendCalls);
  const sqliteRepository = pairingRepository("sqlite", backendCalls);

  for (const authority of [
    { ...LEGACY_AUTHORITY, sourceRevision: SOURCE_REVISION },
    { ...ROLLBACK_AUTHORITY, finalizedAt: ROLLBACK_EXPIRES_AT },
    { ...FINAL_AUTHORITY, finalizedAt: CUTOVER_AT },
    { ...LEGACY_AUTHORITY, revision: "0" },
    { ...LEGACY_AUTHORITY, mode: "unknown" },
  ]) {
    const selector = new PairingAuthoritySelector({
      authorityRepository: authorityRepository(
        () => authority as unknown as PairingAuthorityState,
      ),
      legacyRepository,
      sqliteRepository,
    });
    assert.throws(() => selector.select());
  }
  assert.deepEqual(backendCalls, []);
});

test("selector validates distinct complete repositories and propagates authority failure", () => {
  const backendCalls: string[] = [];
  const legacyRepository = pairingRepository("legacy", backendCalls);
  const sqliteRepository = pairingRepository("sqlite", backendCalls);

  assert.throws(
    () =>
      new PairingAuthoritySelector({
        authorityRepository: authorityRepository(() => LEGACY_AUTHORITY),
        legacyRepository,
        sqliteRepository: legacyRepository,
      }),
    /must be distinct/,
  );
  assert.throws(
    () =>
      new PairingAuthoritySelector({
        authorityRepository: authorityRepository(() => LEGACY_AUTHORITY),
        legacyRepository: {
          read() {
            return { credential: null, invitations: [] };
          },
        } as unknown as PairingStateRepository,
        sqliteRepository,
      }),
    /must implement replace/,
  );

  const selector = new PairingAuthoritySelector({
    authorityRepository: authorityRepository(() => {
      throw new Error("authority unavailable");
    }),
    legacyRepository,
    sqliteRepository,
  });
  assert.throws(() => selector.select(), /authority unavailable/);
  assert.deepEqual(backendCalls, []);
});

test("authority normalization returns a canonical immutable copy", () => {
  const normalized = normalizePairingAuthorityState({ ...FINAL_AUTHORITY });

  assert.deepEqual(normalized, FINAL_AUTHORITY);
  assert.equal(Object.isFrozen(normalized), true);
  assert.throws(
    () => normalizePairingAuthorityState({ ...ROLLBACK_AUTHORITY, rollbackExpiresAt: CUTOVER_AT }),
    /must follow cutoverAt/,
  );
});

function authorityRepository(current: () => PairingAuthorityState): PairingAuthorityRepository {
  return {
    current,
    activateSqlite() {
      throw new Error("not used by selector");
    },
    rollbackToLegacy() {
      throw new Error("not used by selector");
    },
    finalizeSqlite() {
      throw new Error("not used by selector");
    },
  };
}

function pairingRepository(name: string, calls: string[]): PairingStateRepository {
  return {
    read() {
      calls.push(`${name}.read`);
      return { credential: null, invitations: [] };
    },
    replace() {
      calls.push(`${name}.replace`);
    },
    getCredential() {
      calls.push(`${name}.getCredential`);
      return null;
    },
    getInvitation() {
      calls.push(`${name}.getInvitation`);
      return null;
    },
    findInvitationByInviteHash() {
      calls.push(`${name}.findInvitationByInviteHash`);
      return null;
    },
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
