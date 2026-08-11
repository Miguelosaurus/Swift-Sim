// @ts-check

const RECONCILIATION_INTERVAL_MS = 15_000;
const DELIVERY_CLEANUP_INTERVAL_MS = 30_000;
const KEEP_ALIVE_INTERVAL_MS = 60 * 60 * 1_000;
const CONNECTION_DRAIN_GRACE_MS = 1_000;
const FORCE_EXIT_MS = 8_000;
const SHUTDOWN_BUILD_REASON = "Swift Sim helper is shutting down.";

/**
 * @typedef {{
 *   once(event: "close", listener: () => void): unknown,
 *   destroy(): unknown,
 * }} HelperSocketLike
 * @typedef {{
 *   on(event: "connection", listener: (socket: HelperSocketLike) => void): unknown,
 *   once(event: "error", listener: (error: unknown) => void): unknown,
 *   off(event: "error", listener: (error: unknown) => void): unknown,
 *   listen(port: number, host: string, listener: () => void): unknown,
 *   close(listener: () => void): unknown,
 *   closeIdleConnections?(): unknown,
 *   closeAllConnections?(): unknown,
 * }} HelperServerLike
 * @typedef {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => unknown} HelperRequestListener
 * @typedef {{ unref?(): unknown }} TimerHandle
 * @typedef {{ build: unknown, promise: Promise<unknown> }} ActiveBuildTask
 * @typedef {{ id: string }} ActiveSession
 * @typedef {{
 *   scheduleImmediate(callback: () => void): unknown,
 *   scheduleInterval(callback: () => void, intervalMs: number): TimerHandle,
 *   clearInterval(timer: TimerHandle): void,
 *   scheduleTimeout(callback: () => void, delayMs: number): TimerHandle,
 *   onceSignal(signal: "SIGTERM" | "SIGINT", listener: () => void): void,
 *   exit(code: number): void,
 * }} LifecycleRuntime
 * @typedef {{
 *   createServer(listener: HelperRequestListener): HelperServerLike,
 *   host: string,
 *   port: number,
 *   deviceBuildsOnly: boolean,
 *   recoverInterruptedBuilds(): Promise<unknown>,
 *   scheduleDeliveryCleanup(): unknown,
 *   reconcileRequestedBuilds(): Promise<unknown>,
 *   activeBuildTasks(): ActiveBuildTask[],
 *   cancelBuild(build: unknown, reason: string): unknown,
 *   listSessions(): ActiveSession[],
 *   stopSession(sessionID: string): Promise<unknown>,
 *   closeResources(): void,
 *   log(message: string): void,
 *   reportError(message: string): void,
 *   runtime: LifecycleRuntime,
 * }} HelperServiceLifecycleDependencies
 */

/**
 * Own the explicit helper service lifecycle while route composition remains
 * caller-owned. Compatibility HTTP preloads remain separate until Phase 5.
 *
 * @param {Partial<HelperServiceLifecycleDependencies> & Pick<HelperServiceLifecycleDependencies,
 *   "createServer" | "host" | "port" | "deviceBuildsOnly" | "recoverInterruptedBuilds" |
 *   "scheduleDeliveryCleanup" | "reconcileRequestedBuilds" | "activeBuildTasks" |
 *   "cancelBuild" | "listSessions" | "stopSession"
 * >} dependencies
 */
export function createHelperServiceLifecycle(dependencies) {
  const resolved = resolveDependencies(dependencies);
  /** @type {Set<HelperSocketLike>} */
  const activeSockets = new Set();
  let prepared = false;
  let started = false;
  let shuttingDown = false;
  /** @type {HelperServerLike | undefined} */
  let server;
  /** @type {TimerHandle | undefined} */
  let reconciliationTimer;
  /** @type {TimerHandle | undefined} */
  let deliveryCleanupTimer;
  /** @type {TimerHandle | undefined} */
  let keepAliveTimer;

  return Object.freeze({
    async prepare() {
      if (prepared) return;
      if (started) throw new Error("Helper service lifecycle has already started.");
      await resolved.recoverInterruptedBuilds();
      resolved.runtime.scheduleImmediate(() => {
        void resolved.scheduleDeliveryCleanup();
      });
      prepared = true;
    },

    /** @param {HelperRequestListener} requestListener */
    async start(requestListener) {
      if (!prepared) throw new Error("Helper service lifecycle must be prepared before start.");
      if (started) throw new Error("Helper service lifecycle has already started.");
      if (typeof requestListener !== "function") {
        throw new TypeError("Helper service lifecycle requires a request listener.");
      }
      started = true;
      server = resolved.createServer(requestListener);
      server.on("connection", (socket) => {
        activeSockets.add(socket);
        socket.once("close", () => activeSockets.delete(socket));
      });

      await listen(server, resolved.host, resolved.port);
      resolved.log(`swift-sim-helper listening at http://${resolved.host}:${resolved.port}`);
      if (resolved.deviceBuildsOnly) {
        resolved.log("Device-build-only gateway ready.");
      } else {
        resolved.log(`Expose simulator sessions privately with: tailscale serve ${resolved.port}`);
      }

      if (!resolved.deviceBuildsOnly) {
        scheduleReconciliation();
        reconciliationTimer = resolved.runtime.scheduleInterval(
          scheduleReconciliation,
          RECONCILIATION_INTERVAL_MS,
        );
      }
      deliveryCleanupTimer = resolved.runtime.scheduleInterval(() => {
        void resolved.scheduleDeliveryCleanup();
      }, DELIVERY_CLEANUP_INTERVAL_MS);
      deliveryCleanupTimer.unref?.();
      keepAliveTimer = resolved.runtime.scheduleInterval(() => {}, KEEP_ALIVE_INTERVAL_MS);

      resolved.runtime.onceSignal("SIGTERM", shutdown);
      resolved.runtime.onceSignal("SIGINT", shutdown);
    },

    shutdown,

    wait() {
      return new Promise(() => {});
    },
  });

  function scheduleReconciliation() {
    void resolved.reconcileRequestedBuilds().catch((error) => {
      resolved.reportError(
        `Device installation reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }

  function shutdown() {
    if (shuttingDown || !server) return;
    shuttingDown = true;
    if (reconciliationTimer) resolved.runtime.clearInterval(reconciliationTimer);
    if (deliveryCleanupTimer) resolved.runtime.clearInterval(deliveryCleanupTimer);
    if (keepAliveTimer) resolved.runtime.clearInterval(keepAliveTimer);

    for (const { build } of resolved.activeBuildTasks()) {
      resolved.cancelBuild(build, SHUTDOWN_BUILD_REASON);
    }
    server.closeIdleConnections?.();

    let serverClosed = false;
    let sessionsStopped = false;
    let finalized = false;
    const maybeExit = () => {
      if (!serverClosed || !sessionsStopped || finalized) return;
      finalized = true;
      try {
        resolved.closeResources();
        resolved.runtime.exit(0);
      } catch {
        try {
          resolved.reportError("Helper resource close failed.");
        } catch {
          // Resource-close failure still requires a deterministic nonzero exit.
        }
        resolved.runtime.exit(1);
      }
    };
    server.close(() => {
      serverClosed = true;
      maybeExit();
    });

    const sessions = resolved.listSessions();
    const buildTasks = resolved.activeBuildTasks().map(({ promise }) => promise);
    void Promise.allSettled([
      ...sessions.map((session) => resolved.stopSession(session.id)),
      ...buildTasks,
    ]).finally(() => {
      sessionsStopped = true;
      maybeExit();
    });

    const closeTimer = resolved.runtime.scheduleTimeout(() => {
      for (const socket of activeSockets) socket.destroy();
      server?.closeAllConnections?.();
    }, CONNECTION_DRAIN_GRACE_MS);
    closeTimer.unref?.();
    const forceTimer = resolved.runtime.scheduleTimeout(
      () => resolved.runtime.exit(1),
      FORCE_EXIT_MS,
    );
    forceTimer.unref?.();
  }
}

/** @param {HelperServerLike} server @param {string} host @param {number} port */
function listen(server, host, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve(undefined);
    });
  });
}

/**
 * @param {Partial<HelperServiceLifecycleDependencies> & Pick<HelperServiceLifecycleDependencies,
 *   "createServer" | "host" | "port" | "deviceBuildsOnly" | "recoverInterruptedBuilds" |
 *   "scheduleDeliveryCleanup" | "reconcileRequestedBuilds" | "activeBuildTasks" |
 *   "cancelBuild" | "listSessions" | "stopSession"
 * >} dependencies
 * @returns {HelperServiceLifecycleDependencies}
 */
function resolveDependencies(dependencies) {
  const runtime = dependencies.runtime || defaultRuntime();
  const resolved = {
    ...dependencies,
    closeResources: dependencies.closeResources || (() => {}),
    log: dependencies.log || ((message) => console.log(message)),
    reportError: dependencies.reportError || ((message) => console.error(message)),
    runtime,
  };
  const requiredFunctions = [
    ["createServer", resolved.createServer],
    ["recoverInterruptedBuilds", resolved.recoverInterruptedBuilds],
    ["scheduleDeliveryCleanup", resolved.scheduleDeliveryCleanup],
    ["reconcileRequestedBuilds", resolved.reconcileRequestedBuilds],
    ["activeBuildTasks", resolved.activeBuildTasks],
    ["cancelBuild", resolved.cancelBuild],
    ["listSessions", resolved.listSessions],
    ["stopSession", resolved.stopSession],
    ["closeResources", resolved.closeResources],
    ["log", resolved.log],
    ["reportError", resolved.reportError],
  ];
  for (const [name, implementation] of requiredFunctions) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Helper service lifecycle requires ${name}.`);
    }
  }
  if (!resolved.host || typeof resolved.host !== "string") {
    throw new TypeError("Helper service lifecycle requires host.");
  }
  if (!Number.isFinite(resolved.port)) {
    throw new TypeError("Helper service lifecycle requires port.");
  }
  validateRuntime(runtime);
  return /** @type {HelperServiceLifecycleDependencies} */ (resolved);
}

/** @returns {LifecycleRuntime} */
function defaultRuntime() {
  return {
    scheduleImmediate: (callback) => setImmediate(callback),
    scheduleInterval: (callback, intervalMs) => setInterval(callback, intervalMs),
    clearInterval: (timer) => clearInterval(/** @type {NodeJS.Timeout} */ (timer)),
    scheduleTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
    onceSignal: (signal, listener) => process.once(signal, listener),
    exit: (code) => process.exit(code),
  };
}

/** @param {LifecycleRuntime} runtime */
function validateRuntime(runtime) {
  const required = [
    ["scheduleImmediate", runtime?.scheduleImmediate],
    ["scheduleInterval", runtime?.scheduleInterval],
    ["clearInterval", runtime?.clearInterval],
    ["scheduleTimeout", runtime?.scheduleTimeout],
    ["onceSignal", runtime?.onceSignal],
    ["exit", runtime?.exit],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Helper service lifecycle runtime requires ${name}.`);
    }
  }
}
