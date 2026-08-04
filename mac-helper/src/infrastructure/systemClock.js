// @ts-check
import { setTimeout as delay } from "node:timers/promises";

/** @implements {import("./ports.js").Clock} */
export class SystemClock {
  /** @returns {Date} */
  now() {
    return new Date();
  }

  /** @returns {number} */
  monotonicMilliseconds() {
    return performance.now();
  }

  /**
   * @param {number} milliseconds
   * @param {AbortSignal} [signal]
   * @returns {Promise<void>}
   */
  async sleep(milliseconds, signal) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("Clock sleep duration must be a finite non-negative number.");
    }
    await delay(milliseconds, undefined, signal ? { signal } : undefined);
  }
}
