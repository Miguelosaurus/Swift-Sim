# Main post-merge review — round 1

Base main head: `c7090b14c6f1fd12af9c311b1954b79b00c415ac`

Final code candidate before this ledger commit: `36f43b532bccd3c178f4424e4b20df63ec79f249`

## Result

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 26 | 26 | 0 |
| P2 | 14 | 14 | 0 |
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
23. Shared helper/build-state lock reclamation rejects parseable malformed owner records and revalidates the exact reclaim claim before atomic removal, preventing permanent wedges and stale-claim deletion after ownership changes.
24. Generic lock owner publication is bound to the exact directory device/inode and intended owner record after the write, so a suspended writer cannot resume into a quarantined directory and execute without mutual exclusion or erase a replacement owner.
25. Device-build live eligibility uses the selected scheme's authoritative host application, and managed implicit-dynamic/interposable flags cannot leak into the ordinary fallback archive.
26. A verified detached live engine can be identity-checked and terminated before PID publication, closing the pre-publication abandonment window.

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
13. Companion Mac synchronization removes only history explicitly owned by that same Mac; ownerless link history and another Mac's history survive unrelated syncs.
14. Optional live-target inspection is gated to Debug project builds, so ordinary Release archives do not run an unnecessary Debug build-settings query or trigger live-package resolution side effects.

## Regression coverage

Coverage includes kernel process-start tokens, executable and instance-nonce mismatch rejection, identity-failure no-signal behavior, pre-publication/PID/session publication rollback, stale/reused PIDs, detached process groups, lifecycle-owner token collisions, lock ownership and reclamation, exact generic reclaim claims, displaced-writer rejection, parseable malformed owner/reclaim records, abandoned claims, replacement-lock preservation, nested and multiline Swift attributes, exact attribute string literals, runtime availability conditions, nested block comments, project/workspace schemes, selected-target package association, stale PBX-comment rejection, active engine-scheme identity, host-application signing sections, failed build-settings queries, Debug-only optional live inspection, fallback-archive flag isolation, cleanup containment, complete live build/routing leases, startup cleanup, and companion ownership/revision fences.

## Validation policy

The self-cleaning transformations that produced code head `36f43b532bccd3c178f4424e4b20df63ec79f249` passed focused project/workspace scheme-authority, package-association, fallback-archive isolation, Debug-only live-inspection, engine-publication, generic lock-reclamation, displaced-writer, companion ownership, and post-merge regressions before publishing. JavaScript syntax and documentation validation also passed before each production publication. All temporary transformers, triggers, and workflows were removed from the code candidate.

This connector-authored ledger commit intentionally triggers the normal exact-head macOS Verify workflow. Merge readiness requires that workflow to pass in full. No external automated reviewer is required or requested.

## Remaining external release gates

1. Real Homebrew install and upgrade smoke test.
2. Physical-device signed build and install.
3. Real private publication and install-link flow.
4. Real multi-project `.xcworkspace` and multi-target `.xcodeproj` live-start with an explicitly selected shared scheme and signing identity.

PR #21 remains draft and unmerged.
