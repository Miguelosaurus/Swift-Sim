# Architecture Consolidation — Checkpoint 1

- Date: 2026-08-05
- Checkpoint type: Architecture and infrastructure boundary
- Program phase: End of Phase 2
- Stack tip PR: #33
- Code implementation head: `d44179868fee4b62af5376b3344a40aca0b917d2`
- Hosted validation: Verify run `30993626853` (run 553), successful
- Checkpoint status: Hosted-green; persistent-local and physical-device evidence deferred
- Recommendation: Proceed provisionally to Phase 3 under the batched-execution amendment, while retaining the residuals and external-validation requirements below

## Executive summary

Phase 2 established one explicit, typed infrastructure boundary without decomposing the helper, removing compatibility preloads, changing public HTTP behavior, or replacing persisted record formats.

The stack now defines the ten planned ports:

1. `CommandRunner`
2. `ProcessSupervisor`
3. `AtomicFileStore`
4. `LockManager`
5. `RuntimeJournalStore`
6. `ArtifactStore`
7. `RequestOriginPolicy`
8. `Clock`
9. `IdGenerator`
10. `Logger`

Concrete Node adapters exist for every port. The existing request-origin preload delegates to the shared origin policy, and the live-engine lifecycle compatibility module delegates to the shared lock manager. Other application call sites intentionally remain on their legacy paths until later migration phases.

No P0 or P1 findings remain in the bounded checkpoint review. Two P2 residuals remain explicit:

- manager/gateway/tunnel delivery identities still use the existing start-time plus command-fragment identity and therefore retain exact-PID authority only;
- `CommandRunner` and `ProcessSupervisor` are implemented and directly validated but are not yet the production owners of the legacy command/process call sites.

## Phase 2 stack inventory

| Unit | Pull request | Exact head | Scope | Hosted state |
| --- | ---: | --- | --- | --- |
| Phase 2A | #26 | `b50ca78d82f2a034111333df28ee36f9820250f5` | Port contracts and compile-time role constraints | Green |
| Phase 2B | #27 | `bc5a137fe09a15e24c52d9bad28833f2b0c16746` | Clock, IDs, origin policy, and container foundations | Green |
| Phase 2C | #28 | `110b2422129e9b8109ef9ef42c2461d0fd37168c` | Request-origin preload delegation | Green |
| Phase 2D | #29 | `4b175a472ca009498e27e43950dfb09bd26c9408` | Atomic file and runtime-journal adapters | Green |
| Phase 2E | #30 | `092ec816b8684f36e3900ed6826eead8d12b29a3` | Lock manager and lifecycle compatibility delegation | Green |
| Phase 2F | #31 | `ecb2e7f926787e24bb73e432c436c6b4b11c4574` | Contained artifact store and structured logger | Green |
| Phase 2G | #32 | `4260dbf58cb04a97b991bdd17ae7152f76dcd442` | Bounded command runner | Green |
| Phase 2H | #33 | `d44179868fee4b62af5376b3344a40aca0b917d2` | Identity-authorized process supervisor | Green |

Every PR remains open, draft, unmerged, and stacked on the immediately preceding exact head.

## Contract and schema inventory

### Preserved external contracts

- Public helper HTTP paths, response shapes, request-origin behavior, and proxy trust semantics are unchanged.
- npm and Homebrew launchers still resolve the compiled package and integrations through the Phase 1 package-root correction.
- Session, build, pairing, pairing-invite, delivery, runtime-journal, worker, live-engine, and delivery-process persisted record shapes remain compatible with the current implementation.
- No database or durable-state migration was introduced.
- No runtime transpiler was introduced; compiled Node ESM remains canonical.

### New typed boundaries

- Process spawn contracts are role-specific:
  - worker and live-engine roles require a new process group and strong identity records;
  - manager, gateway, and tunnel roles retain the existing weak delivery identity and exact-PID authority only.
- Group termination is statically and dynamically restricted to strong worker/live-engine records.
- Command execution requires an explicit environment policy, deadline, output limit, process-group policy, and accepted exit codes.
- Artifact paths must be approved through the root-containment boundary and remain bound to the root device/inode.
- Origin decisions accept raw request-boundary data and derive proxy trust from socket identity.

## Compatibility and preload inventory

Phase 2 deliberately does not remove preloads.

- Preload/runtime-patch modules: 30 at baseline, 30 at Checkpoint 1.
- Existing source-text implementation tests: 28 at baseline, 28 at Checkpoint 1.
- Existing child-process importers: 28 at baseline, 28 at Checkpoint 1.
- Existing legacy destructive-filesystem importers: 26 at baseline, 25 at Checkpoint 1.
- Dedicated destructive-filesystem infrastructure owners: 0 at baseline, 3 at Checkpoint 1 (`NodeAtomicFileStore`, `NodeLockManager`, `NodeArtifactStore`).

Delegating compatibility surfaces:

- `helperHttpBoundaryPreload.js` delegates request-origin decisions to `RequestOriginPolicy`.
- `liveEngineLifecycleLock.js` delegates the hardened lock algorithm to `NodeLockManager`.

Still legacy-owned:

- `deviceBuilderCore.runBuffered` and other command/process call sites;
- live-engine ownership and worker identity compatibility preloads;
- artifact cleanup and most direct filesystem call sites;
- helper/CLI composition and service decomposition.

## Metric snapshot

| Metric | Phase 0 baseline | Checkpoint 1 | Interpretation |
| --- | ---: | ---: | --- |
| Production source files | 74 | 92 | New contracts/adapters were added without helper decomposition |
| Production TypeScript files | 0 | 9 | Typed contracts and port definitions now exist |
| Named infrastructure ports | 0 | 10 | Planned Phase 2 boundary is complete |
| Preload/runtime-patch modules | 30 | 30 | No premature preload removal |
| Child-process importers | 28 | 28 | New process adapters use explicit runtime injection rather than expanding imports |
| Source-text implementation tests | 28 | 28 | New tests validate runtime behavior instead of adding source-text coupling |
| Legacy destructive-filesystem importers | 26 | 25 | One legacy owner transferred behind a shared port |
| Dedicated filesystem infrastructure owners | 0 | 3 | Atomic files, locks, and artifacts now have explicit owners |

No performance improvement is claimed at this checkpoint. The phase establishes ownership and safety boundaries; later phases must demonstrate simplification and latency/build effects.

## Reliability and security findings

### Improvements established

- Atomic publication uses exclusive temporary files, file fsync, explicit replace/no-replace behavior, cleanup, owner-only modes, and best-effort directory fsync.
- Runtime journals share the atomic file implementation.
- Lock acquisition retains PID/start-token/nonce ownership, stale-owner quarantine, claim fencing, and replacement-lock protection.
- Artifact operations reject traversal, unapproved paths, root replacement, and existing symlink components.
- Structured logging redacts sensitive field names recursively, bounds values, omits error messages, and cannot change application outcomes if construction or the sink fails.
- Command execution explicitly limits inherited environment, output, duration, and process-group behavior; cancellation and accepted-parent descendant cleanup are directly tested.
- Process supervision atomically journals exact existing identities, rolls back unpublished processes, distinguishes strong group authority from weak exact-PID authority, and revalidates identity before force-kill escalation.
- Post-kill transient identity loss is treated as a bounded wait condition rather than immediate authorization or a false successful state.

### Residual risk register

#### P2 — Weak delivery-process identity remains bounded but not strong

Manager, gateway, and tunnel identities continue to use the existing `startedAt` plus `commandFragments` record. They may authorize only exact-PID termination and never group termination. This preserves compatibility but does not provide the kernel start-token and nonce assurance of worker/live-engine records.

Required follow-up: migrate eligible delivery roles to strong records when their production call sites move behind `ProcessSupervisor`, or retain the exact-PID restriction with a documented justification.

#### P2 — New command/process adapters are not production owners yet

The adapters are real and directly exercised, but legacy command/process paths remain authoritative. This is intentional Phase 2 scope control, not completion of the later migration.

Required follow-up: Phase 3 and subsequent service extraction must move representative helper call sites behind the ports without duplicating lifecycle policy.

#### P3 — Compatibility preload count is unchanged

The preload count remains at the Phase 0 cap. That is expected until the bounded preload-removal phase; it must not be interpreted as architectural simplification already achieved.

## Hosted validation evidence

Verify run `30993626853` passed at implementation head `d44179868fee4b62af5376b3344a40aca0b917d2` on macOS 26 ARM64 with Node 24.

Passed gates:

- clean checkout and `npm ci`;
- Node 24 enforcement;
- syntax, architecture policy, and documentation checks;
- TypeScript, formatting, and lint;
- all 457 source tests;
- compiled contract and Phase 2 adapter suites, including real command/process-group tests;
- hermetic compiled-tree execution;
- clean npm archive/package validation;
- isolated clean Homebrew installation, launcher, setup/doctor, and helper-service restart gate;
- workflow YAML and release-shell validation;
- iOS companion tests.

## External validation status

The batched-execution amendment permits persistent-local and physical-device evidence to be gathered at checkpoints rather than after every subphase. Those checks cannot be executed through the GitHub connector and are not claimed here.

| Validation | Status | Required evidence before final merge |
| --- | --- | --- |
| Persistent local npm CLI | Not executed in this environment | Run installed `swift-sim version`, `setup`, and `doctor --json` from a clean local install |
| Persistent local helper lifecycle | Not executed in this environment | Start, health-check, restart, stop, and confirm no orphaned owned groups/journals |
| Persistent local Homebrew upgrade/install | Hosted isolated gate passed; persistent machine not executed | Install/upgrade local formula, verify Node 24 launcher paths, setup/doctor, and service restart |
| Physical iPhone install/renew workflow | Not executed in this environment | Run when an enrolled iPhone is available; record build/install/renew result and any limitation |
| Linux/non-mac behavior | No local claim | Keep platform-independent checks in GitHub Actions; macOS-specific process semantics remain macOS validated |

These are validation requirements, not hidden completed work. Luna owns the final persistent-local/device execution under the user-approved handoff.

## Bounded checkpoint review

Severity result:

- P0: 0
- P1: 0
- P2: 2
- P3: 1

Emergency-stop conditions:

- Public behavior regression: none found.
- Compatibility/schema break: none found.
- Architecture policy bypass: none present.
- New preload/child-process cap expansion: none present.
- Runtime transpiler or committed `dist`: none present.
- Unbounded process or filesystem authority: none found in the new ports.

## Recommendation and next phase constraints

Proceed provisionally to Phase 3 under the batched-execution amendment because the hosted checkpoint is green and no P0/P1 or emergency-stop condition remains.

Phase 3 must:

- decompose the helper by explicit application/service boundaries rather than adding another preload layer;
- inject the Phase 2 ports from a composition root;
- migrate bounded representative call sites with characterization tests before semantic changes;
- preserve public routes, persisted records, package layouts, helper restart behavior, and process ownership guarantees;
- keep weak delivery identity and unmigrated command/process ownership visible in the risk register;
- avoid preload removal, SQLite migration, or unrelated iOS redesign unless the master plan assigns them to Phase 3.

Final merge remains blocked on the persistent-local/device validation evidence above and the later mandatory program checkpoints.
