# Main post-merge review — round 1

Base main head: `c7090b14c6f1fd12af9c311b1954b79b00c415ac`

Final code candidate before this ledger commit: `f60c8e237ed21a22cedd2a6a13e2b3b9412d4cd7`

## Result

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 22 | 22 | 0 |
| P2 | 12 | 12 | 0 |
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
16. Nested Swift block comments are masked to their true closing delimiter.
17. Attribute and wrapper surfaces preserve exact string-literal whitespace.
18. Live-engine termination requires a microsecond-resolution kernel start token, the current kernel-reported executable path and process group, and a per-spawn random instance nonce.
19. Failure to establish engine ownership never authorizes an unverified PID or process-group signal; identity tooling is prepared before spawn and cleanup fails closed.
20. Parseable but incomplete owner and reclaim records are treated as malformed state and become safely reclaimable instead of permanently wedging every lifecycle operation.
21. Live readiness and routing are bound to the persisted engine session's exact project root, selected scheme, and engine version, preventing cross-scheme compilation-map injection within a shared workspace.
22. Detached live-engine startup is transactional: PID-record publication failure terminates the exact verified process group, and session-publication failure rolls back through the durable identity-checked PID record.

## P2 fixes

1. Durable delivery cleanup no longer blocks helper startup.
2. Rebuild responses are fenced against paired-Mac changes.
3. Simulator status and logs are fenced by exact view revision and session.
4. Concurrent pairing attempts use an attempt generation.
5. Connection diagnostics are fenced by pairing and Simulator revisions.
6. Ownerless stale-lock reclamation preserves its pre-claim identity observation.
7. Live start, device compilation, registration, and packaging use one lifecycle lease.
8. Workspace signing settings are selected from the scored host-application target section rather than the first signed dependency.
9. Lifecycle-lock owners and reclaim claimants use the same collision-resistant kernel process-start token as engine ownership; second-resolution legacy owner records are never treated as live.
10. Live signing fails closed when `xcodebuild -showBuildSettings` fails, times out, lacks a host-application section, or omits the selected target's Development Team; unrelated Apple Development identities are no longer fallback candidates.
11. Workspace package readiness is derived from the explicitly selected scheme's host application target and cannot be inherited from an unrelated project or target in the workspace.
12. `.xcodeproj` projects now use the same explicit scheme authority, selected-host-target package validation, and target-scoped linker settings as workspaces; stale PBX comments cannot impersonate a package dependency.

## Regression coverage

Coverage includes kernel process-start tokens, executable and instance-nonce mismatch rejection, identity-failure no-signal behavior, PID/session publication rollback, stale/reused PIDs, detached process groups, lifecycle-owner token collisions, lock ownership and reclamation, parseable malformed owner/reclaim records, abandoned claims, replacement-lock preservation, nested and multiline Swift attributes, exact attribute string literals, runtime availability conditions, nested block comments, project/workspace schemes, selected-target package association, stale PBX-comment rejection, active engine-scheme identity, host-application signing sections, failed build-settings queries, cleanup containment, complete live build/routing leases, startup cleanup, and companion ownership/revision fences.

## Validation policy

The self-cleaning transformation that produced code head `f60c8e237ed21a22cedd2a6a13e2b3b9412d4cd7` passed the focused post-merge and workspace-package regressions, the complete Node/release suite through `npm run check`, workflow YAML validation, and release-shell syntax before publishing. The temporary transformer and workflow were removed in that same commit.

This connector-authored ledger commit is the final exact-head validation and review trigger. Merge readiness requires the resulting head to pass the normal Verify workflow in full, all remaining Codex threads to be resolved, and one clean exact-head Codex review.

## Remaining external release gates

1. Real Homebrew install and upgrade smoke test.
2. Physical-device signed build and install.
3. Real private publication and install-link flow.
4. Real multi-project `.xcworkspace` live-start with an explicitly selected shared scheme and signing identity.

PR #21 remains draft and unmerged.
