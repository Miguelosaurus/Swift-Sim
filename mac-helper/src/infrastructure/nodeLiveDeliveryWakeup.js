import { lstatSync, watch as watchDirectory } from "node:fs";
import { isAbsolute } from "node:path";

// A single kernel subscription in the existing helper. Events are hints only;
// the normal worker retains every lock, scope, expiry and native proof check.
export function createNodeLiveDeliveryWakeup({
  rootPath,
  onChange,
  watch = watchDirectory,
  inspect = lstatSync,
} = {}) {
  if (!isAbsolute(rootPath || "") || typeof onChange !== "function")
    throw new TypeError("A scoped live queue and wake callback are required.");
  let watcher,
    identity,
    stopped = false;
  function detach() {
    const previous = watcher;
    watcher = undefined;
    identity = undefined;
    try {
      previous?.close();
    } catch {
      /* fallback polling remains authoritative */
    }
  }
  function refresh() {
    if (stopped) return;
    try {
      const stats = inspect(rootPath);
      if (
        !stats.isDirectory() ||
        stats.isSymbolicLink() ||
        stats.mode & 0o077 ||
        (process.getuid && stats.uid !== process.getuid())
      ) {
        detach();
        return;
      }
      const current = `${stats.dev}:${stats.ino}`;
      if (watcher && identity === current) return;
      detach();
      const selected = watch(rootPath, { persistent: false }, (_event, filename) => {
        if (
          !stopped &&
          watcher === selected &&
          (filename === null || String(filename) === "queue.json")
        )
          onChange();
      });
      watcher = selected;
      identity = current;
      selected.on("error", () => {
        if (watcher === selected) detach();
      });
    } catch {
      detach();
    }
  }
  refresh();
  return Object.freeze({
    refresh,
    close() {
      stopped = true;
      detach();
    },
  });
}
