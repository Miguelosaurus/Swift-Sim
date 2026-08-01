const DEFAULT_HELPER_SHUTDOWN_DEADLINE_MS = 20_000;
let installed = false;

export function installHelperShutdownDeadline({
  deadlineMs = configuredDeadline(),
  exit = process.exit.bind(process),
} = {}) {
  if (installed) return;
  installed = true;

  const hardDeadlineMs = positiveMilliseconds(deadlineMs, DEFAULT_HELPER_SHUTDOWN_DEADLINE_MS);
  let shutdownDeadlineAt = 0;
  let hardExitTimer = null;
  let requestedFailureCode = 1;

  const beginShutdown = () => {
    if (shutdownDeadlineAt) return;
    shutdownDeadlineAt = Date.now() + hardDeadlineMs;
    hardExitTimer = setTimeout(() => exit(requestedFailureCode), hardDeadlineMs);
  };

  process.prependListener("SIGTERM", beginShutdown);
  process.prependListener("SIGINT", beginShutdown);

  process.exit = function guardedHelperExit(code = process.exitCode ?? 0) {
    const exitCode = normalizedExitCode(code);
    if (!shutdownDeadlineAt || exitCode === 0 || Date.now() >= shutdownDeadlineAt) {
      if (hardExitTimer) clearTimeout(hardExitTimer);
      return exit(exitCode);
    }
    requestedFailureCode = exitCode || 1;
    process.exitCode = requestedFailureCode;
    return undefined;
  };
}

installHelperShutdownDeadline();

function configuredDeadline() {
  return positiveMilliseconds(
    process.env.SWIFT_SIM_HELPER_SHUTDOWN_DEADLINE_MS,
    DEFAULT_HELPER_SHUTDOWN_DEADLINE_MS,
  );
}

function positiveMilliseconds(value, fallback) {
  const milliseconds = Number(value);
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? Math.floor(milliseconds)
    : fallback;
}

function normalizedExitCode(value) {
  const code = Number(value);
  return Number.isInteger(code) && code >= 0 ? code : 1;
}
