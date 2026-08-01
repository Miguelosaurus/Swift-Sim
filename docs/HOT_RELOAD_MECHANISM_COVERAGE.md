# Swift Hot-Reload Mechanism Coverage

Swift Sim's mechanism corpus is a small capability test for the generated
replacement source, not a frequency estimate for Swift development. It answers
whether the live lane can safely replace several Swift declaration shapes that
are common outside a simple `View.body` literal.

## Covered forms

`mechanisms-2` contains 17 cases in one disposable `MechanismApp` fixture:

| Form | Hot cases | Expected lane |
| --- | ---: | --- |
| Protocol default implementation | 1 | hot reload |
| Actor static implementation | 1 | hot reload |
| View body defined in an extension | 1 | hot reload |
| `ViewModifier.body(content:)` | 1 | hot reload |
| Observation computed property | 1 | hot reload |
| Explicit accessor getter/setter | 1 | hot reload |
| Property-wrapper computed getter | 1 | hot reload |
| Initializer body used by a SwiftUI body | 1 | hot reload* |
| Subscript body used by a SwiftUI body | 1 | hot reload* |
| Generic helper function | 1 | hot reload |
| Parameterized/static helper function | 1 | hot reload |
| Parameterized async/throws helper | 1 | hot reload (interposition) |
| UIKit bridge configuration function | 1 | hot reload |
| `UIViewRepresentable.updateUIView` | 1 | hot reload |
| Stored property, signature, and import controls | 0 | build-device (3 controls) |

`*` These two cases do not claim that the initializer or subscript metadata is
replaced in place. Their simple literal result is folded into the containing
SwiftUI body replacement; a general initializer/subscript edit that cannot be
folded safely falls back to a signed build.

Every hot case emits a case/value marker from the changed implementation. The
device oracle requires the new value, a correlated request, a successful live
replacement, an acknowledged root refresh, and an increasing revision before
counting a pass. Each case then restores the baseline through the live lane.

The generated replacement parser supports parameter labels, generic and
static members, explicit accessors, computed properties, actor members,
initializers, subscripts, extension-defined view bodies, and
`ViewModifier`/`UIViewRepresentable` callbacks. SwiftUI bodies can also fold a
simple literal result from a changed initializer or subscript call into the
body replacement; this is deliberately narrow because Swift's runtime does
not expose every initializer/subscript as a dynamic-replacement target. Async
and throwing functions use InjectionNext interposition, so a successful report
may have zero dynamic replacements while still carrying an applied revision.
None of this adds a second runtime or requires Swift Sim code in every source
line.

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
| Cases per pass | 17 |
| Hot decisions | 14/14 |
| Build decisions | 3/3 |
| Dangerous false-live decisions | 0 |
| Deterministic | yes |

### Physical iPhone gate

The signed Debug fixture was installed once and exercised over the private
Tailnet live path. No IPA was built or installed for an individual edit.

| Metric | Result |
| --- | ---: |
| Hot edits semantically observed | 14/14 |
| Baseline restores | 14/14 |
| Final fallbacks | 0 |
| Unrecovered failures | 0 |
| Partial applications | 0 |
| Median edit latency | 665.0 ms |
| P90 edit latency | 1,249.9 ms |
| P95 edit latency | 1,712.5 ms |
| Diagnostic transport timeouts | 2 |
| Recovered diagnostic attempts | 2/2 |

Two initial patch timeouts were preserved as diagnostic records. The runner
closed the stale session, rebuilt/relaunched a clean disposable Debug fixture,
and retried each affected case once; both recovery attempts passed. The
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

Implementation-only multi-file edits are compiled into one signed dynamic
replacement bundle and sent through one engine request. A successful route
reports `atomic: true` plus `patchBundle.sourceCount` and
`patchBundle.sourcePaths`; no member can be loaded before the bundle is ready.
When an edit requires async/interposition, Swift Sim keeps the sequential
preflighted fallback and reports `atomic: false`; a later load failure sets
`partialApplication: true`. The benchmark then contaminates the workload,
records the failure, and re-establishes a clean live session. A bounded
production transport recovery may restart the live engine and retry once, but
compile failures and partial applications are never retried automatically.

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
