# Swift Hot-Reload Mechanism Coverage

Swift Sim's mechanism corpus is a small capability test for the generated
replacement source, not a frequency estimate for Swift development. It answers
whether the live lane can safely replace several Swift declaration shapes that
are common outside a simple `View.body` literal.

## Covered forms

`mechanisms-1` contains 12 cases in one disposable `MechanismApp` fixture:

| Form | Hot cases | Expected lane |
| --- | ---: | --- |
| Protocol default implementation | 1 | hot reload |
| Actor static implementation | 1 | hot reload |
| View body defined in an extension | 1 | hot reload |
| `ViewModifier.body(content:)` | 1 | hot reload |
| Observation computed property | 1 | hot reload |
| Property-wrapper computed getter | 1 | hot reload |
| Parameterized/static helper function | 1 | hot reload |
| UIKit bridge configuration function | 1 | hot reload |
| `UIViewRepresentable.updateUIView` | 1 | hot reload |
| Stored property, signature, and import controls | 0 | build-device (3 controls) |

Every hot case emits a case/value marker from the changed implementation. The
device oracle requires the new value, a correlated request, a successful live
replacement, an acknowledged root refresh, and an increasing revision before
counting a pass. Each case then restores the baseline through the live lane.

The generated replacement parser supports parameter labels, static members,
computed properties, actor members, extension-defined view bodies, and
`ViewModifier`/`UIViewRepresentable` callbacks. This is still compiler-shaped
dynamic replacement; it does not add a second runtime or require Swift Sim
code in every source line.

## Evidence (August 1, 2026)

### Static gate

```sh
npm run benchmark:generate:mechanisms
npm run benchmark:validate:mechanisms
npm run benchmark:static:mechanisms -- --repeat 3
```

The three repeated static passes produced identical normalized results:

| Metric | Result |
| --- | ---: |
| Cases per pass | 12 |
| Hot decisions | 9/9 |
| Build decisions | 3/3 |
| Dangerous false-live decisions | 0 |
| Deterministic | yes |

### Physical iPhone gate

The signed Debug fixture was installed once and exercised over the private
Tailnet live path. No IPA was built or installed for an individual edit.

| Metric | Result |
| --- | ---: |
| Hot edits semantically observed | 9/9 |
| Baseline restores | 9/9 |
| Final fallbacks | 0 |
| Unrecovered failures | 0 |
| Partial applications | 0 |
| Median edit latency | 753.9 ms |
| P90/P95 edit latency | 1,112.7 ms |
| Diagnostic transport timeouts | 3 |
| Recovered diagnostic attempts | 3/3 |

Three initial patch timeouts were preserved as diagnostic records. The runner
closed the stale session, rebuilt/relaunched a clean disposable Debug fixture,
and retried each affected case once; all three recovery attempts passed. The
headline reliability and latency denominators exclude those diagnostic
records, while the recovery counts remain visible in the report.

Run the physical lane with an explicitly trusted device and the team selected
at run time:

```sh
npm run benchmark:device -- \
  --corpus benchmarks/corpora/mechanisms/corpus.json \
  --project benchmarks/fixtures/MechanismBenchmarks.xcodeproj \
  --scheme MechanismApp \
  --device "<trusted-device-name>" \
  --build-setting DEVELOPMENT_TEAM=<your-team-id> \
  --lane hot-reload --iterations 1
```

## Boundaries and recovery

The three controls are intentionally rebuild cases. Adding or changing stored
state, changing a function/member signature, or changing imports/module inputs
requires a fresh signed build. The classifier must fail closed for those edits.

Multi-file live operations are preflight-compiled as a set before any patch is
loaded. Runtime loading is still sequential, so the route reports
`partialApplication` if a later load fails; the benchmark then contaminates the
workload, records the failure, and re-establishes a clean live session. The
`atomic` field means preflight passed, not that a device can roll back an
already-loaded dylib transaction.

The fixture invokes both `makeUIView` and `updateUIView`; the physical hot
mutations target `updateUIView` and the static display helper, while the
generated parser also recognizes `makeUIView(context:)`. Already-created UIKit
hierarchies or system effects that do not re-run a changed callback are outside
this corpus and need a separate refresh proof.

These results are scoped to the committed fixture, device/OS, Xcode toolchain,
Swift Sim live engine, and one warm run. They demonstrate mechanism coverage;
they do not justify an everyday-edit or universal Swift percentage. The
chronological real-app workflow corpus remains the evidence required for that
claim.
