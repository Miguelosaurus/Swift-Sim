# Open-source readiness audit — November 9, 2026

## Scope and findings

This pass audited tracked source, reachable Git history, release asset names,
package contents, public GitHub settings, dependencies, docs, and contributor
entry points. It did not use the owner's phone, rewrite Git history, rotate
credentials, update the installed helper, or alter frozen releases.

- Gitleaks 8.30.1 found no credential matches in reachable history (1,896
  diff-bearing commits; about 12.37 MB scanned) or the tracked-file snapshot.
  The scanner was downloaded from its official release and checksum-verified;
  reports were redacted and kept in ignored task output.
- GitHub returned no secret-scanning alerts. Secret scanning, push protection
  and private vulnerability reporting were already enabled. No access setting
  was weakened or newly granted.
- Owner-specific paths and an owner-named example hostname were replaced with
  synthetic fixtures or checkout placeholders. Earlier commits retain their
  original examples; this pass does not claim historical erasure. The contact
  email in Security, Privacy and Code of Conduct is intentional public support
  information, not a discovered credential.
- Public release assets had no key, provisioning-profile, IPA or log filenames.
  This is a filename inventory, not a forensic scan of every historical binary.
- The README no longer repeats contribution instructions or carries a stale
  November 8 TestFlight banner. TestFlight availability stays in its canonical
  dated guide. Package description and documentation reflect the Mac-hosted,
  agent-agnostic workflow. Getting Help is included in the Mac package.
- Private reporting instructions now lead with GitHub's enabled private
  reporting channel. Local ASC credentials, signing exports and test outputs
  have additional ignore rules. License/provenance links were checked; the
  pinned optional idevice provider is MIT, and vendored iCTRL retains its
  Apache license/provenance.

A clean scan cannot prove that an unknown or previously removed secret was
never exposed. No actionable credential exposure was found by these checks.

## Dependency changes and compatibility

The initial npm audit reported nine advisories, all in development tooling;
the initial production-only audit was clean. The final complete audit reports
zero vulnerabilities across production and development dependencies.

ESLint is now the supported 10.14.0 release, TypeScript ESLint is 8.72.2, and
Node 24 types are 24.19.2. Scoped minimatch 11.0.5 overrides cover the two lint
consumers on the project's supported Node 24 runtime. npm's suggested downgrade
to an unsupported lint version was not used. TypeScript 5 and the existing
formatter remain intentional compatibility pins, not unreviewed major upgrades.

The optional Simulator provider is updated from 0.1.44 to 0.1.49, including
[upstream access hardening](https://github.com/EvanBacon/serve-sim/pull/166) and
scoped shutdown improvements. No new runtime dependency was added. A real
Simulator probe caught a changed device-mounted stream path: the AVCC adapter
now resolves the sibling of the advertised MJPEG path. Regression tests cover
both legacy root and mounted paths. Host-shell execution remains disabled by
default; no new remote command feature was enabled.

The existing engine/SDK pin and normal hot-reload/notification logic are
unchanged. Preview helpers remain on demand and were stopped after this test.

## Verification

- Full Node 24 check passed source syntax, architecture/docs, types, format,
  lint, 1,664 source tests, 1,028 compiled tests, three hermetic tests, and
  package checks after the dependency changes.
- After correcting the subsequently discovered stream-path mismatch, the
  focused adapter regression passed and package build/install checks passed
  again. No claim is made that the earlier full-suite run contained that new
  regression case.
- Stock task-owned iOS 26.5 Simulator: live AVCC response (HTTP 200, 65,346
  received bytes) and a complete JPEG frame (341,275 received bytes); scoped
  stop completed and the listening port closed. This is Mac Simulator proof,
  not physical-phone control or delivery qualification.
- New CI workflow YAML and shell syntax passed; the pinned scanner ran locally.
  A lockfile-only dependency audit passed without installing node_modules,
  matching the new security job's setup.
- Package checks passed 597 intended paths, isolated installation/setup/doctor,
  marketplace/skill discovery, and Homebrew syntax/Node 24 entrypoints. The
  destructive clean Homebrew install gate was skipped locally; hosted CI owns
  that disposable-runner check.

The new read-only Security workflow runs redacted history scans and locked-
dependency auditing on pushes and pull requests. It adds no local watcher or
runtime service. Publication of the coordinated Mac release is separate from
this source cleanup. TestFlight 0.6.5 (15) was still Waiting for Review at this
pass's readback. The public-beta and fresh-developer phone gates remain as
recorded in [TestFlight](../../TESTFLIGHT.md).

Detailed reports and temporary runtime records remain in ignored
`.build/oss-audit-20261109/` output. No raw diagnostic archive or local credential
was added to Git.
