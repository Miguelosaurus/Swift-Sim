# Confirmation round 5

Base head: `8753a94551fc8e87c6f791b8be98fa37b0f97bf3`

This staging round targets `agent/open-source-launch-hardening-round-1`, not `main`.

## Review focus

- helper shutdown hard deadlines and descendant cleanup;
- Homebrew upgrade/service overlap and old/new helper reconciliation;
- cross-process lifecycle lock recovery, PID reuse, and ownerless-lock grace;
- SessionStore save failures around start/restart/stop publication;
- delivery-manager child identity and cleanup crash windows;
- capability-reference cleanup and renewal crash windows;
- native/serve-sim fallback after terminal and malformed state;
- whole-operation deadlines for external commands.

Findings, fixes, and exact-head validation will be recorded as the round progresses. Hot reload remains out of scope.
