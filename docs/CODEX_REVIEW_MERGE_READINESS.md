# Codex review merge-readiness fix

Base hardening head: `0085d86398730dade77f42682d964841a380588a`

Fixed the final unresolved Codex finding from staging PR #18 before merging the hardening work with local `main`.

## Finding fixed

One-shot helper commands installed service-only graceful-shutdown listeners. A Ctrl-C or SIGTERM could therefore suppress normal signal termination and allow a command to continue mutating resources for up to the helper shutdown deadline.

## Resolution

- The hard shutdown deadline is installed only when the helper command is `serve`.
- The renewal shutdown guard is likewise limited to the serving helper.
- Packaged and raw helper entry paths share the same command classification.
- One-shot commands retain Node's default SIGTERM behavior.
- The serving helper retains its bounded graceful-shutdown behavior.

## Validation

The staging workflow validates the full JavaScript suite, workflow and release checks, and iOS companion simulator tests on the exact fixed source. No additional review round is included in this staging change.
