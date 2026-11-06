# Cross-file views and helpers: physical qualification

Qualified November 5, 2026 local time, on the existing Zenics Debug build 40.
No app rebuild/reinstall, product-source mutation, testing runner, or UI control
was used. Immutable snapshots went through ordinary durable delivery and the
normal installed helper. The engine process was preserved.

## Phone result

| Step | Accepted change | Native revision | Visible result |
| --- | --- | --- | --- |
| Initial | Existing root uses a new shared helper and a SwiftUI badge in two new source files | 4 | Badge and tab label show Cross-file 1 |
| Follow-up | Change only the new helper file | 5 | Both show Cross-file 2 |
| Restore | Original root, empty desired source for both new files | 6 | Badge removed and original tab label restored |

All three receipts proved complete coverage, exactly one installed Swift dynamic
replacement, zero Objective-C replacements, applied/refreshed acknowledgements,
and `preserve-state-v1`. They shared one binary/process identity. The helper-only
request contained one accepted file; its compilation included the existing root
consumer and new badge automatically. On-demand element observations matched
each expected label/removal. Local screenshots corroborated the rendered badge;
the follow-up screenshot was inspected directly.

Final source hashes match the installed originals. Neither synthetic new source
path was created on disk. The final desired state is the original baseline,
with no current-binary pending request, active claim, or restoration obligation.
The unrelated expired uncertain request for an older binary remains intact.

This qualifies these concrete stateless views/helpers and existing parent
preserved refresh. It does not establish arbitrary state migration or preservation
inside introduced subtrees: their patch-module type identity changes each
generation. Restoring source behavior does not unload old images or metadata.
Different-network/cold-restart behavior was not requalified by this three-step
phone test; local recovery tests cover the cumulative bookkeeping separately.

## Negative and recovery evidence

The native host harness loaded three real generations, checked shared results,
SwiftUI conformance/body creation, private scope, old/new nominal coexistence,
and restoration. Fifteen negative bundles rejected, including installed/shared
name collisions, private cross-file access, nested class/actor/protocol additions,
layout/signature changes, storage, macros and unsupported imports/conformances.
Two ordinary optimized builds contained no injection replacement symbols.

An initial operator sequencing error launched a test against the previous helper
after activation preflight stopped. That request failed before preparation with
no prepared image, application claim or proof. Nothing was applied. Its original
failure evidence is preserved separately; after active-candidate verification,
a new explicit qualification request completed the three steps above.

Recovery tests also cover corrections after pre-application failure. A rejected
editor draft can supply explicit correction lineage, but its cloned before-source
is normalized to the verified effective predecessor before queue admission. This
keeps all desired changes in compilation while preserving immutable accepted
snapshots and claim/uncertainty fences. Independent review confirmed this path.

## Local artifacts

Owner-only evidence lives under `.build/crossfile-delivery-20261105/`:
`host-final/`, `captured-final/`, `phone-after-activation/`, source/compiled gate
logs, activation backups and resource ownership notes. Phone context and images
remain local and are not committed or uploaded to another service.
