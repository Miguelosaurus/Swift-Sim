# ADR-0005 — Feature-scoped iOS companion architecture

- Status: Accepted
- Date: 2026-08-04

## Context

The companion's UI, networking, persistence, navigation, and response-fencing responsibilities are concentrated in large files. The product flow and accessibility behavior must remain stable during structural refactoring.

## Decision

The companion will use feature-scoped models for Home, Pairing, Simulator, Device Build, and App Library, with a typed helper API client, local repositories, and an app coordinator. UI-facing state remains main-actor-safe; network and persistence work is injectable and cancellable. `SessionStore` becomes a small compatibility coordinator and is eventually removed or renamed.

## Rejected alternatives

- A visual redesign would add product risk unrelated to maintainability.
- Splitting files only by line count would redistribute coupling without creating ownership.
- Global networking and persistence services would preserve stale-response and test-isolation problems.

## Consequences

Feature boundaries, contract versions, actor isolation, cancellation, revision fencing, and accessibility behavior require focused tests. Existing flows remain the compatibility contract.

## Migration strategy

Extract the typed client first, then migrate one feature and repository at a time, add deterministic stale-response and ownership tests, introduce coordinator/navigation ownership, and remove the compatibility store only after all call sites have moved.

## Revisit conditions

Revisit if a feature boundary requires a user-visible redesign to remain maintainable, or if actor and cancellation constraints reveal a different stable ownership boundary without changing the current product flow.
