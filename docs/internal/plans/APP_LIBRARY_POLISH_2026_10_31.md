# App library polish — 2026-10-31

Product change: `ab6fde5`. Public gateway correction: `bd7d1ea`.
Both reviewed checkpoints are on remote `main`; no PR was created.

## Delivered

- Real compiled app icons in the library, history header, and install screen.
  Extraction is optional and does not modify the signed app. Verified thumbnails
  have bounded phone memory/disk caches and an initials fallback.
- Separate app name, version/build, and status lines; accurate build counts and
  ordering by latest build date. Running/failed builds cannot appear ready merely
  because they retain an install URL.
- Latest Build before Build Current Code, four recent previous builds, older
  history behind a disclosure, and retained Debug/Release labels.
- Existing rebuild confirmation, installation acknowledgment rules, and
  notification controls remain in place. No extra idle worker was introduced.

## Verification

- Full feature gate: 1,302 source tests, 750 compiled tests, and two hermetic
  runtime checks passed. Native Companion tests: 58 passed.
- Final gateway fix: focused source tests passed; all 750 compiled tests and
  three hermetic checks passed, including a real gateway process serving icons.
- Syntax, architecture, docs, lint, installed-package verification, and Homebrew
  formula/entrypoint checks passed. Destructive Homebrew installation was skipped.
- Real private and public icon reads returned 200 and matching SHA-256 digests;
  unauthenticated public reads returned 401. Gateway regression covers expired,
  unrelated, retained valid capabilities and tampered icon content.
- A newly created tunnel hostname resolved through DNS while macOS getaddrinfo
  retained a negative cache entry. External verification used a diagnostic-only
  DNS lookup fallback with normal hostname TLS validation; product DNS behavior
  was not changed.
- Synthetic-data simulator UI was visually inspected, including expanded older
  history. Original preview preferences were restored and the task simulator
  was shut down. This is not physical-device UI validation.

## Phone delivery and preserved state

Swift Sim 0.6.1 build **21**, Release/ad-hoc, is ready under Apps → Swift Sim.
Build ID: `493a3fc7-8aa2-417e-af60-b2939e052af0`.
The existing app identity and preserve-data installation were retained.
APNs accepted its build-ready notification; phone display/install remain
unconfirmed. The user must accept installation on iOS.

The saved IPA was not rebuilt for the gateway correction. Its link was renewed
onto the corrected gateway; the previous install capability still returns 200.
The active delivery generation is `24d8c68c-5160-488c-bd0a-6e3990881ff0`, expiring
at `2026-10-31T23:32:48.508Z`. Delivery managers remain until their scoped expiry
to support installation and preserve existing links.

Zenics build 32's retained signed artifact supplied its icon without recompiling;
its signature remained valid. Native hot reload engine PID 42553 and helper
PID 48852 remain available. Compilation registrations and engine capture mapping
hashes are unchanged. No Zenics source or phone app data was changed.

Private operator receipts are under `.build/qol-verification/`, including
`phone-build.json`, resource ownership, and capture hashes. No credentials or
capability URLs are included in this note.
