# Main post-merge review — round 1

Base main head: `c7090b14c6f1fd12af9c311b1954b79b00c415ac`

Final code candidate before this ledger commit: `445c0e7cd5da3d1256220a0dff0f15936f943836`

## Result

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 17 | 17 | 0 |
| P2 | 8 | 8 | 0 |
| P3 | 0 | 0 | 0 |

## P1 fixes

1. Exact process identity and detached process-group ownership for the live engine.
2. Cross-process serialization of engine ownership transitions.
3. Declaration attributes and wrapper arguments participate in rebuild classification.
4. Balanced handling of deeply nested and multiline attributes.
5. Workspace project discovery, scheme authority, signing selection, and watcher-root resolution.
6. Recursive artifact cleanup is contained to Swift Sim's private build root.
7. Forwarded origin metadata is trusted only from the loopback proxy boundary.
8. Build Current Code requires exact paired-Mac ownership.
9. Compilation registration cannot cross an engine replacement generation.
10. Production patch injection cannot cross an engine replacement generation.
11. Abandoned valid or malformed reclaim claims are safely recoverable.
12. Multiline runtime `#available` and `#unavailable` conditions require rebuilds.
13. Failed lock-creator cleanup is bound to the exact observed directory identity.
14. Expanded signing identities remain one-element candidate arrays.
15. Production inspect, compile, inject, acknowledgement, and recovery use one lifecycle lease.
16. Nested Swift block comments are masked to their true closing delimiter, so commented structural text cannot affect classification.
17. Attribute and wrapper surfaces preserve exact string-literal whitespace, so initializer metadata changes cannot be collapsed into an implementation-only edit.

## P2 fixes

1. Durable delivery cleanup no longer blocks helper startup.
2. Rebuild responses are fenced against paired-Mac changes.
3. Simulator status and logs are fenced by exact view revision and session.
4. Concurrent pairing attempts use an attempt generation.
5. Connection diagnostics are fenced by pairing and Simulator revisions.
6. Ownerless stale-lock reclamation preserves its pre-claim identity observation.
7. Live start, device compilation, registration, and packaging use one lifecycle lease.
8. Workspace signing settings are selected from the scored host-application target section rather than the first signed dependency; ambiguous host-app selection fails closed.

## Regression coverage

Coverage includes stale/reused PIDs, process groups, lock ownership and reclamation, abandoned claims, replacement-lock preservation, nested and multiline Swift attributes, exact attribute string literals, runtime availability conditions, nested block comments, workspace schemes and host-application signing sections, cleanup containment, complete live build/routing leases, startup cleanup, and companion ownership/revision fences.

## Validation policy

The transformation run for code head `445c0e7cd5da3d1256220a0dff0f15936f943836` passed JavaScript syntax, documentation, the complete Node/release suite, workflow YAML, release-shell syntax, and iOS companion tests in GitHub Verify run `30724844954`.

This connector-authored ledger commit is the final exact-head validation and review trigger. Merge readiness requires the resulting head to pass the normal Verify workflow in full, with both remaining Codex threads resolved and one clean exact-head Codex review.

## Remaining external release gates

1. Real Homebrew install and upgrade smoke test.
2. Physical-device signed build and install.
3. Real private publication and install-link flow.
4. Real multi-project `.xcworkspace` live-start with an explicitly selected shared scheme and signing identity.

PR #21 remains draft and unmerged.
