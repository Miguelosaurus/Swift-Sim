# Remote Hot Reload Benchmark Plan

Status: architecture approved for implementation  
Target: Swift Sim 0.6 development cycle  
Owner of architecture: Swift Sim maintainers  
Implementation profile: deterministic Node tooling plus disposable SwiftUI fixture apps

Implementation checkpoint: Phases 1–2 are complete, and the Phase 3 fixture
apps/oracle implementation is in place with all three unsigned Simulator builds
passing. A signed Catalog fixture has also completed one real iPhone hot edit
and live baseline restore with a correlated replacement report and semantic
marker. The complete three-workload physical smoke gate remains pending until
the explicitly selected iPhone has a stable private-Tailnet live connection; no
Simulator or static result is a substitute for that gate.

## Objective

Build a reproducible benchmark that answers three different questions without
mixing them together:

1. **Is routing safe?** Does Swift Sim send metadata-changing edits to a rebuild
   and only attempt live patching for edits that can preserve the running
   process's Swift metadata?
2. **Does the physical-device loop work reliably and quickly?** Does an edit
   compile, load into the already-installed Debug app, refresh its SwiftUI root,
   execute the changed code, and produce a correlated acknowledgement?
3. **How much real development work does it accelerate?** Across chronological,
   non-cherry-picked edits in real apps, what fraction completes without a new
   build and install?

The benchmark must never turn a curated synthetic score into a universal
percentage. Its first public result may say, for example, "117 of 120 supported
fixture edits completed on an iPhone, with a 620 ms median." A claim such as
"70% of everyday SwiftUI edits hot reload" requires the real-workflow corpus
defined below.

## Non-Negotiable Architecture Decisions

### 1. Keep three scoreboards

The report has three independent sections:

- `classifier`: static routing safety and eligible-routing recall
- `device`: physical-device reliability, semantic confirmation, and latency
- `workflow`: chronological real-app acceleration rate

There is no combined "benchmark score." A regression in one section cannot be
hidden by strength in another.

### 2. A screenshot is never proof

A physical-device patch only passes when machine-readable evidence proves all
of the following:

- the result belongs to the current request ID;
- the patch compiled;
- the running iPhone process loaded a real replacement;
- the Swift Sim root refresh was acknowledged;
- the revision is nonzero and greater than the prior revision; and
- the benchmark app emitted the expected case marker from the changed code.

Screenshots may be used manually while debugging the harness, but they are
never captured, analyzed, or counted by a benchmark run.

### 3. Safety has a zero-tolerance gate

An edit annotated `build-device` that the classifier calls `hot-reload` is a
dangerous false-live result. The accepted count is zero. The benchmark fails
immediately when one occurs and prints the case ID and reason code.

An edit annotated `hot-reload` that the classifier sends to `build-device` is a
lost optimization. It lowers eligible-routing recall but does not violate
safety.

### 4. Curated cases measure engineering coverage, not edit frequency

The built-in corpus is deliberately balanced across edge cases. It is useful
for regressions, but its category distribution is artificial. It must not be
used as the denominator for an "everyday edits" claim.

The workflow acceleration rate comes only from chronological edit capture:
every valid edit in a bounded dogfood period is included in order, including
structural edits and failures.

### 5. The benchmark is local and source-private

No source code, patches, project paths, signing identities, device identifiers,
Tailnet names, or tokens leave the Mac. Exported reports contain case IDs,
category names, sanitized environment versions, reason codes, counts, and
timings.

### 6. Build internal tooling before adding a public CLI

The first implementation lives under `benchmarks/` and is invoked through npm
scripts. Do not add a stable `swift-sim benchmark` user command until the
schemas and runner have survived at least one full physical-device run. This
keeps an experimental release tool from becoming a public compatibility
promise.

### 7. Do not mutate a developer's active checkout

Built-in fixture runs use a disposable copy. Real-app runs use an explicitly
created disposable worktree at a pinned commit. The runner refuses to apply
mutations to the supplied project path itself.

## What Counts As Success

### Static classifier result

Each case declares one expected lane:

- `hot-reload`
- `build-device`
- `none`

The normalized classifier result must contain a stable `reasonCode`; English
messages are display text and are not used for assertions.

The classifier confusion matrix is:

| Expected | Predicted | Meaning |
| --- | --- | --- |
| hot reload | hot reload | eligible route |
| hot reload | build | conservative miss |
| build | build | safe rejection |
| build | hot reload | dangerous false-live; fail |

### Physical-device result

A device attempt moves through these states:

```text
prepared
  -> classified
  -> compiled
  -> loaded
  -> refresh-acknowledged
  -> semantically-observed
  -> restored
```

`semantically-observed` is the only passing terminal state for a valid hot
reload case. `hot-reload-failed` is a correct product fallback, but it is a
failed hot-reload attempt in the reliability metrics.

For SwiftUI body replacements, the raw report must include:

- `applied: true`
- `dynamic_replacements > 0`
- `refresh_acknowledged: true`
- `revision > priorRevision`

For ordinary function-body replacement, the benchmark must additionally call
the changed function and compare its emitted value with the case's expected
value. Until this oracle exists, those cases may be classified but must be
reported as `unverified`, never as device successes.

### Restore result

Every hot case starts from its declared baseline. After measuring the change,
the runner restores the baseline through the same live path. Restore latency is
recorded separately and excluded from headline patch latency.

If restoration fails, or if a multi-file operation partially applies, the
workload is contaminated. Stop that workload, rebuild and relaunch its baseline
app, verify a fresh baseline marker, and only then continue. Never continue
collecting apparently independent results on unknown runtime state.

## Metrics

### Classifier

- **dangerous false-live count:** expected build, predicted hot reload
- **safe precision:** safe hot predictions / all hot predictions
- **eligible-routing recall:** hot predictions / expected-hot cases
- **reason-code distribution:** counts by stable routing reason
- **determinism:** identical result for three repeated static runs

The release gate is zero dangerous false-live results. Eligible-routing recall
is descriptive in the first benchmark; do not weaken safety to hit a target.

### Device

- **confirmed reliability:** semantically observed attempts / valid attempted
  hot edits
- **fallback rate:** `hot-reload-failed` attempts / valid attempted hot edits
- **timeout rate**
- **restore failure rate**
- **partial multi-file application count**
- **p50, p90, p95, p99, minimum, and maximum latency**

Use monotonic time. Headline latency starts immediately before invoking the
route operation and ends when the expected marker is observed from the iPhone.
Also record these internal phases when available:

- classification
- replacement compilation
- engine queue
- device load acknowledgement
- root refresh acknowledgement
- semantic marker observation

The initial target, after the harness itself is proven stable, is:

- at least 99% confirmed reliability over three warm passes;
- p50 at or below 1,000 ms;
- p95 at or below 2,000 ms;
- zero false success reports; and
- zero unhandled partial multi-file states.

These are release targets, not values to hard-code into data collection. A
report always prints the measured values even when a gate fails.

### Workflow

The real-workflow acceleration rate is:

```text
confirmed no-build edits / all valid chronological edits
```

Report Wilson 95% confidence intervals for proportions. Also report results by
category and app. Exclude typo/compile-error attempts from the main denominator
but show them separately as authoring-error recovery.

A broad "everyday SwiftUI" percentage requires at least:

- 200 chronological valid edits;
- three materially different real apps;
- at least two physical iPhone/OS combinations;
- no hand-selection or deletion of failed valid edits; and
- a published denominator, confidence interval, p50, and p95.

Before that threshold, wording must stay scoped to the named app or benchmark
corpus.

## Repository Layout

The implementation should create:

```text
benchmarks/
  README.md
  schema/
    corpus.schema.json
    case.schema.json
    attempt.schema.json
    summary.schema.json
  corpora/
    core/
      corpus.json
      mutations/
        <case-id>.patch
  fixtures/
    HotReloadBenchmarks.xcodeproj/
    Shared/
      BenchmarkMarker.swift
      BenchmarkScreen.swift
    CatalogApp/
    StateApp/
    ArchitectureApp/
  src/
    cli.js
    corpus.js
    classifier.js
    fixtureWorkspace.js
    deviceSession.js
    oracle.js
    runner.js
    statistics.js
    report.js
    sanitize.js
  test/
    corpus.test.js
    fixtureWorkspace.test.js
    runner.test.js
    statistics.test.js
    report.test.js
    sanitize.test.js
  results/
    .gitkeep
```

Generated content under `benchmarks/results/` is gitignored except `.gitkeep`.
The implementation uses Node 20 built-ins and the existing Swift/Xcode tools;
do not add a runtime dependency merely for argument parsing, statistics, JSONL,
or patch orchestration.

## Fixture Workloads

Commit one minimal Xcode project containing three small app targets and schemes.
They share the benchmark marker code but exercise different source shapes.
Each has its own development bundle identifier suffix so it cannot overwrite
the Swift Sim companion or a user's real app.

### CatalogApp

Exercises visual composition:

- text and localized-looking copy literals
- colors, materials, fonts, symbols, opacity, and shadows
- padding, frame, alignment, stacks, overlays, backgrounds, grids, and lists
- conditional and `ForEach` composition
- transitions, animations, and timing values
- nested SwiftUI views

### StateApp

Exercises execution around state without reshaping state:

- `@State`, `@Binding`, `@Environment`, and Observation-backed reads
- button and gesture closure bodies
- computed values used by a view body
- task and async function bodies
- formatter and validation helpers
- sheet, navigation, and alert composition

Cases that add, remove, reorder, or change stored state remain rebuild cases.

### ArchitectureApp

Exercises source and module complexity:

- private and fileprivate views
- nested types
- extensions
- generic views and generic constraints
- protocol conformances
- actor-isolated functions
- multiple files changed in one operation
- helper function interposition followed by a SwiftUI refresh

The fixture project links the repository's local `SwiftSimLive` product and
adds `.swiftSimLive()` exactly once per app root. It uses automatic development
signing supplied at run time; no team ID or device ID is committed.

## Runtime Oracle

The shared fixture code defines a benchmark-only marker view. A hot case changes
both its intended implementation and an immutable case marker within the
replaced body. When the refreshed body executes, the marker writes one
parseable line to the app's device console:

```text
SWIFT_SIM_BENCHMARK {"case":"catalog-padding-001","value":"expected","revision":42}
```

The runner owns the app launch and console stream through `xcrun devicectl`.
It waits for the exact current case ID and rejects stale, duplicate, or
out-of-order markers. The marker carries no network endpoint and sends nothing
off-device.

For function cases, the marker includes the actual return value or stable hash
produced by the changed function. The case manifest declares the expected value.
This proves that the new implementation ran rather than merely proving that
some library loaded.

Before building the full runner, implement a probe that:

1. launches one fixture app with console capture;
2. observes its baseline marker;
3. performs one body-literal patch;
4. observes the new case marker; and
5. restores and observes the baseline marker again.

Do not proceed to bulk corpus work until this probe is repeatable.

## Corpus Format

`corpus.json` is versioned, ordered, and immutable within a tagged Swift Sim
release. Each mutation is a standard unified patch against a known fixture
baseline. The manifest stores hashes so a patch cannot silently target drifted
source.

Example:

```json
{
  "schemaVersion": 1,
  "corpusVersion": "core-1",
  "fixtureRevision": "<git-sha>",
  "cases": [
    {
      "id": "catalog-padding-001",
      "workload": "CatalogApp",
      "category": "layout-modifier",
      "validity": "valid",
      "expectedLane": "hot-reload",
      "confirmationPolicy": "swiftui-body",
      "mutation": "mutations/catalog-padding-001.patch",
      "baselineHashes": {
        "CatalogApp/CardView.swift": "<sha256>"
      },
      "oracle": {
        "case": "catalog-padding-001",
        "value": "24"
      },
      "smoke": true
    }
  ]
}
```

Required validation:

- globally unique, stable case IDs;
- known enum values;
- mutation file exists;
- all paths remain inside the disposable fixture root;
- baseline hashes match;
- patch applies exactly once;
- expected oracle is present for a physical-device hot case;
- no absolute paths, credentials, device identifiers, or tokens; and
- category totals match the declared corpus metadata.

## Core Corpus v1

Author 240 independent cases:

- 120 expected hot-reload cases;
- 100 expected rebuild cases; and
- 20 authoring-error/recovery cases excluded from the valid-edit denominator.

At least 24 cases are multi-file operations. Mark 24 representative hot cases
as the fast physical-device smoke set. The full device set runs three times in
a deterministic seed-shuffled order.

### Expected hot-reload categories

Include at least ten cases in each of these twelve categories:

1. copy and literal values
2. style modifiers
3. layout modifiers
4. SwiftUI composition and conditionals
5. animation and transition bodies
6. closure and action bodies
7. computed view bodies
8. ordinary helper function bodies
9. async/task bodies
10. nested, private, and extension views
11. generic and actor-isolated implementation bodies
12. multi-file implementation-only edits

Cases are annotated by intended platform capability, not by what the current
regex classifier happens to return.

### Expected rebuild categories

Include:

- stored property add, remove, reorder, type, wrapper, and initializer changes;
- function, initializer, and subscript signature changes;
- type declaration, inheritance, conformance, and generic-constraint changes;
- enum cases and protocol requirements;
- access control, attributes, global/static state, and actor isolation changes;
- imports and macros;
- file add, delete, rename, and mixed hot/structural edits;
- assets, localization, plist, entitlements, and other resources;
- package and build-setting changes; and
- deliberately ambiguous syntax that must fail closed.

Stored-property initializer-only changes deserve explicit cases because they can
look like harmless literal edits while the existing live instance retains old
metadata/state.

### Authoring-error and recovery categories

Include syntax errors, type errors, missing symbols, a disconnected app, a
locked/backgrounded device, and a forced timeout. These cases measure whether
Swift Sim reports failure and selects the signed-build fallback; they do not
lower the valid-edit acceleration denominator.

## Stable Routing Contract Required By The Harness

Before corpus execution, normalize the production router around a typed edit
set. Add an internal API that accepts:

```json
{
  "files": [
    {
      "path": "CatalogApp/CardView.swift",
      "status": "modified",
      "kind": "swift",
      "before": "<path>",
      "after": "<path>"
    }
  ]
}
```

It must represent modified, added, deleted, renamed, Swift, and non-Swift files.
Keep existing repeated `--before` and `--after` flags compatible, but make them
an adapter into this canonical edit-set API.

Normalized output must include:

```json
{
  "schemaVersion": 1,
  "classifierVersion": 1,
  "action": "hot-reload",
  "reasonCode": "IMPLEMENTATION_ONLY",
  "requestId": "<opaque>",
  "files": [],
  "timing": {
    "classificationMs": 0,
    "compileMs": 0,
    "loadAckMs": 0,
    "refreshAckMs": 0,
    "totalMs": 0
  },
  "patches": []
}
```

Reason codes are additive and stable. At minimum implement:

- `NO_CHANGE`
- `IMPLEMENTATION_ONLY`
- `NON_SWIFT_FILE`
- `FILE_ADDED_OR_REMOVED`
- `IMPORT_CHANGED`
- `DECLARATION_CHANGED`
- `STORED_PROPERTY_CHANGED`
- `SIGNATURE_CHANGED`
- `MACRO_OR_EXPLICIT_REPLACEMENT`
- `MIXED_EDIT_SET`
- `LIVE_NOT_READY`
- `PATCH_COMPILE_FAILED`
- `PATCH_LOAD_FAILED`
- `REFRESH_NOT_ACKNOWLEDGED`
- `PATCH_TIMEOUT`

Do not make the benchmark parse human messages.

Instrumentation must use dependency injection around engine control, time, file
operations, and process spawning. Unit tests must not need a real engine,
Tailscale, signing identity, Xcode build, or iPhone.

## Runner Behavior

### Commands

Implement these internal commands:

```sh
npm run benchmark:validate
npm run benchmark:static
npm run benchmark:device -- --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj --scheme CatalogApp
npm run benchmark:report -- --run benchmarks/results/<run-id>
```

Support `--smoke`, `--full`, `--seed`, `--iterations`, `--workload`, `--case`,
`--device`, and `--output`. The default never guesses among multiple physical
devices.

### Static run

For every case:

1. validate baseline hashes;
2. create before/after material in a temporary directory;
3. invoke the canonical production classifier;
4. compare lane and reason code;
5. append one result to JSONL; and
6. stop immediately on a dangerous false-live result.

Run the complete static corpus three times and assert byte-identical normalized
classification results.

### Device run

For each workload:

1. copy the pristine fixture into a disposable run directory;
2. run doctor and record sanitized versions/readiness;
3. select exactly one trusted physical device;
4. start the engine;
5. perform one clean live-enabled Debug device build;
6. install and launch the fixture under console capture;
7. wait for baseline readiness, compiler capture, and the baseline marker;
8. execute the seeded case order;
9. append each attempt to JSONL immediately;
10. restore and verify baseline after each hot attempt;
11. rebuild the workload after contamination; and
12. generate `summary.json` and `report.md`.

The runner must be resumable after interruption. A resumed run skips completed
attempt IDs but first rebuilds and verifies the workload baseline. It never
assumes the prior phone process is still clean.

### Structural and fallback cases

All structural cases run through static classification. A small representative
fallback subset also runs while the device lane is ready to prove the router
still returns `build-device` instead of injecting.

Do not build and install one IPA per structural case. Measure device-build
latency separately with one clean build and one incremental build per workload.
Mixing multi-minute Xcode builds into patch percentiles would make both numbers
meaningless.

### Multi-file cases

Record each file's compile/apply outcome and revision. If one patch applies and
a later patch fails, emit `partialApplication: true`, contaminate the workload,
and rebuild baseline. The benchmark must expose this even if the user-facing
agent immediately falls back to a new app build.

The product follow-up should compile every member of a multi-file operation
before loading any of them. Atomic runtime replacement can be evaluated
separately; the benchmark must not pretend current sequential loading is atomic.

## Attempt Record

Write append-only JSONL so a crash cannot erase completed evidence:

```json
{
  "schemaVersion": 1,
  "runId": "<uuid>",
  "attemptId": "catalog-padding-001:2",
  "caseId": "catalog-padding-001",
  "iteration": 2,
  "expectedLane": "hot-reload",
  "predictedLane": "hot-reload",
  "reasonCode": "IMPLEMENTATION_ONLY",
  "terminalState": "semantically-observed",
  "requestId": "<opaque>",
  "priorRevision": 41,
  "revision": 42,
  "applied": true,
  "dynamicReplacements": 1,
  "refreshAcknowledged": true,
  "oracleMatched": true,
  "partialApplication": false,
  "fallbackRequired": false,
  "timing": {
    "classificationMs": 3.2,
    "compileMs": 302.1,
    "loadAckMs": 115.4,
    "refreshAckMs": 94.3,
    "oracleMs": 26.0,
    "totalMs": 541.0
  },
  "errorCode": null
}
```

Raw engine errors may be saved locally in a separate diagnostic file. The
exported attempt record contains a sanitized error code and at most a
path-redacted final compiler diagnostic.

## Report

Generate machine-readable `summary.json` and human-readable `report.md` from
raw JSONL. Never calculate headline values during execution; the report
generator is the single source of statistical truth.

The Markdown report includes:

- exact scoped claim at the top;
- git, corpus, Swift Sim, engine, Xcode, macOS, and iOS versions;
- sanitized device model and connection mode;
- classifier confusion matrix and reason distribution;
- device success/failure counts;
- latency percentiles and sample counts;
- per-category and per-workload tables;
- restore, timeout, partial-application, and fallback counts;
- excluded-case counts with reasons;
- seed and iteration count; and
- a limitations section stating whether the corpus was curated or
  chronological.

Percentiles use nearest-rank over raw observations. Proportions include Wilson
95% intervals. Unit-test both against fixed known datasets.

## Chronological Real-App Corpus

This is a later, hands-on phase and must not block implementation of the core
benchmark.

For Zenics and subsequent apps:

1. define a start timestamp before editing begins;
2. capture every routed edit in order;
3. record hashes and outcome metadata locally, not source;
4. label compile errors separately from valid edits;
5. use normal Swift Sim runtime acknowledgements for every attempted hot edit;
6. have the developer mark visible semantic correctness while dogfooding;
7. never delete an inconvenient valid result; and
8. close the corpus at a predeclared edit count or date.

Because git commits combine multiple saves and do not represent the hot-reload
unit, do not use historical commit hunks as a substitute for chronological edit
capture.

The first Zenics result should be presented as "in this Zenics dogfood run,"
not as a universal SwiftUI percentage.

## Implementation Sequence For The Coding Model

The implementation model should follow this order and stop at each gate when
tests fail. It should not redesign the architecture while coding.

### Phase 1: contracts and pure tooling

1. Add schemas, corpus loader, validators, sanitizer, statistics, and report
   generator.
2. Refactor routing into the canonical typed edit-set API with stable reason
   codes and injected dependencies.
3. Preserve all existing CLI behavior.
4. Add unit tests for every reason code, metric, sanitizer rule, and schema
   failure.

Gate:

```sh
npm run check
swift test
```

All existing tests plus new pure tests pass. No fixture app or device is
required.

### Phase 2: static core corpus

1. Create the 240-case manifest and mutations.
2. Implement disposable materialization.
3. Implement static execution and deterministic JSONL.
4. Run the corpus three times.

Gate:

- zero dangerous false-live results;
- identical normalized results on all three runs;
- every case and category count validates; and
- no paths or secrets appear in an exported sample.

Classifier misses are recorded, not papered over by changing expected labels.

### Phase 3: fixture apps and oracle probe

1. Add the three fixture targets.
2. Add the console marker and baseline marker.
3. Build all targets for an unsigned Simulator as compile validation.
4. Prove one physical-device patch and restore through console observation.

Gate:

- baseline, changed, and restored markers are observed in order;
- the change has a correlated request and increasing revision;
- no screenshot is used; and
- a stale marker cannot satisfy the wait.

### Phase 4: physical-device runner

1. Implement session setup, device selection, launch/console capture, retry
   boundaries, JSONL persistence, restore, contamination recovery, and resume.
2. Run the 24-case smoke set once.
3. Run the 120 hot cases for three seeded iterations.
4. Generate and inspect the report.

Gate:

- no false success;
- all failures have stable terminal/error states;
- headline percentiles use only semantically observed valid attempts;
- contamination triggers a rebuild before continuation; and
- the report is reproducible from raw JSONL alone.

### Phase 5: release integration

1. Add `benchmark:validate`, `benchmark:static`, `benchmark:device`, and
   `benchmark:report` npm scripts.
2. Run validation and the static corpus in CI.
3. Keep physical-device runs manual and required for releases that change the
   classifier, live client, engine pin, signing, compiler capture, or routing.
4. Add the latest scoped benchmark report to release artifacts, not to source
   control unless intentionally selected as a published baseline.
5. Update the changelog, architecture, contributor docs, and agent skill after
   behavior is proven.

### Phase 6: real-app dogfood

Run the chronological capture protocol on Zenics, then two other real apps.
Only after the publication threshold is met should marketing copy use a broad
workflow percentage.

## Tests The Implementation Must Include

At minimum:

- schema rejects traversal, absolute paths, duplicate IDs, missing oracle, and
  invalid enums;
- static classifier detects stored-property initializer changes;
- non-Swift, add/delete/rename, and mixed edit sets rebuild;
- comments and strings containing declaration words do not change routing;
- reason codes remain stable while messages may change;
- monotonic phase timings sum consistently;
- stale or wrong case markers are rejected;
- delayed correct marker passes;
- timeout produces fallback-required and never success;
- revision must increase;
- zero dynamic replacements fails a SwiftUI body case;
- semantic value mismatch fails an ordinary function case;
- multi-file partial application contaminates the workload;
- restore failure forces rebuild;
- resume never trusts old runtime state;
- percentile and Wilson interval calculations match fixtures;
- report generation is deterministic;
- sanitizer removes home paths, project paths, team IDs, UDIDs, tokens, and
  Tailnet hostnames; and
- exported reports contain no source or patch content.

## CI And Release Policy

CI runs:

- all normal Node and Swift tests;
- corpus/schema validation;
- the complete static classifier benchmark; and
- unsigned Simulator builds for all three fixture targets.

CI does not claim device success from Simulator results.

A physical-device benchmark is required before releasing changes to:

- declaration classification;
- generated replacement source;
- compiler-command capture;
- engine communication or report parsing;
- `SwiftSimLive` refresh behavior;
- multi-file routing;
- live signing; or
- the pinned engine/client revision.

Store the raw local run long enough to reproduce the release report. Publish
only sanitized summary artifacts.

## Definition Of Done

The benchmark implementation is complete when:

- the 240-case corpus validates and runs deterministically;
- static safety has zero dangerous false-live results;
- three fixture apps build and run on a physical iPhone;
- the semantic oracle proves changed code execution without screenshots;
- the smoke and full device modes are resumable and produce raw JSONL;
- restoration and contamination handling are proven;
- reports regenerate deterministically with correct statistics;
- CI covers the static and Simulator-safe portions;
- a full physical-device report is attached to the development milestone; and
- documentation clearly prevents a curated score from becoming a universal
  marketing claim.

## Phase 1 Physical Smoke Evidence

The final physical-device smoke gate on July 30, 2026 exercised the generated
fixtures through the same private remote live-edit route used by Swift Sim:

| Workload | Confirmed edits | Confirmed restores | Fallbacks | Timeouts | p50 | p95 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CatalogApp | 10/10 | 10/10 | 0 | 0 | 713 ms | 817 ms |
| StateApp | 8/8 | 8/8 | 0 | 0 | 630 ms | 728 ms |
| ArchitectureApp | 6/6 | 6/6 | 0 | 0 | 905 ms | 1,285 ms |
| Total | 24/24 | 24/24 | 0 | 0 | — | — |

The semantic oracle confirmed revision, refresh, case identity, and expected
value markers; screenshots were not used as proof. The State workload includes
closures, computed views, helper functions, and async tasks. Architecture
includes nested/extension views, actor-isolated generic bodies, and a reachable
multi-file implementation.

Async implementation changes use the existing interposition lane because Swift
does not emit a usable dynamic-replacement symbol for these functions in this
toolchain. The runner also performs a no-build relaunch when an interposition
edit drops the app socket, then verifies the restored baseline before
continuing.

This is curated fixture evidence for the supported edit lanes. It is not a
claim that all Swift edits—or a fixed percentage of arbitrary real-app
workflows—can hot reload. The broader workflow percentage remains gated on the
chronological real-app dogfood protocol in Phase 6.

### Supplemental Liquid Glass corpus

The fixed 240-case core corpus remains unchanged. A separate
`liquid-glass-1` capability corpus covers the current SwiftUI Liquid Glass API
surface and closely related toolbar, scroll-edge, safe-area, tab, search, and
control APIs. It contains 27 hot-edit cases and seven structural rebuild
controls. See [Liquid Glass Hot Reload Coverage](LIQUID_GLASS_HOT_RELOAD.md)
for the matrix, availability requirements, and independently stated proof
levels.

## Explicitly Deferred

- Public hosted benchmark infrastructure
- Automatic telemetry from user projects
- TestFlight or App Store hot reload
- Screenshot or computer-vision correctness scoring
- A public stable `swift-sim benchmark` CLI
- A universal coverage percentage before chronological real-app evidence
