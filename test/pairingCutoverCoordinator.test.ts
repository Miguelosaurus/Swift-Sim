import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type {
  PairingAuthorityRepository,
  PairingAuthorityState,
} from "../mac-helper/src/contracts/repository.js";
import { PairingCutoverCoordinator } from "../mac-helper/src/persistence/pairingCutoverCoordinator.js";
import { pairingProjectionHash } from "../mac-helper/src/persistence/pairingLockedLegacySnapshot.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const PREPARATION_ID = digest("pairing-cutover-preparation");
const SOURCE_REVISION = digest("legacy-source");
const SNAPSHOT = Object.freeze({
  credential: Object.freeze({
    token: "pairing-token",
    installationID: "installation-1",
    macName: "Miguel Mac",
    createdAt: "2026-08-05T17:00:00.000Z",
    updatedAt: "2026-08-05T17:30:00.000Z",
  }),
  invitations: Object.freeze([]),
});
const PROJECTION_HASH = pairingProjectionHash(SNAPSHOT);
const LOCKED_SNAPSHOT = Object.freeze({
  snapshot: SNAPSHOT,
  sourceRevision: SOURCE_REVISION,
  projectionHash: PROJECTION_HASH,
  recordCount: 1,
  backups: Object.freeze(["/backups/credential.bak"]),
});
const REQUEST = Object.freeze({
  expectedRevision: 0,
  preparationID: PREPARATION_ID,
  rollbackWindowMs: 7 * DAY_MS,
});
const CUTOVER_AT = "2026-08-05T18:00:00.000Z";
const ROLLBACK_EXPIRES_AT = "2026-08-12T18:00:00.000Z";

test("fresh cutover imports and activates before releasing the legacy locks", () => {
  const events: string[] = [];
  let lockHeld = false;
  const authority = authorityHarness(legacyState(0), events, () => lockHeld);
  const coordinator = new PairingCutoverCoordinator({
    authorityRepository: authority.repository,
    snapshotReader: lockedSnapshotReader(events, () => lockHeld, (value) => {
      lockHeld = value;
    }),
    importApplier: {
      apply(snapshot) {
        assert.equal(lockHeld, true);
        assert.equal(snapshot, LOCKED_SNAPSHOT);
        events.push("import");
        return importResult("applied");
      },
    },
    now: () => {
      assert.equal(lockHeld, true);
      events.push("clock");
      return CUTOVER_AT;
    },
  });

  const result = coordinator.run(REQUEST);

  assert.deepEqual(result, {
    status: "activated",
    importStatus: "applied",
    sourceRevision: SOURCE_REVISION,
    projectionHash: PROJECTION_HASH,
    authority: activeState(2),
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(lockHeld, false);
  assert.deepEqual(events, [
    "authority.current:legacy:0",
    "authority.prepare:0",
    "lock.enter",
    "authority.current:legacy-preparing:1",
    "import",
    "clock",
    "authority.activate:1",
    "lock.exit",
  ]);
});

test("a durable preparation resumes without preparing a second epoch", () => {
  const events: string[] = [];
  let lockHeld = false;
  const authority = authorityHarness(preparingState(1), events, () => lockHeld);
  const coordinator = new PairingCutoverCoordinator({
    authorityRepository: authority.repository,
    snapshotReader: lockedSnapshotReader(events, () => lockHeld, (value) => {
      lockHeld = value;
    }),
    importApplier: {
      apply() {
        events.push("import");
        return importResult("already-current");
      },
    },
    now: () => CUTOVER_AT,
  });

  const result = coordinator.run(REQUEST);

  assert.equal(result.status, "activated");
  assert.equal(result.importStatus, "already-current");
  assert.equal(events.includes("authority.prepare:0"), false);
  assert.equal(authority.state().mode, "sqlite-rollback");
});

test("retry after activation verifies the locked source without reimporting or resetting time", () => {
  const events: string[] = [];
  let lockHeld = false;
  const authority = authorityHarness(activeState(2), events, () => lockHeld);
  const coordinator = new PairingCutoverCoordinator({
    authorityRepository: authority.repository,
    snapshotReader: lockedSnapshotReader(events, () => lockHeld, (value) => {
      lockHeld = value;
    }),
    importApplier: {
      apply() {
        throw new Error("retry must not reapply the snapshot");
      },
    },
    now: () => {
      throw new Error("retry must not reset the cutover clock");
    },
  });

  const result = coordinator.run(REQUEST);

  assert.deepEqual(result, {
    status: "already-active",
    importStatus: null,
    sourceRevision: SOURCE_REVISION,
    projectionHash: PROJECTION_HASH,
    authority: activeState(2),
  });
  assert.equal(events.includes("authority.prepare:0"), false);
  assert.equal(events.includes("authority.activate:1"), false);
});

test("active retry rejects changed legacy bytes instead of treating them as the activated source", () => {
  const events: string[] = [];
  let lockHeld = false;
  const authority = authorityHarness(activeState(2), events, () => lockHeld);
  const changedSnapshot = {
    ...LOCKED_SNAPSHOT,
    sourceRevision: digest("changed-legacy-source"),
  };
  const coordinator = new PairingCutoverCoordinator({
    authorityRepository: authority.repository,
    snapshotReader: {
      withLockedSnapshot<T>(operation: (snapshot: typeof LOCKED_SNAPSHOT) => T): T {
        lockHeld = true;
        try {
          return operation(changedSnapshot as typeof LOCKED_SNAPSHOT);
        } finally {
          lockHeld = false;
        }
      },
    },
    importApplier: {
      apply() {
        throw new Error("changed active source must not be imported");
      },
    },
  });

  assert.throws(() => coordinator.run(REQUEST), /does not match the locked legacy snapshot/);
  assert.equal(authority.state().mode, "sqlite-rollback");
});

test("import evidence mismatch fails before the clock or authority activation", () => {
  const events: string[] = [];
  let lockHeld = false;
  const authority = authorityHarness(preparingState(1), events, () => lockHeld);
  const coordinator = new PairingCutoverCoordinator({
    authorityRepository: authority.repository,
    snapshotReader: lockedSnapshotReader(events, () => lockHeld, (value) => {
      lockHeld = value;
    }),
    importApplier: {
      apply() {
        events.push("import");
        return {
          ...importResult("applied"),
          projectionHash: digest("wrong-projection"),
        };
      },
    },
    now: () => {
      events.push("clock");
      return CUTOVER_AT;
    },
  });

  assert.throws(() => coordinator.run(REQUEST), /does not match the locked legacy snapshot/);
  assert.equal(events.includes("clock"), false);
  assert.equal(events.includes("authority.activate:1"), false);
  assert.deepEqual(authority.state(), preparingState(1));
});

test("stale and finalized authority epochs fail before acquiring legacy locks", () => {
  for (const state of [
    legacyState(4),
    { ...preparingState(1), preparationID: digest("other-preparation") },
    finalState(3),
  ]) {
    let lockCalls = 0;
    const coordinator = new PairingCutoverCoordinator({
      authorityRepository: authorityHarness(state, [], () => false).repository,
      snapshotReader: {
        withLockedSnapshot<T>(_operation: (snapshot: typeof LOCKED_SNAPSHOT) => T): T {
          lockCalls += 1;
          throw new Error("legacy locks must not be acquired");
        },
      },
      importApplier: { apply: () => importResult("applied") },
    });

    assert.throws(() => coordinator.run(REQUEST));
    assert.equal(lockCalls, 0);
  }
});

test("request, clock, import, activation, and synchronous-boundary failures stay fail-closed", () => {
  let authorityReads = 0;
  const untouchedAuthority = authorityHarness(legacyState(0), [], () => false);
  const countingAuthority: PairingAuthorityRepository = {
    ...untouchedAuthority.repository,
    current() {
      authorityReads += 1;
      return untouchedAuthority.repository.current();
    },
  };
  const baseOptions = {
    authorityRepository: countingAuthority,
    snapshotReader: lockedSnapshotReader([], () => false, () => undefined),
    importApplier: { apply: () => importResult("applied") },
  };

  assert.throws(
    () => new PairingCutoverCoordinator(baseOptions).run({ ...REQUEST, rollbackWindowMs: 0 }),
    /greater than zero/,
  );
  assert.equal(authorityReads, 0);

  const invalidClockAuthority = authorityHarness(preparingState(1), [], () => true);
  const invalidClock = new PairingCutoverCoordinator({
    authorityRepository: invalidClockAuthority.repository,
    snapshotReader: immediateSnapshotReader(),
    importApplier: { apply: () => importResult("checkpointed") },
    now: () => "2026-08-05T18:00:00Z",
  });
  assert.throws(() => invalidClock.run(REQUEST), /canonical UTC timestamp/);
  assert.deepEqual(invalidClockAuthority.state(), preparingState(1));

  const asyncBoundary = new PairingCutoverCoordinator({
    authorityRepository: authorityHarness(preparingState(1), [], () => false).repository,
    snapshotReader: {
      withLockedSnapshot() {
        return Promise.resolve("escaped");
      },
    },
    importApplier: { apply: () => importResult("applied") },
  });
  assert.throws(() => asyncBoundary.run(REQUEST), /must complete synchronously/);
});

test("constructor rejects missing structural dependencies", () => {
  const authority = authorityHarness(legacyState(0), [], () => false).repository;
  assert.throws(
    () =>
      new PairingCutoverCoordinator({
        authorityRepository: {} as PairingAuthorityRepository,
        snapshotReader: immediateSnapshotReader(),
        importApplier: { apply: () => importResult("applied") },
      }),
    /must implement current/,
  );
  assert.throws(
    () =>
      new PairingCutoverCoordinator({
        authorityRepository: authority,
        snapshotReader: {} as ReturnType<typeof immediateSnapshotReader>,
        importApplier: { apply: () => importResult("applied") },
      }),
    /withLockedSnapshot/,
  );
  assert.throws(
    () =>
      new PairingCutoverCoordinator({
        authorityRepository: authority,
        snapshotReader: immediateSnapshotReader(),
        importApplier: {} as { apply: () => ReturnType<typeof importResult> },
      }),
    /must implement apply/,
  );
});

function authorityHarness(
  initial: PairingAuthorityState,
  events: string[],
  lockHeld: () => boolean,
) {
  let state = initial;
  const repository: PairingAuthorityRepository = {
    current() {
      events.push(`authority.current:${state.mode}:${state.revision}`);
      return state;
    },
    prepareSqlite(input) {
      events.push(`authority.prepare:${input.expectedRevision}`);
      assert.equal(state.mode, "legacy");
      assert.equal(state.revision, input.expectedRevision);
      state = preparingState(input.expectedRevision + 1, input.preparationID);
      return state;
    },
    cancelPreparation() {
      throw new Error("not used by cutover coordinator");
    },
    activateSqlite(input) {
      assert.equal(lockHeld(), true);
      events.push(`authority.activate:${input.expectedRevision}`);
      assert.equal(state.mode, "legacy-preparing");
      assert.equal(state.revision, input.expectedRevision);
      state = {
        mode: "sqlite-rollback",
        preparationID: input.preparationID,
        sourceRevision: input.sourceRevision,
        projectionHash: input.projectionHash,
        cutoverAt: input.cutoverAt,
        rollbackExpiresAt: input.rollbackExpiresAt,
        finalizedAt: null,
        revision: input.expectedRevision + 1,
      };
      return state;
    },
    rollbackToLegacy() {
      throw new Error("not used by cutover coordinator");
    },
    finalizeSqlite() {
      throw new Error("not used by cutover coordinator");
    },
  };
  return { repository, state: () => state };
}

function lockedSnapshotReader(
  events: string[],
  lockHeld: () => boolean,
  setLockHeld: (value: boolean) => void,
) {
  return {
    withLockedSnapshot<T>(operation: (snapshot: typeof LOCKED_SNAPSHOT) => T): T {
      assert.equal(lockHeld(), false);
      setLockHeld(true);
      events.push("lock.enter");
      try {
        return operation(LOCKED_SNAPSHOT);
      } finally {
        events.push("lock.exit");
        setLockHeld(false);
      }
    },
  };
}

function immediateSnapshotReader() {
  return {
    withLockedSnapshot<T>(operation: (snapshot: typeof LOCKED_SNAPSHOT) => T): T {
      return operation(LOCKED_SNAPSHOT);
    },
  };
}

function importResult(status: "applied" | "checkpointed" | "already-current") {
  return {
    status,
    sourceRevision: SOURCE_REVISION,
    projectionHash: PROJECTION_HASH,
    recordCount: 1,
    backups: ["/backups/credential.bak"],
  };
}

function legacyState(revision: number): PairingAuthorityState {
  return {
    mode: "legacy",
    preparationID: null,
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision,
  };
}

function preparingState(
  revision: number,
  preparationID = PREPARATION_ID,
): PairingAuthorityState {
  return {
    mode: "legacy-preparing",
    preparationID,
    sourceRevision: null,
    projectionHash: null,
    cutoverAt: null,
    rollbackExpiresAt: null,
    finalizedAt: null,
    revision,
  };
}

function activeState(revision: number): PairingAuthorityState {
  return {
    mode: "sqlite-rollback",
    preparationID: PREPARATION_ID,
    sourceRevision: SOURCE_REVISION,
    projectionHash: PROJECTION_HASH,
    cutoverAt: CUTOVER_AT,
    rollbackExpiresAt: ROLLBACK_EXPIRES_AT,
    finalizedAt: null,
    revision,
  };
}

function finalState(revision: number): PairingAuthorityState {
  return {
    ...activeState(revision),
    mode: "sqlite-final",
    finalizedAt: ROLLBACK_EXPIRES_AT,
  };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
