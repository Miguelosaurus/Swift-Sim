# ADR-0001 — Mixed-source TypeScript compile-to-dist

- Status: Accepted
- Date: 2026-08-04

## Context

The Mac helper is a large Node ESM codebase with JavaScript entrypoints and behavior that must remain compatible during migration. A runtime TypeScript loader would change startup, packaging, and clean-machine behavior.

## Decision

TypeScript becomes canonical through a mixed JavaScript/TypeScript transition. NodeNext compilation emits one `dist/` tree, and shipped production code executes emitted JavaScript. `allowJs` supports incremental migration. The final TypeScript configuration is expected to use strict checking, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes` unless a documented limitation prevents one option. Production will not depend on a runtime TypeScript transpiler.

## Rejected alternatives

- A flag-day rewrite would combine language migration with behavioral risk.
- A runtime loader would add startup and package compatibility risk.
- Leaving JavaScript canonical would preserve the current type-boundary debt.

## Consequences

The repository temporarily contains mixed source languages and must test both source contracts and compiled package entrypoints. Import specifiers and package contents become release concerns.

## Migration strategy

Add the compiler and compiled-tree test path first, define domain contracts and validators, then migrate cohesive modules one at a time. Remove source-only production execution after package equivalence is proven.

## Revisit conditions

Revisit if the declared Node LTS cannot execute the compiled package on a clean supported install, or if package consumers require a different immutable build boundary.
