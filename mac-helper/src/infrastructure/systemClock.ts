import { setTimeout as delay } from "node:timers/promises";
import type { Clock } from "./ports.js";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  monotonicMilliseconds(): number {
    return performance.now();
  }

  async sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("Clock sleep duration must be a finite non-negative number.");
    }
    await delay(milliseconds, undefined, signal ? { signal } : undefined);
  }
}
