Continue the Swift-Sim architecture consolidation from the current repository state.

Before changing anything, read:

`docs/internal/plans/NEXT_AGENT_HANDOFF_ARCHITECTURE_CONSOLIDATION_CURRENT.md`

Then follow its read order through the master plan, invariants, execution guide, batched-execution amendment, checkpoint protocol, progress ledger, and ADR-0003. If you are operating through the ChatGPT GitHub connector, also obey Miguel's publication rules at `https://pastebin.com/raw/rvyEUuAW`.

Important facts to independently re-confirm from GitHub before writing:

- Phase 3 implementation gate is complete at immutable runtime/product head `07a8295f0221f1f2007cb1f01c99a5998f371f8a`; Verify #865 / run `31444358586` and closure audit `31444581201` are green.
- Phase 4A–E4 is already in that ancestry. Do not replay/rebase/re-port it.
- Phase 4F / PR #95 is green at `bc55ccdf1af7f9f18c9757ffbefaef63944b7f70` (Verify #872).
- Phase 4G / PR #96 is green at `e8508440459d2f649432e4ce3c02ae84d1997b3a` (Verify #873).
- PR #97 is the hosted-green F/G ledger at `026672a1667183e3b70eed5af5a0ebe69c8c6058` (Verify #874).
- Phase 4H / PR #98 is the last fully hosted-green product continuation known when the handoff was prepared: `6ba637f968e424538b719081d7564f1690251df0`, product tree `d6c27ef13e221492d606ad53bc8fd91ab63d7b7f`, Verify #875 / run `31484093720`.
- Phase 4I / PR #99 was active. Its initial head `954e5b98b040d290c60f509e1c5e82d92edbc999` failed Verify #876 only at Prettier for `test/deviceBuildShadowComparison.test.ts`; it is NOT a validated base. Resolve PR #99's live head and latest Verify first. If it has since advanced to a fully green corrective head, continue from that exact head. Otherwise fix/coordinate the existing PR instead of creating a sibling implementation.
- JSON is still the production authority. No SQLite production cutover/rollback and no Phase 5 preload removal is authorized.
- All Phase 2+ architecture PRs remain draft/unmerged. Do not merge or force-push; final persistent-local/device verification belongs to Luna and final merge requires Miguel's explicit authorization.

Your immediate task is to continue Phase 4, not Phase 5.

After resolving PR #99, the intended sequence is:

1. Finish/validate the device-build shadow comparison if needed.
2. Add a best-effort shadow observer at an existing authoritative JSON read seam, with SQLite/comparison/reporting failures fully contained and no decision authority or user-visible latency regression.
3. Separately solve and prove the legacy device-build lock identity compatibility requirement (`/bin/ps ... lstart` `startedAt`) before any live legacy migration read is wired.
4. Gather shadow evidence before introducing a bounded staged production-composition slice.
5. Do not switch authority until the migration/import/comparison/observer evidence supports a fenced single-writer cutover with an explicit read-only rollback window.
6. Continue the remaining session/other transactional domain repository migrations under ADR-0003.
7. Finish doctor/export/corruption recovery, previous-tag Homebrew upgrade proof, and the full Phase 4 gate before Phase 5 begins.

Work autonomously through meaningful bounded slices, keep `ARCHITECTURE_CONSOLIDATION_PROGRESS.md` current at both its top summary and detailed Phase 4 section, and update the current handoff before context is lost. Preserve validated history, clean diffs, fail-closed behavior, process-identity separation, record projections, and rollback safety.
