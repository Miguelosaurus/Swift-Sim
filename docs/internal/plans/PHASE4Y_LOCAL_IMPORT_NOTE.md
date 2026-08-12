# Phase 4Y local import blocker

Real-Mac Phase 4X verification on product head `63ceccdc630fc6c6c9d4aba9e3cb397b95c503a6` narrowed the remaining device-build shadow-import incompatibility to exactly two historical records. Both records already carried `signing.deviceInstallable: true` but omitted `signing.style`.

Historical Swift-Sim creation semantics initialized `signing.style` to the empty string and later replaced it with Xcode's `CODE_SIGN_STYLE` when available. Phase 4Y therefore reconstructs only an absent `signing.style` as `""` before the unchanged strict persistence validator. Present malformed values and a missing signing object remain fail-closed.

This slice does not change JSON bytes, SQLite authority, write routing, cleanup behavior, or Phase 5 authorization. A real 212-record import rerun remains required after hosted verification.
