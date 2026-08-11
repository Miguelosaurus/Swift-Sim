// @ts-check

/**
 * @typedef {(command: string, args: string[], options: { encoding: string }) => unknown} SpawnSyncLike
 * @typedef {{ startToken: string } | null} ProcessStartIdentity
 */

/**
 * Create the exact process-start identity provider needed to interoperate with
 * the legacy device-build lock. DeviceBuildStore persisted the trimmed Darwin
 * `ps -o lstart=` output in `startedAt`; NodeLockManager already accepts that
 * legacy field as its owner start token.
 *
 * This adapter intentionally receives spawnSync rather than importing
 * node:child_process so Phase 4 does not create another direct process owner.
 *
 * @param {{ spawnSync: SpawnSyncLike }} options
 * @returns {(pid: number) => ProcessStartIdentity}
 */
export function createDarwinLegacyProcessIdentity({ spawnSync }) {
  if (typeof spawnSync !== "function") {
    throw new TypeError("Darwin legacy process identity requires spawnSync.");
  }

  return (pid) => {
    if (!Number.isSafeInteger(pid) || pid <= 1) return null;

    let result;
    try {
      result = spawnSync("/bin/ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
      });
    } catch {
      return null;
    }
    if (!result || typeof result !== "object" || Array.isArray(result)) return null;
    const values = /** @type {Record<string, unknown>} */ (result);
    if (values.status !== 0) return null;
    const startToken = String(values.stdout || "").trim();
    return startToken ? { startToken } : null;
  };
}
