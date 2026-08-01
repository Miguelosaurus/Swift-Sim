# Core Hot Reload Physical Results

This is the scoped physical-device evidence for the core benchmark corpus. The
results are fixture evidence, not an everyday SwiftUI coverage percentage.

## Independent workload lanes (August 1, 2026)

Each workload was run from a signed Debug install with lane filtering set to
implementation-only hot cases. Every passing edit emitted its case marker and
was followed by a baseline restore.

| Workload | Distinct hot cases | Observed | Restores | Edit p50 | Edit p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| CatalogApp | 50 | 50/50 | 50/50 | 723.3 ms | 930.8 ms |
| StateApp | 40 | 40/40 | 40/40 | 637.8 ms | 906.6 ms |
| ArchitectureApp | 30 | 30/30 | 30/30 | 920.6 ms* | 1,523.6 ms* |

The Architecture cases were all semantically observed in clean sessions. A
single long batch run also recorded three transport/session failures (including
one partial multi-file restore); those records remain in the local diagnostic
output and were not counted as successes. The affected cases were rebuilt to a
fresh disposable baseline and rerun individually before being included in the
30-case distinct coverage set.

Across the three workloads, 120 distinct implementation-only cases were
observed on the physical fixture. This proves the core categories represented
by the corpus; it does not prove that 120/120 arbitrary edits in a user's app
will reload.

## Commands

Run each scheme independently to keep a transport restart from contaminating a
following workload:

~~~sh
npm run benchmark:device -- \
  --corpus benchmarks/corpora/core/corpus.json \
  --project benchmarks/fixtures/HotReloadBenchmarks.xcodeproj \
  --scheme CatalogApp \
  --device "<trusted-device-name>" \
  --build-setting DEVELOPMENT_TEAM=<your-team-id> \
  --lane hot-reload --iterations 1
~~~

Repeat with StateApp and ArchitectureApp. Preserve JSONL output from every run;
never delete a failed valid attempt when publishing a broader reliability
claim.

\* Architecture p50/p95 are calculated over one semantically observed record
per distinct case, combining the clean batch records with the seven focused
recovery runs.
