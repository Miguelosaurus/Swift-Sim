# State-preserving reload: basic physical-phone acceptance

Zenics Debug 40 was installed over the existing app and opened on the physical
iPhone. The running binary matched its qualified build capture and reported
foreground/root readiness at revision 0. SDK source was pinned to
`0819582c5144f59a565641cffe45dcb6f7d40ce3`; native engine source was
`85ba8b7e6f2057b7249b87f5c45bb866d825ceaa` (local candidate 0.5.5).

The normal `deliver-change --live-only` workflow received immutable snapshots
for one instrumented `JournalView.body` edit. Repository app files were never
modified. The navigation title changed temporarily from `Zenics` to
`Zenics · Live`, then a separate normal delivery restored it.

Both requests completed with exact v3 replacement coverage and native
`preserve-state-v1` acknowledgements. Root revisions advanced 0 → 1 → 2 in the
same binary and process. On-demand app context independently observed the
changed title and its restoration, with the same selected-tab geometry and
window size. No build, reinstall, manual refresh or replayed delivery was used
between the two steps.

After restoration, the confirmed desired source equals the installed original
baseline, source hashes remain unchanged, and no delivery for this phone build
is pending. The helper and native engine remain running for ordinary hot reload
and notifications; no temporary verification process or Simulator was started.

This phone check covers the visible body update, exact preserved-refresh
protocol, same-process continuity and restoration. Nondefault drafts, navigation
and scroll retention were exercised in the separate
[Simulator qualification](STATE_PRESERVING_RELOAD_SIMULATOR_2026_11_01.md).
