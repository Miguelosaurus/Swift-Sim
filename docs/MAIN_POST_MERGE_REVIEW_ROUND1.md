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
- Structural Swift attribute arguments, wrapper association, availability conditions, and conditional compilation misclassified as live-safe.
- Workspace signing container selection.
- Delivery-reference cleanup blocking helper startup.
- Persisted artifact cleanup path and build-ID containment.
- Forwarded pairing-origin trust.
- Paired-Mac rebuild authority and stale response fencing.
- Simulator, pairing-attempt, and connection-diagnostic stale response fencing.

The first self-removing transformation passed the complete Node/release check before committing. The narrowed follow-up transformation now targets only the live-start inspection block and remains fail-closed with branch-visible diagnostics.
