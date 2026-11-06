import test from "node:test";
import assert from "node:assert/strict";
import { createNodeLiveDeliveryWakeup } from "../mac-helper/src/infrastructure/nodeLiveDeliveryWakeup.js";

function fixture() {
  let count = 0, missing = false;
  const subscriptions = [];
  let stats = { dev: 1, ino: 2, mode: 0o40700, uid: process.getuid?.(), isDirectory: () => true, isSymbolicLink: () => false };
  const watcher = createNodeLiveDeliveryWakeup({ rootPath: "/private/task/live/deliveries", onChange: () => count++,
    inspect(path) { assert.equal(path, "/private/task/live/deliveries"); if (missing) throw Error("absent"); return stats; },
    watch(path, options, callback) {
      assert.equal(path, "/private/task/live/deliveries"); assert.deepEqual(options, { persistent: false });
      const sub = { callback, closeCalls: 0, error: null, close() { this.closeCalls++; }, on(name, handler) { assert.equal(name, "error"); this.error = handler; } };
      subscriptions.push(sub); return sub;
    } });
  return { watcher, subscriptions, count: () => count, missing(value) { missing = value; }, stats(value) { stats = { ...stats, ...value }; } };
}

test("one scoped subscription wakes only for queue publication hints and closes deterministically", () => {
  const f = fixture(); const sub = f.subscriptions[0];
  for (let i = 0; i < 20; i++) f.watcher.refresh();
  assert.equal(f.subscriptions.length, 1);
  sub.callback("rename", "readiness.json"); sub.callback("rename", "queue.lock");
  assert.equal(f.count(), 0);
  sub.callback("rename", "queue.json"); sub.callback("change", Buffer.from("queue.json")); sub.callback("rename", null);
  assert.equal(f.count(), 3);
  f.watcher.close(); f.watcher.close(); f.watcher.refresh(); sub.callback("rename", "queue.json");
  assert.equal(f.count(), 3); assert.equal(sub.closeCalls, 1); assert.equal(f.subscriptions.length, 1);
});

test("missing roots, watcher errors and directory replacement retain bounded fallback recovery", () => {
  const f = fixture(); const first = f.subscriptions[0];
  first.error(Error("kernel failure")); assert.equal(first.closeCalls, 1);
  first.callback("rename", "queue.json"); assert.equal(f.count(), 0);
  f.missing(true); f.watcher.refresh(); assert.equal(f.subscriptions.length, 1);
  f.missing(false); f.watcher.refresh(); assert.equal(f.subscriptions.length, 2);
  const second = f.subscriptions[1];
  f.stats({ ino: 3 }); f.watcher.refresh(); assert.equal(second.closeCalls, 1); assert.equal(f.subscriptions.length, 3);
  second.callback("rename", "queue.json"); assert.equal(f.count(), 0);
  f.subscriptions[2].callback("rename", "queue.json"); assert.equal(f.count(), 1);
  f.watcher.close();
});

test("unsafe permissions, symlinks and non-directory queue roots are never watched", () => {
  for (const invalid of [{ mode: 0o40755 }, { isSymbolicLink: () => true }, { isDirectory: () => false }, { uid: (process.getuid?.() ?? 0) + 1 }]) {
    const f = fixture(); f.stats(invalid); f.watcher.refresh();
    assert.equal(f.subscriptions[0].closeCalls, 1); assert.equal(f.subscriptions.length, 1);
    f.watcher.close();
  }
  assert.throws(() => createNodeLiveDeliveryWakeup({ rootPath: "relative", onChange() {} }));
});
