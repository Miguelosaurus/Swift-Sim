# Main post-merge review — round 1

Base main head: `c7090b14c6f1fd12af9c311b1954b79b00c415ac`

Final code candidate before this ledger commit: `2eed0b004d8740d617314becf21f5018146fed58`

This staging branch reviews the fully synchronized merge of the previous local main work with hardening head `5afa7728bb22d3ff6e54512615d988a9c7a85240`.

## Result

| Severity | Found | Fixed | Remaining |
| --- | ---: | ---: | ---: |
| P0 | 0 | 0 | 0 |
| P1 | 12 | 12 | 0 |
| P2 | 6 | 6 | 0 |
| P3 | 0 | 0 | 0 |

## Resolved P1 findings

1. A stale live-engine PID file could authorize `SIGTERM` against an unrelated process after PID reuse. Engine ownership now persists and verifies exact process-start identity and controls the detached process group.
2. Concurrent live-engine inspection, installation, restart, and session publication could interleave across processes. A cross-process lifecycle lock now serializes the complete ownership transition.
3. Swift declaration attributes, property-wrapper arguments, availability annotations, and compiler-condition directives could be misclassified as implementation-only edits.
4. Deeply nested and multiline attribute arguments were not represented reliably in the structural surface. The classifier now uses balanced scanning while preserving original argument text.
5. Workspace live reload selected `-workspace` superficially but did not discover referenced projects, require an authoritative scheme, select signing settings for that scheme, or watch the workspace root correctly.
6. Persisted build cleanup data could direct recursive deletion outside Swift Sim's private `device-builds` root. Helper, CLI, and public-gateway paths now share a fail-closed containment boundary.
7. Pairing-origin generation trusted forwarded protocol headers from direct network peers. Forwarded origin metadata is now accepted only from the trusted loopback proxy boundary.
8. Build Current Code could target an app without exact ownership by the currently paired Mac. Mutation authority now requires the stored owner pairing ID to match.
9. Registering captured compilation commands could race a concurrent live-engine replacement and publish mappings to the wrong engine generation. Registration now holds the lifecycle lock.
10. Default production patch injection could race a concurrent engine replacement between queueing and completion polling. Production injection now holds the lifecycle lock; injected test transports retain their isolated path.
11. A contender that died after creating `reclaim.json` could permanently block all future live-engine lifecycle operations. Dead valid claims and sufficiently old malformed claims are now atomically quarantined, re-verified after rename, and removed only when they are still the exact abandoned file.
12. Multiline runtime `#available` and `#unavailable` expressions could evade the single-line structural matcher and be sent down the hot-reload lane. Runtime availability conditions now use balanced multiline scanning that preserves the original condition text and fails closed on an unterminated expression.

## Resolved P2 findings

1. Durable delivery-reference cleanup ran synchronously before the helper began listening, so a valid backlog could delay availability for minutes. Startup now listens first and drains the durable queue asynchronously.
2. Build Current Code accepted success and failure responses after the paired Mac changed. Both paths are fenced by pairing revision and exact Mac identity.
3. Simulator status and log requests could mutate shared UI state after the user opened, reopened, or closed a different session. Success and failure paths now require the exact simulator-view revision and session.
4. Concurrent pairing attempts could complete out of order and let an older request replace a newer Mac. Pairing attempts now have their own generation fence.
5. Connection diagnostics could rename or mark a replacement Mac online, or overwrite a changed Simulator view, using stale responses. Diagnostics now snapshot and validate both pairing and view revisions.
6. An ownerless stale lifecycle lock became young again when its reclaim claim updated the directory mtime. Reclamation now preserves the pre-claim stale observation and verifies the same directory by device/inode identity.

## Regression coverage

Focused coverage now includes:

- stale/reused engine PID rejection and detached process-group termination;
- cross-process lifecycle serialization and stale-owner reclamation;
- ownerless stale-lock reclamation after the claim file changes directory mtime;
- abandoned valid and malformed reclaim-claim recovery;
- nested, multiline, string-valued, and declaration-associated Swift attributes;
- compiler-condition, multiline `#available`, and multiline `#unavailable` rebuild controls;
- workspace project-reference parsing, scheme selection, Xcode container arguments, and root resolution;
- helper startup ordering and persistent cleanup containment;
- paired-Mac rebuild authority and stale response fences;
- Simulator, pairing-attempt, and connection-diagnostics revision fences;
- lifecycle locking for live compilation registration and production patch injection.

## Validation policy

Code head `2eed0b004d8740d617314becf21f5018146fed58` contains the final runtime-availability fix and focused regressions. This connector-authored ledger commit is the exact-head validation and review trigger. Merge readiness requires the resulting head to pass GitHub Verify in full:

- JavaScript syntax, documentation, and complete Node/release test suite;
- workflow YAML and release-shell syntax;
- iOS companion tests.

The remaining multiline-runtime-availability Codex thread must be answered and resolved, followed by one final clean exact-head Codex review.

## Remaining external release gates

These require real installed/runtime environments and are not represented as code residuals:

1. Real Homebrew install and upgrade smoke test.
2. Physical-device signed build and install.
3. Real private publication / install-link flow.
4. Real multi-project `.xcworkspace` live-start using an explicitly selected shared scheme and signing identity.

PR #21 must remain draft and unmerged until those release decisions are made.
