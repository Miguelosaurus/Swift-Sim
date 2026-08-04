# ADR-0004 — Swift analyzer boundary

- Status: Accepted
- Date: 2026-08-04

## Context

The current handwritten classifier is embedded in a large live-delivery module. Replacing it before separating Xcode discovery, engine ownership, patch delivery, proof, and fallback would make routing changes difficult to reason about.

## Decision

Classification is isolated behind a versioned `SwiftEditAnalyzer` protocol. The target implementation uses SwiftSyntax/SwiftParser and emits bounded, versioned structured output. Parse failures, unsupported syntax, timeouts, malformed responses, version mismatches, and analyzer unavailability fail closed to a signed rebuild. The new analyzer may be more conservative, never silently more permissive.

## Rejected alternatives

- Improving the handwritten parser in place would preserve the wrong ownership boundary.
- A permissive fallback would turn uncertainty into unsafe live updates.
- Requiring a first-use source build would create an unacceptable normal workflow burden unless explicitly chosen and packaged.

## Consequences

The analyzer needs protocol versioning, timeout/output limits, package integrity, differential corpus evidence, and a temporary legacy diagnostic path with an objective deletion condition. Physical proof is required for any newly permissive result.

## Migration strategy

First isolate the legacy classifier unchanged, then implement the analyzer client and replacement, run differential results over the complete corpus and captured edit sets, and switch routing only after conservative acceptance and packaging proof.

## Revisit conditions

Revisit if SwiftSyntax/SwiftParser cannot be shipped and updated through the supported release path, or if physical evidence shows the chosen conservative boundary does not preserve the product's supported workflow.
