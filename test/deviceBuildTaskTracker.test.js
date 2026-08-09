import assert from "node:assert/strict";
import test from "node:test";
import { trackDeviceBuildTask } from "../mac-helper/src/deviceBuildTaskTracker.js";

test("device build tasks start lazily, coalesce by key, and clear only their own entry", async () => {
  const active = new Map();
  let starts = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const first = trackDeviceBuildTask(active, "renewal:1", { id: "first" }, async () => {
    starts += 1;
    await gate;
    return "ready";
  });
  const second = trackDeviceBuildTask(active, "renewal:1", { id: "second" }, async () => {
    starts += 1;
    return "wrong";
  });

  assert.equal(first, second);
  assert.equal(starts, 0);
  assert.equal(active.get("renewal:1")?.build.id, "first");
  await Promise.resolve();
  assert.equal(starts, 1);
  release();
  assert.deepEqual(await Promise.all([first, second]), ["ready", "ready"]);
  assert.equal(active.has("renewal:1"), false);
});

test("a completed task cannot delete a replacement entry", async () => {
  const active = new Map();
  let release;
  const first = trackDeviceBuildTask(active, "build:1", {}, () =>
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  await Promise.resolve();
  const replacement = { build: {}, promise: Promise.resolve("replacement") };
  active.set("build:1", replacement);
  release("first");
  assert.equal(await first, "first");
  assert.equal(active.get("build:1"), replacement);
});
