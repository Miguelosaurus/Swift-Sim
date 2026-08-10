// @ts-check

/**
 * @typedef {{
 *   clearPeriodicWork(): void,
 *   listBuildTasks(): Array<{ build: unknown, promise: Promise<unknown> }>,
 *   cancelBuild(build: unknown, message: string): void,
 *   closeIdleConnections(): void,
 *   closeServer(onClosed: () => void): void,
 *   closeAllConnections(): void,
 *   listSessions(): Array<{ id: string }>,
 *   stopSession(sessionID: string): Promise<unknown>,
 *   exit(code: number): void,
 *   setTimeoutFn(callback: () => void, delayMs: number): { unref?: () => unknown },
 * }} HelperShutdownDependencies
 */

const SHUTDOWN_BUILD_MESSAGE = "Swift Sim helper is shutting down.";

/** @param {HelperShutdownDependencies} dependencies */
export function createHelperShutdownCoordinator(dependencies) {
  validateDependencies(dependencies);
  /** @type {Set<{ once(event: string, listener: () => void): unknown, destroy(): unknown }>} */
  const sockets = new Set();
  let shuttingDown = false;

  return Object.freeze({
    /** @param {{ once(event: string, listener: () => void): unknown, destroy(): unknown }} socket */
    trackSocket(socket) {
      sockets.add(socket);
      socket.once("close", () => sockets.delete(socket));
    },

    shutdown() {
      if (shuttingDown) return;
      shuttingDown = true;

      dependencies.clearPeriodicWork();
      for (const { build } of dependencies.listBuildTasks()) {
        dependencies.cancelBuild(build, SHUTDOWN_BUILD_MESSAGE);
      }
      dependencies.closeIdleConnections();

      let serverClosed = false;
      let sessionsStopped = false;
      const maybeExit = () => {
        if (serverClosed && sessionsStopped) dependencies.exit(0);
      };

      dependencies.closeServer(() => {
        serverClosed = true;
        maybeExit();
      });

      const sessions = dependencies.listSessions();
      const buildTasks = dependencies.listBuildTasks().map(({ promise }) => promise);
      void Promise.allSettled([
        ...sessions.map((session) => dependencies.stopSession(session.id)),
        ...buildTasks,
      ]).finally(() => {
        sessionsStopped = true;
        maybeExit();
      });

      const closeTimer = dependencies.setTimeoutFn(() => {
        for (const socket of sockets) socket.destroy();
        dependencies.closeAllConnections();
      }, 1_000);
      closeTimer.unref?.();

      const forceTimer = dependencies.setTimeoutFn(() => dependencies.exit(1), 8_000);
      forceTimer.unref?.();
    },
  });
}

/** @param {HelperShutdownDependencies} dependencies */
function validateDependencies(dependencies) {
  const required = [
    ["clearPeriodicWork", dependencies?.clearPeriodicWork],
    ["listBuildTasks", dependencies?.listBuildTasks],
    ["cancelBuild", dependencies?.cancelBuild],
    ["closeIdleConnections", dependencies?.closeIdleConnections],
    ["closeServer", dependencies?.closeServer],
    ["closeAllConnections", dependencies?.closeAllConnections],
    ["listSessions", dependencies?.listSessions],
    ["stopSession", dependencies?.stopSession],
    ["exit", dependencies?.exit],
    ["setTimeoutFn", dependencies?.setTimeoutFn],
  ];
  for (const [name, implementation] of required) {
    if (typeof implementation !== "function") {
      throw new TypeError(`Helper shutdown coordinator requires ${name}.`);
    }
  }
}
