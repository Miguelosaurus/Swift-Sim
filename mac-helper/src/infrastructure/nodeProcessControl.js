// @ts-check

const POLL_INTERVAL_MS = 25;
const FORCE_KILL_WAIT_MS = 2_000;

/**
 * Terminate a process that was spawned by the current operation. This helper
 * is intentionally not an authorization boundary for persisted identities;
 * ProcessSupervisor must revalidate those identities before every signal.
 *
 * @param {number} pid
 * @param {boolean} terminateGroup
 * @param {number} graceMs
 */
export async function terminateOwnedProcess(pid, terminateGroup, graceMs) {
  signalOwnedProcess(pid, terminateGroup, "SIGTERM");
  if (await waitForOwnedProcessExit(pid, terminateGroup, graceMs)) return true;
  signalOwnedProcess(pid, terminateGroup, "SIGKILL");
  return waitForOwnedProcessExit(pid, terminateGroup, FORCE_KILL_WAIT_MS);
}

/** @param {number} pid @param {boolean} terminateGroup @param {number} graceMs */
export function terminateOwnedProcessSync(pid, terminateGroup, graceMs) {
  signalOwnedProcess(pid, terminateGroup, "SIGTERM");
  if (waitForOwnedProcessExitSync(pid, terminateGroup, graceMs)) return true;
  signalOwnedProcess(pid, terminateGroup, "SIGKILL");
  return waitForOwnedProcessExitSync(pid, terminateGroup, FORCE_KILL_WAIT_MS);
}

/** @param {number} pid @param {boolean} terminateGroup @param {number} timeoutMs */
export async function waitForOwnedProcessExit(pid, terminateGroup, timeoutMs) {
  const deadline = Date.now() + normalizeDuration(timeoutMs);
  while (ownedProcessIsAlive(pid, terminateGroup) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return !ownedProcessIsAlive(pid, terminateGroup);
}

/** @param {number} pid @param {boolean} terminateGroup @param {number} timeoutMs */
export function waitForOwnedProcessExitSync(pid, terminateGroup, timeoutMs) {
  const deadline = Date.now() + normalizeDuration(timeoutMs);
  while (ownedProcessIsAlive(pid, terminateGroup) && Date.now() < deadline) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, POLL_INTERVAL_MS);
  }
  return !ownedProcessIsAlive(pid, terminateGroup);
}

/** @param {number} pid @param {boolean} terminateGroup */
export function ownedProcessIsAlive(pid, terminateGroup) {
  const normalizedPID = normalizePID(pid);
  try {
    process.kill(terminateGroup ? -normalizedPID : normalizedPID, 0);
    return true;
  } catch {
    return false;
  }
}

/** @param {number} pid @param {boolean} terminateGroup @param {"SIGTERM" | "SIGKILL"} signal */
function signalOwnedProcess(pid, terminateGroup, signal) {
  const normalizedPID = normalizePID(pid);
  try {
    process.kill(terminateGroup ? -normalizedPID : normalizedPID, signal);
  } catch {
    if (!terminateGroup) return;
    try {
      process.kill(normalizedPID, signal);
    } catch {}
  }
}

/** @param {number} value */
function normalizePID(value) {
  if (!Number.isInteger(value) || value <= 1) {
    throw new RangeError("Owned process PID must be an integer greater than one.");
  }
  return value;
}

/** @param {number} value */
function normalizeDuration(value) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("Process wait duration must be a finite non-negative number.");
  }
  return value;
}
