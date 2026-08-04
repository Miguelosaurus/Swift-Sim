# ADR-0002 — Explicit infrastructure ports

- Status: Accepted
- Date: 2026-08-04

## Context

Safety behavior is currently distributed across preloads and runtime patches around child processes, filesystem publication, locks, artifacts, HTTP origin handling, and logging. Import order can therefore affect which guarantees a call site receives.

## Decision

Application code will receive explicit infrastructure ports: `CommandRunner`, `ProcessSupervisor`, `AtomicFileStore`, `LockManager`, `RuntimeJournalStore`, `ArtifactStore`, `RequestOriginPolicy`, `Clock`, `IdGenerator`, and `Logger`. A small composition root wires concrete implementations. Compatibility preloads may delegate temporarily, but the allowed preload surface can only decrease.

## Rejected alternatives

- More global monkey patches would increase hidden coupling.
- A large dependency-injection framework would add ceremony without clarifying ownership.
- Moving all behavior into one runtime object would create a service locator.

## Consequences

Process deadlines, ownership verification, containment, redaction, and origin policy become visible and directly testable. Call sites must declare the capabilities they use, and migration needs characterization tests for existing guarantees.

## Migration strategy

Define ports and fakes, move implementations behind them, then migrate call sites by responsibility. Keep preloads as thin adapters until packaged/raw equivalence and regression tests prove deletion conditions.

## Revisit conditions

Revisit if a port cannot preserve an existing safety invariant without hidden process-wide interception, or if a concrete boundary consistently requires unrelated capabilities and should be split.
