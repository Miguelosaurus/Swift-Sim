// @ts-check

/**
 * @typedef {{
 *   headersSent?: boolean,
 *   writeHead(status: number, headers: Record<string, string>): unknown,
 *   end(body?: string): unknown,
 *   destroy(error?: Error): unknown,
 * }} HelperResponseLike
 * @typedef {(request: unknown, response: HelperResponseLike) => unknown} RequestListener
 * @typedef {Record<string, unknown> | RequestListener | undefined} CreateServerInput
 * @typedef {(optionsOrListener?: CreateServerInput, listener?: RequestListener) => unknown} CreateServerLike
 * @typedef {{ unref?(): unknown }} IntervalHandle
 * @typedef {(callback: () => void, intervalMs: number) => IntervalHandle} ScheduleInterval
 */

/**
 * Own the compatibility HTTP server wrapper and its maintenance scheduler.
 * Route authorization, response projection, persistence, concrete service
 * construction, and built-in replacement authority remain injected.
 */
export class HelperHttpBoundaryRuntime {
  /** @type {CreateServerLike} */
  #originalCreateServer;
  /** @type {(createServer: CreateServerLike) => void} */
  #replaceCreateServer;
  /** @type {() => void} */
  #syncBuiltinExports;
  /** @type {(request: unknown, response: HelperResponseLike) => boolean} */
  #dispatchRequest;
  /** @type {(response: HelperResponseLike) => void} */
  #writeUnavailable;
  /** @type {(error: unknown) => void} */
  #reportError;
  /** @type {() => Promise<unknown>} */
  #runMaintenance;
  /** @type {ScheduleInterval} */
  #scheduleInterval;
  /** @type {number} */
  #maintenanceIntervalMs;
  /** @type {IntervalHandle | undefined} */
  #maintenanceTimer;
  #installed = false;

  /**
   * @param {{
   *   originalCreateServer: CreateServerLike,
   *   replaceCreateServer(createServer: CreateServerLike): void,
   *   syncBuiltinExports(): void,
   *   dispatchRequest(request: unknown, response: HelperResponseLike): boolean,
   *   writeUnavailable(response: HelperResponseLike): void,
   *   reportError(error: unknown): void,
   *   runMaintenance(): Promise<unknown>,
   *   scheduleInterval: ScheduleInterval,
   *   maintenanceIntervalMs: number,
   * }} options
   */
  constructor({
    originalCreateServer,
    replaceCreateServer,
    syncBuiltinExports,
    dispatchRequest,
    writeUnavailable,
    reportError,
    runMaintenance,
    scheduleInterval,
    maintenanceIntervalMs,
  }) {
    this.#originalCreateServer = originalCreateServer;
    this.#replaceCreateServer = replaceCreateServer;
    this.#syncBuiltinExports = syncBuiltinExports;
    this.#dispatchRequest = dispatchRequest;
    this.#writeUnavailable = writeUnavailable;
    this.#reportError = reportError;
    this.#runMaintenance = runMaintenance;
    this.#scheduleInterval = scheduleInterval;
    this.#maintenanceIntervalMs = maintenanceIntervalMs;
  }

  install() {
    if (this.#installed) return;
    this.#installed = true;
    const runtime = this;
    /**
     * @this {unknown}
     * @param {CreateServerInput} optionsOrListener
     * @param {RequestListener | undefined} listener
     */
    function guardedCreateServer(optionsOrListener, listener) {
      const hasListenerOverload = typeof optionsOrListener === "function";
      const resolvedOptions = hasListenerOverload ? undefined : optionsOrListener;
      const resolvedListener = hasListenerOverload ? optionsOrListener : listener;
      /** @type {RequestListener | undefined} */
      const guardedListener =
        typeof resolvedListener === "function"
          ? (request, response) => runtime.#handleRequest(request, response, resolvedListener)
          : undefined;
      const server =
        resolvedOptions === undefined
          ? runtime.#originalCreateServer.call(this, guardedListener)
          : runtime.#originalCreateServer.call(this, resolvedOptions, guardedListener);
      runtime.#startMaintenance();
      return server;
    }
    this.#replaceCreateServer(guardedCreateServer);
    this.#syncBuiltinExports();
  }

  /**
   * @param {unknown} request
   * @param {HelperResponseLike} response
   * @param {RequestListener} listener
   */
  #handleRequest(request, response, listener) {
    try {
      if (this.#dispatchRequest(request, response)) return;
    } catch (error) {
      this.#reportError(error);
      if (!response.headersSent) {
        this.#writeUnavailable(response);
      } else {
        response.destroy(error instanceof Error ? error : undefined);
      }
      return;
    }
    return listener(request, response);
  }

  #startMaintenance() {
    if (this.#maintenanceTimer) return;
    this.#runMaintenancePass();
    this.#maintenanceTimer = this.#scheduleInterval(() => {
      this.#runMaintenancePass();
    }, this.#maintenanceIntervalMs);
    this.#maintenanceTimer.unref?.();
  }

  #runMaintenancePass() {
    void this.#runMaintenance().catch(() => {});
  }
}
