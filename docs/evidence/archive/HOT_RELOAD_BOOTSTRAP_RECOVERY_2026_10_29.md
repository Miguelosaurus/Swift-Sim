# Hot Reload Bootstrap and Recovery — 2026-10-29

Status: repository corrections and local regression verification; fresh
physical-device compile/apply/refresh acceptance remains outstanding.

## Reported physical-device observations

A native-dependency application installed successfully but terminated in dyld
before startup. The affected Debug dylib imported a Rust/serde symbol from its
own image while defining that symbol privately. A project-specific,
application-target Debug-only classic-linker workaround produced a subsequent
build that launched and connected to the live engine. This is consistent with
the upstream [interposable linker defect and FB22853074](https://github.com/johnno1962/InjectionIII/issues/569).
Swift Sim does not apply that workaround automatically.

One body-only delivery then returned `HELPER_UNAVAILABLE`. A subsequent setup
report described the helper and optional live prerequisites as ready, and a
separate local health request succeeded. No patch was applied. The temporary
source edit was removed. These observations were reported by the application
task; they do not prove that the failed request was a timeout or that hot
reload succeeded.

## Reproduced locally

The actual installed CLI entrypoint, with its runtime boundaries enabled, was
exercised against isolated loopback fixture servers and a temporary home:

| Controlled response | Previous installed result | Corrected result |
| --- | --- | --- |
| Health response stalls past the 1.2-second deadline | `HELPER_UNAVAILABLE`, setup and new-session instruction | `HELPER_TIMEOUT`, responsiveness diagnosis |
| HTTP 200 with malformed JSON | `PROTOCOL_MISMATCH`, update and new-session instruction | `HELPER_RESPONSE_INVALID`, listener/contract diagnosis |
| Well-formed incompatible runtime protocol | `PROTOCOL_MISMATCH` | `PROTOCOL_MISMATCH`, align runtime; reload agent only if its integration changed |

The old delivery catch discarded the original exception. Its compatibility
fetch boundary also converted incompatible successful responses into a generic
503. This establishes two reproducible diagnostic defects; the original
application request's discarded cause cannot be recovered from its outcome.

Read-only inspection of three existing Debug dylibs also reproduced the known
linker shape: two affected images each had 29 private self-imports; the
corrected image had none. This inspection did not rebuild, install, launch, or
change the application.

## Corrections and limits

- Shared bounded health inspection checks helper identity, package version,
  runtime protocol and health status. It distinguishes transport refusal,
  timeout, HTTP failure, invalid data and actual contract drift. Diagnostics
  retain only bounded categories, allowlisted transport codes and HTTP status,
  not arbitrary response bodies or client error messages.
- Delivery and setup/doctor use the same helper readiness contract. Optional
  live readiness describes prerequisites and still requires live proof.
- Live-enabled Debug builds inspect app Debug dylibs before compilation-map
  registration, IPA packaging or ready publication. Known private self-imports
  and incomplete inspection fail closed. Existing project linker selections
  are preserved; ordinary signed builds and shipping configurations do not
  acquire a new linker override.
- First-time integration, signed Debug installation, cold launch and one
  proven edit are documented separately from ordinary warm delivery. A
  same-version helper recovery does not require abandoning an agent session.

The linker guard targets a known defect; it is not a general launchability
test. Typed health failures improve diagnosis, not evidence that every request
will meet its deadline. Fixture tests do not establish an actual phone patch.

## Repository verification

`npm run check` passed on Node 24.19.0: 926 source tests, 378 compiled tests,
two hermetic package tests, type/lint/format checks, documentation and
architecture gates, compiled runtime probes, and clean archive installation.
The new health, setup-status and linker tests are included in the persistent
compiled gate. No source-text test allowance was added.

The first broad run exposed an older pairing fixture that supplied HTTP success
without a health envelope. It now supplies the real version/protocol contract,
uses a temporary home and forbids external process startup. The full source
suite was rerun successfully after that correction. The default shell's Node
26 was rejected by the existing runtime gate; qualification used Node 24.

Independent review found no unresolved P0/P1/P2 findings. Real Homebrew
installation/service transition, a fresh app build/launch, and physical patch
acceptance were not run. The package check's optional destructive Homebrew
installation gate was skipped; formula/compiled-entrypoint checks passed.

## Physical acceptance still required

Use the intended installed candidate and an app containing the native
dependency. Preserve its bundle identity, signing team, data and existing
Debug-only workaround:

1. Build/install a live-enabled signed Debug app in place and cold-launch it.
2. Confirm the app stays running and joins the intended private live session.
   Check Apple device-management and Tailnet reachability separately.
3. Deliver one reversible body-only visible label edit. It must appear without
   another install, with the current request's applied result, refresh
   acknowledgement and revision greater than the pre-edit revision.
4. Restore the source edit and verify the restoration through the same proof
   contract. Retain any failed valid attempt; do not retry partial application
   as though no mutation occurred.

No production deployment, phone installation, application source change,
pairing change, state migration or app-data reset is part of these corrections.
