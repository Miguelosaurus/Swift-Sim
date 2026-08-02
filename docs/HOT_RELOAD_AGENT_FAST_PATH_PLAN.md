# Hot Reload Agent Fast-Path Plan

Status: Phase 4 complete; Phase 5 not started
Target: Swift Sim post-0.6 development cycle  
Owner of architecture: Swift Sim maintainers  
Implementation profile: deterministic CLI orchestration, cached session facts,
compact agent output, and physical-iPhone latency proof

Phase 1 evidence: `benchmarks/results/agent-fast-path-baseline-20260802/`
(`agent-fast-path-baseline`, 7 scenarios × 3 repetitions). This generated
artifact is local and gitignored; it contains only call counts, action names,
reason codes, timings, and the sanitized cost-surface inventory.
The timing samples use injected monotonic seams so the route call graph is
repeatable; subprocess command shapes are counted from the current deep
inspection adapter, not presented as physical-device wall-clock proof. The
physical iPhone latency gate remains Phase 5.

Phase 2 evidence: `benchmarks/results/agent-fast-path-phase2-20260802/`
(`agent-fast-path-baseline`, 7 scenarios x 30 repetitions). Classifier-first
routing recorded zero live-inspector calls for no-change, structural, and
mixed edits; warm scenarios recorded zero prohibited subprocesses. Local
injected-seam p95 was 0.216 ms for no-change and 0.158 ms for structural
decisions. These are route-boundary measurements, not physical-device proof.

Phase 3 evidence: `test/changeDelivery.test.js` and the compact envelope
contract tests. The terminal `deliver-change` path now classifies before live
inspection, coalesces identical in-process requests, routes structural/live-
unavailable/exhausted-recovery cases through exactly one existing signed-build
adapter, and requires applied/refresh/revision proof before returning
`hot-reloaded`. The tests use injected route/build seams; they do not claim
physical-iPhone build or install latency.

Phase 4 evidence: `test/agentSkillFastPath.test.js` and the packaged skill
references under `plugins/swift-sim-companion/skills/remote-simulator-companion/`.
The primary skill is 665 words and 5,032 UTF-8 bytes; setup, live integration,
signed builds, pairing, Simulator preview, troubleshooting, and security are
lazy references. Transcript fixtures cover ordinary edits (zero Swift Sim
commands), one-command warm edits, structural/fallback wording, protocol
drift, and the separate Simulator lane. The fixtures are deterministic static
contracts; physical-iPhone latency remains Phase 5.

Execution rule for the implementing agent: implement the phases in order. Do
not redesign the architecture, weaken the live-success contract, or skip an
exit gate. Stop and report evidence if a gate cannot be met.

## Objective

Make Swift Sim feel like a native, low-latency agent capability:

- ordinary coding work that is not being delivered to an iPhone incurs zero
  Swift Sim commands and zero Swift Sim explanation;
- an active iPhone edit loop uses exactly one Swift Sim command per completed
  change in the normal case;
- warm structural routing is decided before any deep Xcode or Tailnet
  inspection;
- warm live routing does not repeatedly run `xcodebuild -list`,
  `xcodebuild -showBuildSettings`, or Tailscale discovery;
- a successful live result still requires correlated engine and iPhone proof;
- the agent reports either an immediate test-now result or a fresh install link
  in one short sentence; and
- detailed setup, Simulator, and troubleshooting instructions consume agent
  context only when their branch is actually entered.

This is a latency and agent-efficiency project. It does not expand which Swift
edits can be replaced at runtime.

## Current Baseline And Cost Surface

The implementing agent must begin by recording the current baseline rather
than assuming the estimates in this plan are measurements.

Current repository facts:

- the shared companion skill is 577 lines, 5,021 words, and 33,879 bytes;
- its normal edit contract is short, but setup, pairing, Simulator, device
  delivery, security, and troubleshooting material are all in the same file;
- `routeLiveEditSetOnce` classifies the edit and then calls the full
  `inspectLiveReload` path even for `none` and structural results;
- the full inspection may run both `xcodebuild -list -json` and
  `xcodebuild -showBuildSettings`;
- Tailnet discovery may start multiple `tailscale ip -4` subprocesses with
  bounded two-second timeouts;
- a successful or failed live operation can call the full inspection again;
- the route result contains diagnostic structures that are useful to tests and
  developers but unnecessarily large for the normal agent handoff; and
- structural routing currently requires the agent to call `build-device`
  separately after `route-change` returns.

The Phase 1 baseline must record actual cold and warm timings for each of those
operations before behavior changes.

## Non-Negotiable Architecture Decisions

### 1. Add one terminal agent command

Add an agent-facing command named:

```sh
swift-sim deliver-change
```

The command delivers an edit that the coding agent has already made. It does
not modify source code, create commits, switch branches, or infer edits from a
watcher.

It accepts the existing before/after pairs and the normal build identity:

```sh
swift-sim deliver-change \
  --before "<previous.swift>" \
  --after "<current.swift>" \
  --project "<App.xcodeproj>" \
  --scheme "<App>" \
  --allow-provisioning-updates
```

Use `--workspace` for workspace projects. Preserve repeated `--build-setting`
support and matching multi-file before/after pairs. A future manifest input may
be added only if it reuses the canonical edit-set schema and does not introduce
a second classifier.

`deliver-change` owns the terminal routing decision:

- eligible and ready: compile, inject, and prove the live replacement;
- structural, mixed, or live-unavailable: call the existing signed-device
  build workflow and return its fresh link;
- transient live failure: retain the existing single bounded recovery attempt,
  then call the signed-device build workflow if proof still fails;
- no change: return without contacting the live engine or starting a build;
- setup/signing/user-action failure: return one typed terminal error.

The command must reuse the existing route and device-build implementations. It
must not spawn a nested `swift-sim` process, duplicate signing logic, create a
second device-build store, or bypass the helper's capability boundary.

Keep `route-change` for compatibility, diagnostics, and the benchmark. Do not
silently change its existing action meanings.

### 2. Return a compact terminal envelope

`deliver-change` returns a versioned, path-redacted JSON envelope. The normal
agent should need only `outcome`, `message`, and the relevant delivery object:

```json
{
  "schemaVersion": 1,
  "outcome": "hot-reloaded",
  "message": "Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.",
  "delivery": {
    "kind": "live",
    "revision": 42
  },
  "timing": {
    "totalMs": 812
  }
}
```

The allowed terminal outcomes are:

- `hot-reloaded`
- `install-link-ready`
- `no-change`
- `needs-user-action`
- `failed`

An `install-link-ready` result includes only the user-facing universal link,
the custom-scheme fallback when available, the minimum truthful install state,
and safe signing warnings. It must not include an IPA path, archive path,
device identifier, team identifier, project path, local port, Tailnet name, or
raw build log.

Detailed diagnostics remain available behind an explicit `--verbose-json`
flag and in private logs. Normal success output must not make the agent parse
the full live/project/engine diagnostic tree.

Output size gates:

- `hot-reloaded`, `no-change`: at most 1 KiB serialized;
- `install-link-ready`: at most 2 KiB serialized, including links;
- normal `needs-user-action`: at most 2 KiB before an explicit diagnostic
  request; and
- bearer links and tokens must never appear in logs, snapshots, fixtures, or
  committed benchmark artifacts.

### 3. Classify before inspecting live readiness

The canonical edit-set classifier always runs first.

- `none` returns immediately.
- `build-device` proceeds directly to the device-build workflow.
- only a hot-reloadable edit may inspect the live session.

This removes Xcode, Tailnet, engine, and signing inspection from the structural
decision path. A mixed edit remains one rebuild operation; it must never be
split into a partial live patch.

### 4. Separate deep readiness from warm readiness

Keep two explicit inspection modes:

- **deep readiness** establishes or diagnoses a session. It may inspect Xcode
  schemes/build settings, package linkage, Tailnet configuration, engine
  installation, and compiler capture state;
- **warm readiness** validates an already-established live session. It may
  read private session facts, validate cheap fingerprints, and ask the live
  engine for current status.

The warm path must not run:

- `xcodebuild -list`
- `xcodebuild -showBuildSettings`
- `security find-identity`
- Tailscale discovery or Serve configuration
- agent plugin discovery
- Simulator inspection

If a warm invariant is stale or missing, return to deep readiness once. Do not
paper over a stale session and do not repeatedly deep-inspect after each edit.

### 5. Persist authoritative session facts, not guesses

Extend the existing private live-engine session record rather than creating an
unrelated cache subsystem. The deep path records an atomic, mode-0600 session
descriptor containing only local operational facts:

- schema version and Swift Sim/engine protocol versions;
- canonical project root and selected Xcode container;
- selected scheme and application target;
- engine session nonce and engine version;
- live host selected for that session;
- compiler-capture generation or manifest fingerprint;
- whether the selected target linked `SwiftSimLive`;
- fingerprints for every configuration file that makes the facts
  authoritative; and
- the time and reason the descriptor was established.

Fingerprints must cover the selected project definition, workspace metadata
when relevant, selected shared scheme, package resolution/configuration files,
and any other file whose mutation can invalidate target or scheme selection.
Use canonical paths plus size, modification time, and SHA-256 for small
configuration files. Do not hash the entire source tree per edit.

Warm readiness must reject the descriptor when:

- the requested project/workspace or scheme differs;
- a required fingerprint differs or a file disappears;
- the engine session nonce/version differs;
- compiler capture no longer matches the selected project/module;
- the live client is disconnected;
- the engine reports an error; or
- the descriptor is malformed, unreadable, or from an unsupported schema.

Project/configuration drift is fail-closed. The next action is deep readiness
or a signed build, never an assumed live patch.

### 6. Keep the proof path fresh

Caching may remove repeated configuration discovery. It must never cache or
infer a successful patch.

Every live edit still requires:

- the current request ID;
- successful patch compilation;
- a load/interposition acknowledgement from the running iPhone process;
- `applied: true` where applicable;
- nonzero dynamic replacements for dynamic-replacement mode;
- `refresh_acknowledged: true`;
- a nonzero revision greater than the prior revision; and
- any semantic marker required by the benchmark.

After success, do not call full `inspectLiveReload` merely to decorate the
result. The correlated patch report and one cheap engine-status read are the
authoritative warm proof. Screenshots remain outside the edit loop.

### 7. Do not add an always-on source watcher

The coding agent already knows which files it changed. It supplies the
canonical edit set after completing one logical change. Swift Sim must not
watch every save, inject partial source while the agent is still editing, or
race the user's editor.

One logical agent change produces one `deliver-change` invocation. Multi-file
changes remain atomic where the live engine supports an atomic bundle.

### 8. Make detailed skill context lazy

Refactor the packaged skill into a small primary contract plus branch-specific
references.

The primary `SKILL.md` contains only:

- trigger and scope;
- the one-command fast path;
- terminal outcome handling;
- exact user-facing handoffs;
- the Debug/private-Tailnet and install-identity safety invariants;
- a short update/version-drift branch; and
- a routing index for references.

Move detailed content into packaged references such as:

```text
references/
  setup-and-updates.md
  live-project-integration.md
  signed-device-builds.md
  pairing.md
  simulator-preview.md
  troubleshooting.md
  security-boundaries.md
```

The primary skill must state exactly when each reference is required. A normal
warm phone edit must not require any reference. Setup reads only setup and live
integration. A build failure reads signed builds and the relevant
troubleshooting branch. Simulator work reads only simulator preview.

Primary skill size gates:

- at most 1,200 words;
- at most 12 KiB UTF-8;
- the normal phone-edit algorithm at most 300 words; and
- no duplicated benchmark history, transport implementation narrative, or
  exhaustive troubleshooting list.

The source skill and all Codex, Cursor, Claude Code, and OpenCode packaged
copies remain byte-identical. Explicit plugin versions still move together.

### 9. No silent automatic updates

Do not add a background plugin or CLI updater. A running agent session may have
already loaded its skill, and a silent update can create a mid-session contract
change.

The fast command validates the helper runtime protocol. A protocol or packaged
integration mismatch returns `needs-user-action` with one instruction:

```text
Update Swift Sim, then start a new agent session.
```

Only that branch runs or recommends `swift-sim doctor --json`. Normal warm
edits must not run doctor, setup, Homebrew, or agent-plugin discovery.

### 10. Preserve all existing safety and delivery semantics

This project must not change these contracts:

- live replacement remains Debug-only and private-Tailnet-only;
- Release, TestFlight, and App Store builds never enable live loading;
- live port 8887 is never exposed through Funnel, Cloudflare, or a public
  firewall rule;
- signed fallback builds preserve bundle identifier, team, entitlements, and
  app data unless the user explicitly changes them;
- install handoff says **Install opened** until helper/device verification
  proves **Installed**;
- public device delivery remains token-scoped and time-bounded;
- failures never become claimed successes; and
- no user is asked to choose the delivery lane.

## Agent Behavior Contract

### Ordinary coding

If the user did not request iPhone delivery, remote hot reload, Swift Sim, or
continuation of an already-explicit phone-testing loop, do not invoke Swift
Sim. Editing, local tests, and code review remain unchanged.

### Entering a phone-testing loop

The agent identifies the project/workspace and scheme from repository context,
then calls `deliver-change`. It does not begin with a full doctor report.

If the command is missing or returns `needs-user-action`, follow the one stated
setup/update branch. After setup or a baseline Debug install, retry the same
logical delivery once.

### Continuing a phone-testing loop

For each completed logical change, call `deliver-change` exactly once. Do not
run `doctor`, `live-status`, `setup-status`, screenshots, or UI analysis first.
The command owns classification, warm readiness, proof, recovery, and build
fallback.

### User-facing terminal copy

For `hot-reloaded`, say exactly:

```text
Hot reloaded successfully. Test it now on your iPhone in the running Debug app—no install needed.
```

For `install-link-ready`, say:

```text
This change needs a new signed build.
```

Then provide the returned universal link labeled exactly:

```text
Open in Swift Sim to Install
```

For `no-change`, do not mention delivery. For `needs-user-action`, explain only
the returned actionable item. Do not explain the classifier, InjectionNext,
engine recovery, or transport unless the user asks or a diagnostic is needed.

## Performance Metrics And Budgets

Use monotonic timing. Keep cold and warm results separate.

Record:

- process startup;
- edit-set parsing and classification;
- session descriptor load/fingerprint validation;
- engine-status request;
- replacement generation and Swift compilation;
- engine queue/load acknowledgement;
- root refresh acknowledgement;
- terminal result serialization;
- device-build start, archive readiness, delivery readiness, and link return;
- count and duration of all subprocesses; and
- serialized stdout/stderr byte counts.

Warm fast-path gates after the harness is validated:

- structural/no-change classification p95 at or below 250 ms before any build;
- pre-patch warm-readiness overhead p95 at or below 250 ms;
- confirmed single-file hot reload p50 at or below 1,000 ms;
- confirmed single-file hot reload p95 at or below 2,000 ms;
- no `xcodebuild`, `tailscale`, `security`, Homebrew, or plugin-manager
  subprocesses in a valid warm live route;
- exactly one agent-facing Swift Sim command for a normal hot reload;
- exactly one agent-facing Swift Sim command for a structural edit that returns
  a ready install link;
- zero screenshots or UI-analysis calls in either edit path; and
- zero dangerous false-live results.

If physical hardware or the Swift compiler prevents the 1,000/2,000 ms targets,
report the measured distribution and phase responsible. Do not hide latency by
ending the timer before iPhone acknowledgment or weaken proof to meet a target.

## Repository Layout

The implementing agent should prefer this layout, adjusting only when an
existing module is a demonstrably better boundary:

```text
mac-helper/
  bin/
    swift-sim.js                         # deliver-change CLI parsing only
  src/
    liveReload.js                       # canonical classifier/injection remains
    liveSessionDescriptor.js            # atomic descriptor + fingerprints
    changeDelivery.js                   # terminal orchestration and envelope

plugins/swift-sim-companion/
  skills/remote-simulator-companion/
    SKILL.md                             # compact primary contract
    references/
      setup-and-updates.md
      live-project-integration.md
      signed-device-builds.md
      pairing.md
      simulator-preview.md
      troubleshooting.md
      security-boundaries.md

benchmarks/
  src/
    agentFastPath.js                    # latency/call-count harness
  test/
    agentFastPath.test.js

test/
  changeDelivery.test.js
  liveSessionDescriptor.test.js
  agentSkillFastPath.test.js
```

Do not move unrelated helper, Simulator, delivery, or security modules merely
to match this diagram.

## Implementation Phases

### Phase 1: Baseline, contracts, and harness

Deliverables:

1. Add a deterministic fast-path benchmark harness with injected command,
   clock, live-engine, build, and filesystem adapters.
2. Record the current cold/warm call graph and timing for:
   - `none`;
   - obvious structural single-file edit;
   - mixed multi-file edit;
   - warm eligible edit;
   - warm eligible edit followed by success inspection;
   - live-unavailable eligible edit; and
   - transient failure/recovery/fallback.
3. Count subprocess invocations by executable and arguments.
4. Record current route-result JSON size and current primary-skill size.
5. Commit the terminal envelope schema and outcome vocabulary as tests before
   implementing the command.
6. Add fixtures for redaction, link-bearing output, signing warnings, and typed
   user-action failures.

Phase 1 exit gate:

- the harness deterministically exposes the current repeated deep-inspection
  work;
- baseline artifacts contain no source, paths, signing identities, Tailnet
  names, device identifiers, or tokens;
- timing boundaries are monotonic and independently testable;
- compact schema tests fail because implementation does not yet exist; and
- no production behavior has changed.

### Phase 2: Classifier-first routing and warm session descriptor

Deliverables:

1. Refactor routing so `none` and structural/mixed changes return before live
   inspection.
2. Add the private versioned session descriptor and atomic publication.
3. Establish the descriptor only from the existing deep readiness/start/build
   path after scheme, target, package, host, engine, and compiler facts are
   authoritative.
4. Add cheap fingerprint validation and an engine-only warm-readiness path.
5. Remove full post-patch inspection from successful warm delivery; retain the
   correlated patch proof and a cheap engine status read.
6. Fall back to deep readiness once when the descriptor is absent or stale.
7. Preserve existing `route-change` JSON shape and action semantics.

Required tests:

- no-change and structural edits invoke no live inspector;
- valid warm readiness invokes no prohibited subprocess;
- every fingerprint mutation invalidates the descriptor;
- malformed, symlink-swapped, truncated, broadly-permissioned, and wrong-schema
  descriptors fail closed;
- project/scheme/engine nonce or version mismatch fails closed;
- compiler-capture drift fails closed;
- concurrent descriptor readers never observe partial state;
- a stale writer cannot replace a newer session descriptor;
- live disconnect or engine error is never masked by cached facts;
- success still requires current request, load, refresh, and revision proof;
  and
- current classifier and physical benchmark semantics remain unchanged.

Phase 2 exit gate:

- all existing live-reload tests pass unchanged or with strictly additive
  assertions;
- the harness proves zero prohibited subprocesses on the warm live path;
- structural/no-change paths meet the 250 ms p95 gate in repeated local runs;
- zero dangerous false-live results remain; and
- `route-change` remains backward-compatible.

### Phase 3: Terminal `deliver-change` command

Deliverables:

1. Implement the CLI input contract and canonical multi-file edit set.
2. Add `changeDelivery.js` to orchestrate existing route, bounded recovery, and
   existing helper-owned device build.
3. Return the compact terminal envelope for every outcome.
4. Route structural/mixed/live-unavailable edits directly into one signed
   fallback build.
5. Route an exhausted transient live failure into one signed fallback build.
6. Preserve build settings, workspace/project selection, signing warnings,
   TTL, bundle/team identity, and install-state truth.
7. Add `--verbose-json` without changing compact defaults.

Required tests:

- eligible warm success returns `hot-reloaded` and no link;
- structural and mixed edits return one `install-link-ready` result;
- live-unavailable eligible edits return one `install-link-ready` result;
- successful bounded recovery still returns `hot-reloaded`;
- exhausted recovery builds exactly once;
- compile failure does not retry live injection and builds exactly once when
  the source remains buildable;
- partial application never retries or claims success and forces clean-session
  recovery before another live edit;
- authoring/build compile failure returns a typed failure without a false link;
- no change contacts neither engine nor builder;
- workspace and repeated build settings are preserved;
- identity drift produces a warning/failure according to the existing build
  contract;
- compact envelopes meet byte budgets and redact private fields;
- bearer links appear only in the returned terminal envelope; and
- concurrent identical delivery requests do not create duplicate builds.

Phase 3 exit gate:

- the scripted normal hot, structural, unavailable, and recovered-failure
  scenarios each require one agent-facing command;
- the compact output schema is stable and versioned;
- all device-build security, persistence, and installation tests pass; and
- no route/build logic has been duplicated.

### Phase 4: Skill decomposition and agent transcript contract

Deliverables:

1. Reduce the primary skill to the size budgets above.
2. Move detailed material into the explicit reference files without losing a
   safety rule or supported workflow.
3. Replace the mandatory first-thread doctor sequence with the one-command
   delivery contract; doctor becomes setup/update/diagnostic only.
4. Add deterministic transcript fixtures that assert agent command count,
   branch selection, and final wording.
5. Update Codex, Cursor, Claude Code, and OpenCode manifests/versions together.
6. Update setup, agent workflow, development, and troubleshooting docs.

Transcript scenarios:

- unrelated Swift edit: zero Swift Sim commands;
- explicit first iPhone delivery with healthy setup: one `deliver-change`;
- second through tenth compatible edits in the same phone loop: one command per
  edit, no doctor or status calls;
- structural edit: one command and one install link;
- live failure with successful internal recovery: one command and hot-reload
  wording;
- live failure with build fallback: one command and install-link wording;
- setup missing: one failed delivery, only the required setup branch, then one
  retry;
- protocol/plugin drift: concise update instruction and new-session reminder;
- Simulator preview request: loads only the Simulator reference and does not
  use the phone-edit fast path; and
- user asks for diagnostic detail: loads only the relevant reference.

Phase 4 exit gate:

- primary skill meets word and byte budgets;
- every packaged host reads the same source skill and references;
- release tests detect missing references or version drift;
- normal transcript fixtures contain no screenshots, repeated readiness checks,
  or internal mechanism explanation; and
- final messages use the exact terminal copy.

### Phase 5: Physical-iPhone latency and reliability proof

Use a regular development-signed Debug app over the private Tailnet. Do not use
Simulator results as a substitute.

Runs:

1. Establish one clean baseline session through the deep path.
2. Run at least 30 consecutive representative warm compatible edits across:
   - SwiftUI body/layout/modifiers;
   - Liquid Glass modifiers and native surfaces;
   - computed helpers and function bodies;
   - multi-file atomic bundles; and
   - one supported interposition path.
3. Restore the baseline through the same live path after each benchmark case.
4. Run at least ten structural/no-change routing cases and measure the decision
   boundary separately from build time.
5. Complete at least one real signed structural fallback build and openable
   Swift Sim handoff.
6. Exercise one recoverable transport failure and one exhausted-recovery build
   fallback in disposable state.

Evidence:

- request-correlated runtime report;
- increasing nonzero revisions;
- semantic markers where the existing benchmark requires them;
- phase timings and subprocess counts;
- command and output byte counts;
- proof that no rebuild/reinstall occurred during hot cases;
- proof that the structural fallback preserved update identity; and
- sanitized JSONL/report artifacts using the existing benchmark redaction
  rules.

Phase 5 exit gate:

- zero dangerous false-live or false-success results;
- zero unhandled partial applications;
- warm structural and readiness latency meet their p95 budgets;
- hot reload meets the 1,000 ms p50 and 2,000 ms p95 targets, or the report
  identifies the exact physical/compiler phase preventing them;
- one-command agent behavior is proven for live and build outcomes; and
- no screenshot is required for any passing result.

### Phase 6: Release integration and hygiene

Deliverables:

1. Run the complete Node, Swift package, benchmark, release, shell/YAML, and
   native Xcode test gates required by the repository.
2. Validate source-package parity for the CLI, helper, skill, references, and
   plugin manifests.
3. Update architecture, setup, troubleshooting, agent workflow, development,
   release, and user-facing hot-reload documentation.
4. Document the compact schema and compatibility policy.
5. Package one version-matched Homebrew release and refresh every supported
   agent integration through `swift-sim setup`.
6. Start fresh agent sessions and rerun the transcript smoke cases from the
   installed package, not the source checkout.
7. Verify the running helper path/version/protocol and the installed iPhone app
   build identity before making release claims.

Phase 6 exit gate:

- main and the release artifact contain the same reviewed source;
- the public Homebrew formula installs the tagged version;
- `swift-sim update` refreshes integrations and reports drift truthfully;
- the installed package passes the warm phone-edit smoke test;
- documentation makes no universal hot-reload-percentage claim; and
- local and GitHub main are clean and synchronized.

## Required Regression Matrix

The implementation must preserve or add coverage for:

- all existing classifier categories and stable reason codes;
- project and workspace scheme selection;
- selected host-application target/package association;
- SwiftSimLive package detection scoped to the selected target;
- Debug-only compiler/linker instrumentation;
- release archive isolation;
- dynamic replacement and interposition proof differences;
- atomic and sequential multi-file behavior;
- partial-application contamination handling;
- lifecycle locks and engine/session nonce ownership;
- stale/malformed/private session state;
- Tailscale backend conflict and private-route safety;
- signed-build identity and entitlement preservation;
- install request versus verified installation truth;
- capability/token redaction and expiry;
- helper/runtime protocol mismatch;
- plugin version drift and new-session requirement; and
- one-shot command SIGINT/SIGTERM behavior.

## Definition Of Done

This project is complete only when all of the following are true:

1. A normal coding task with no iPhone-delivery intent invokes no Swift Sim
   tooling.
2. A normal warm iPhone edit invokes exactly one agent-facing Swift Sim command.
3. That command returns either proven immediate test-now status or a ready
   signed install link without asking the user to choose a lane.
4. Warm hot routing runs no deep Xcode, Tailnet, signing, Homebrew, plugin, or
   Simulator discovery.
5. Structural and no-change routing happens before live readiness inspection.
6. Every claimed hot reload has current correlated iPhone proof.
7. The primary skill and compact output meet their size budgets.
8. Physical warm latency is measured honestly against the stated p50/p95 gates.
9. Existing security, signing, app-data, delivery, and update contracts remain
   intact.
10. The installed release—not merely the source checkout—passes the final
    one-command phone-edit smoke test.

## Explicitly Deferred

- automatic source watching or injection on every save;
- silent plugin, CLI, helper, or engine auto-updates;
- Release, TestFlight, or App Store live loading;
- public exposure of the live injection transport;
- screenshots or vision analysis in the per-edit loop;
- an LLM-based hot-reload safety classifier;
- speculative caching beyond the authoritative session descriptor;
- changing the set of Swift language/runtime forms currently supported;
- redesigning the Swift Sim iOS interface; and
- universal claims about the percentage of real SwiftUI work accelerated.
