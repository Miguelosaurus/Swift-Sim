// @ts-check

const RECONCILIATION_INTERVAL_MS = 15_000;
const DELIVERY_CLEANUP_INTERVAL_MS = 30_000;
const KEEP_ALIVE_INTERVAL_MS = 60 * 60 * 1000;
const SOCKET_DRAIN_GRACE_MS = 1_000;
const FORCE_EXIT_GRACE_MS = 8_000;
const SHUTDOWN_REASON = "Swift Sim helper is shutting down.";

/** @typedef {{ unref?(): unknown }} TimerHandle */
/** @typedef {{ once(event: "close", listener: () => void): unknown, destroy(): unknown }} HelperSocket */
/**
 * @typedef {{
 *   on(event: "connection", listener: (socket: HelperSocket) => void): unknown,
 *   once(event: "error", listener: (error: unknown) => void): unknown,
 *   off(event: "error", listener: (error: unknown) => void): unknown,
 *   listen(port: number, host: string, listener: () => void): unknown,
 *   close(listener: () => void): unknown,
 *   closeIdleConnections?(): unknown,
 *   closeAllConnections?(): unknown,
 * }} HelperServer
 */
/** @typedef {{ id: string }} HelperSession */
/** @typedef {{ build: unknown, promise: Promise<unknown> }} ActiveBuildTask */
/**
 * @typedef {{
 *   scheduleReconciliation(): unknown,
 *   scheduleDeliveryCleanup(): unknown,
 *   listActiveBuildTasks(): Iterable<ActiveBuildTask>,
 *   requestBuildCancellation(build: unknown, reason: string): unknown,
 *   listSessions(): HelperSession[],
 *   stopSession(sessionID: string): Promise<unknown>,
 *   registerSignal(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown,
 *   exit(code: number): unknown,
 *   scheduleInterval(callback: () => void, intervalMs: number): TimerHandle,
 *   cancelInterval(handle: TimerHandle): unknown,
 *   scheduleTimeout(callback: () => void, delayMs: number): TimerHandle,
 *   waitForExit(): Promise<unknown>,
 * }} HelperServiceLifecycleDependencies
 */
/**
 * @typedef {{
 *   server: HelperServer,
 *   host: string,
 *   port: number,
 *   deviceBuildsOnly?: boolean,
 *   onListening(): unknown,
 * }} HelperServiceLifecycleRunOptions
 */

/** @param {HelperServiceLifecycleDependencies} dependencies */
export function createHelperServiceLifecycle(dependencies) {
  validateDependencies(dependencies);
  return new HelperServiceLifecycle(dependencies);
}

class HelperServiceLifecycle {
  /** @type {HelperServiceLifecycleDependencies} */
  #dependencies;
  /** @type {Set<HelperSocket>} */
  #activeSockets = new Set();
  /** @type {HelperServer | undefined} */
  #server;
  /** @type {TimerHandle | undefined} */
  #reconciliationTimer;
  /** @type {TimerHandle | undefined} */
  #deliveryCleanupTimer;
  /** @type {TimerHandle | undefined} */
  #keepAliveTimer;
  #started = false;
  #shuttingDown = false;

  /** @param {HelperServiceLifecycleDependencies} dependencies */
  constructor(dependencies) {
    this.#dependencies = dependencies;
  }

  /** @param {HelperServiceLifecycleRunOptions} options */
  async run({ server, host, port, deviceBuildsOnly = false, onListening }) {
    if (this.#started) {
      throw new Error("Helper service lifecycle can only be started once.");
    }
    validateRunOptions({ server, host, port, onListening });
    this.#started = true;
    this.#server = server;

    server.on("connection", (socket) => this.#trackSocket(socket));
    await new Promise((resolve, reject) => {
      const handleListenError = (error) => reject(error);
      server.once("error", handleListenError);
      server.listen(port, host, () => {
        server.off("error", handleListenError);
        onListening();
        resolve(undefined);
      });
    });

    if (!deviceBuildsOnly) {
      this.#dependencies.scheduleReconciliation();
      this.#reconciliationTimer = this.#dependencies.scheduleInterval(() => {
        this.#dependencies.scheduleReconciliation();
      }, RECONCILIATION_INTERVAL_MS);
    }

    this.#deliveryCleanupTimer = this.#dependencies.scheduleInterval(() => {
      this.#dependencies.scheduleDeliveryCleanup();
    }, DELIVERY_CLEANUP_INTERVAL_MS);
    this.#deliveryCleanupTimer.unref?.();

    this.#keepAliveTimer = this.#dependencies.scheduleInterval(() => {}, KEEP_ALIVE_INTERVAL_MS);

    const shutdown = () => this.#shutdown();
    this.#dependencies.registerSignal("SIGTERM", shutdown);
    this.#dependencies.registerSignal("SIGINT", shutdown);

    await this.#dependencies.waitForExit();
  }

  /** @param {HelperSocket} socket */
  #trackSocket(socket) {
    this.#activeSockets.add(socket);
    socket.once("close", () => this.#activeSockets.delete(socket));
  }

  #shutdown() {
    if (this.#shuttingDown) return;
    this.#shuttingDown = true;

    this.#cancelTimer(this.#reconciliationTimer);
    this.#cancelTimer(this.#deliveryCleanupTimer);
    this.#cancelTimer(this.#keepAliveTimer);

    for (const { build } of this.#dependencies.listActiveBuildTasks()) {
      this.#dependencies.requestBuildCancellation(build, SHUTDOWN_REASON);
    }

    const server = this.#server;
    if (!server) return;
    server.closeIdleConnections?.();

    let serverClosed = false;
    let sessionsStopped = false;
    const maybeExit = () => {
      if (serverClosed && sessionsStopped) this.#dependencies.exit(0);
    };

    server.close(() => {
      serverClosed = true;
      maybeExit();
    });

    const sessions = this.#dependencies.listSessions();
    const buildTasks = [...this.#dependencies.listActiveBuildTasks()].map(({ promise }) => promise);
    void Promise.allSettled([
      ...sessions.map((session) => this.#dependencies.stopSession(session.id)),
      ...buildTasks,
    ]).finally(() => {
      sessionsStopped = true;
      maybeExit();
    });

    const closeTimer = this.#dependencies.scheduleTimeout(() => {
      for (const socket of this.#activeSockets) socket.destroy();
      server.closeAllConnections?.();
    }, SOCKET_DRAIN_GRACE_MS);
    closeTimer.unref?.();

    const forceTimer = this.#dependencies.scheduleTimeout(() => {
      this.#dependencies.exit(1);
    }, FORCE_EXIT_GRACE_MS);
    forceTimer.unref?.();
  }

  /** @param {TimerHandle | undefined} timer */
  #cancelTimer(timer) {
    if (timer) this.#dependencies.cancelInterval(timer);
  }
}

/** @param {HelperServiceLifecycleDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["scheduleReconciliation", dependencies?.scheduleReconciliation],
    ["scheduleDeliveryCleanup", dependencies?.scheduleDeliveryCleanup],
    ["listActiveBuildTasks", dependencies?.listActiveBuildTasks],
    ["requestBuildCancellation", dependencies?.requestBuildCancellation],
    ["listSessions", dependencies?.listSessions],
    ["stopSession", dependencies?.stopSession],
    ["registerSignal", dependencies?.registerSignal],
    ["exit", dependencies?.exit],
    ["scheduleInterval", dependencies?.scheduleInterval],
    ["cancelInterval", dependencies?.cancelInterval],
    ["scheduleTimeout", dependencies?.scheduleTimeout],
    ["waitForExit", dependencies?.waitForExit],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Helper service lifecycle requires ${name}.`);
    }
  }
}

/** @param {Pick<HelperServiceLifecycleRunOptions, "server" | "host" | "port" | "onListening">} options */
function validateRunOptions({ server, host, port, onListening }) {
  const serverMethods = ["on", "once", "off", "listen", "close"];
  for (const method of serverMethods) {
    if (typeof server?.[method] !== "function") {
      throw new TypeError(`Helper service lifecycle requires server.${method}().`);
    }
  }
  if (typeof host !== "string" || host.length === 0) {
    throw new TypeError("Helper service lifecycle requires a host.");
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new TypeError("Helper service lifecycle requires a valid port.");
  }
  if (typeof onListening !== "function") {
    throw new TypeError("Helper service lifecycle requires onListening().");
  }
}
