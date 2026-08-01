# Confirmation round 5

Base head: `8753a94551fc8e87c6f791b8be98fa37b0f97bf3`

This staging round targets `agent/open-source-launch-hardening-round-1`, not `main`.

## Final severity

| Priority | Found | Fixed |
|---|---:|---:|
| P0 | 0 | 0 |
| P1 | 8 | 8 |
| P2 | 3 | 3 |
| P3 | 1 | 0 |

## P1 fixes

1. The helper's eight-second forced failure exit could preempt its own ten-second-plus `serve-sim` cleanup during shutdown or upgrade.
2. Stale-lock reclamation recursively deleted the live lock pathname after proving it stale, so a competing process could create a replacement lock that the first process then deleted.
3. The raw delivery manager did not install the atomic lock-quarantine guard and retained that replacement-owner race for generation-state locks.
4. `execFileSync` operations such as `xcrun simctl` and `plutil` had no deadline and could block the helper event loop and normal shutdown indefinitely.
5. Timed synchronous commands could kill only their leader and leave descendants running after the CLI returned failure.
6. An owned but HTTP-unresponsive helper was recorded as stopped before update, causing setup to request `brew services start` instead of replacing the old binary with `restart`.
7. Isolating inherited-stdio synchronous commands into detached process groups prevented terminal Ctrl-C from reaching forwarded builds and helper commands.
8. A delayed Tailscale process-group KILL could target a recycled numeric PGID after the original group exited.

## P2 fixes

1. Homebrew update/service operations, plugin probes, helper invocations, and other synchronous external commands lacked hard parent deadlines.
2. Unclassified synchronous commands had no fallback deadline, including production `cloudflared` and helper-script cases.
3. Timed-out Tailscale status probes returned after signaling only the leader and could leave descendants alive.

## Architecture and behavior

- Synchronous `spawnSync` and `execFileSync` calls receive command-specific deadlines, a bounded fallback, and process-group cleanup for noninteractive operations.
- Foreground helper commands using inherited stdio remain in the terminal process group so Ctrl-C is delivered directly.
- The long-running helper service is intentionally exempt; device builds retain a one-hour budget.
- Tailscale status probes are isolated and hard-killed as a complete group immediately on timeout, with no delayed PGID-reuse window.
- Recursive lock removal is authorized by the ownership guard, atomically renamed to a unique quarantine path, and only then deleted.
- The quarantine guard is installed in packaged and raw CLI, helper, gateway, and delivery-manager entry paths.
- Helper shutdown receives a true twenty-second hard window; an earlier failure exit request cannot truncate successful cleanup.
- Upgrade preparation recognizes an owned listener even when health requests hang, and the new installation restarts rather than starts the existing Homebrew service.

## Bounded residual

Delivery-reference cleanup remains durable and retried, but helper startup currently drains queued reference-cleanup jobs sequentially before listening. A contended delivery lifecycle lock can therefore delay startup, with the existing lock timeout bounding each individual attempt. Restructuring the monolithic helper startup path safely was not performed in this connector-only round.

## Validation

The final exact staging head and GitHub Actions run are recorded in PR #18 after completion. Required gates are:

- complete JavaScript syntax and Node test suite;
- workflow YAML validation;
- release shell-script syntax validation;
- iOS companion simulator tests;
- all automated review threads resolved.

Hot reload remains out of scope.
