# Main post-merge review — round 1

Base main head: `c7090b14c6f1fd12af9c311b1954b79b00c415ac`

This staging branch reviews the fully synchronized merge of the previous local main work with hardening head `5afa7728bb22d3ff6e54512615d988a9c7a85240`.

Review scope:

- merge-integration regressions between the benchmark/native-surface work and hardened helper/runtime paths;
- command, process, lock, shutdown, delivery, pairing, build, and Simulator lifecycle boundaries;
- false-live classification and stale process/session recovery;
- release, packaging, benchmark, and test coverage gaps introduced by the combined tree;
- the bounded delivery-reference startup cleanup residual.

## Active findings

- Live-engine process identity and detached process-group ownership.
- Cross-process serialization of global live-engine inspection and replacement.
- Structural Swift attribute arguments, including deeply nested and multiline wrappers, availability conditions, and conditional compilation misclassified as live-safe.
- Workspace project discovery, scheme authority, signing selection, and watcher-root resolution.
- Delivery-reference cleanup blocking helper startup.
- Persisted artifact cleanup path and build-ID containment.
- Forwarded pairing-origin trust.
- Paired-Mac rebuild authority and stale response fencing.
- Simulator, pairing-attempt, and connection-diagnostic stale response fencing.

The earlier self-removing transformations passed the complete Node/release check before committing. The final workspace/diagnostics/classifier transformation is fail-closed, self-removing, and adds pure scheme/reference tests, balanced-attribute regressions, and an iOS stale-view regression. This is an idempotent trigger after workflow registration.
