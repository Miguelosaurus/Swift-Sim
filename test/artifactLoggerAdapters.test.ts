import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NodeArtifactStore } from "../mac-helper/src/infrastructure/nodeArtifactStore.js";
import { StructuredLogger } from "../mac-helper/src/infrastructure/structuredLogger.js";
import type { Clock } from "../mac-helper/src/infrastructure/ports.js";

const artifactWrite = Object.freeze({ mode: 0o600, replace: false });

test("NodeArtifactStore requires containment approval and blocks traversal and symlinks", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "swift-sim-artifact-store-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, "private-artifacts");
  const outside = join(workspace, "outside");
  await mkdir(root, { recursive: true, mode: 0o700 });
  await mkdir(outside, { recursive: true, mode: 0o700 });
  await writeFile(join(outside, "keep.txt"), "keep");
  const store = new NodeArtifactStore();

  assert.throws(
    () => store.resolveContained(root, "../outside/keep.txt"),
    (error: unknown) => hasCode(error, "SWIFT_SIM_ARTIFACT_PATH_INVALID"),
  );
  assert.throws(
    () => store.writeSync(join(root, "unapproved.txt"), "no", artifactWrite),
    (error: unknown) => hasCode(error, "SWIFT_SIM_ARTIFACT_PATH_INVALID"),
  );

  await symlink(outside, join(root, "escape"));
  assert.throws(
    () => store.resolveContained(root, "escape/stolen.txt"),
    (error: unknown) => hasCode(error, "SWIFT_SIM_ARTIFACT_PATH_INVALID"),
  );
  assert.equal(await readFile(join(outside, "keep.txt"), "utf8"), "keep");
});

test("NodeArtifactStore reads, replaces, and removes only approved paths", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "swift-sim-artifact-io-"));
  t.after(async () => rm(workspace, { recursive: true, force: true }));
  const root = join(workspace, "private-artifacts");
  const store = new NodeArtifactStore();
  const directory = store.resolveContained(root, "build-1");
  const artifact = store.resolveContained(root, "build-1/app.ipa");

  store.createDirectorySync(directory, 0o700);
  store.writeSync(artifact, "first", artifactWrite);
  assert.equal(Buffer.from(store.readSync(artifact)).toString("utf8"), "first");
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(artifact)).mode & 0o777, 0o600);
  assert.throws(
    () => store.writeSync(artifact, "collision", artifactWrite),
    (error: unknown) => hasCode(error, "EEXIST"),
  );

  await store.write(artifact, new TextEncoder().encode("second"), {
    ...artifactWrite,
    replace: true,
  });
  assert.equal(Buffer.from(await store.read(artifact)).toString("utf8"), "second");

  const external = join(workspace, "external.txt");
  await writeFile(external, "outside");
  await symlink(external, join(directory, "external-link"));
  await store.removeTree(directory);
  assert.equal(await readFile(external, "utf8"), "outside");
});

test("StructuredLogger emits deterministic bounded records and redacts secrets", () => {
  const lines: string[] = [];
  const clock: Clock = {
    now: () => new Date("2026-08-04T21:00:00.000Z"),
    monotonicMilliseconds: () => 123,
    sleep: async () => {},
  };
  const logger = new StructuredLogger({
    clock,
    writer: (line) => lines.push(line),
    fields: { component: "helper", accessToken: "base-secret" },
  }).child({ requestId: "request-1", cookie: "session-cookie" });
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  const error = Object.assign(new Error("contains private details"), { code: "E_TEST" });

  logger.log("warn", "artifact.cleanup.failed", {
    buildId: "build-1",
    authorization: "Bearer hidden",
    nested: { password: "hidden", safe: "visible" },
    circular,
    error,
    line: "first\nsecond",
  });

  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0] ?? ""), {
    timestamp: "2026-08-04T21:00:00.000Z",
    level: "warn",
    event: "artifact.cleanup.failed",
    fields: {
      component: "helper",
      accessToken: "[REDACTED]",
      requestId: "request-1",
      cookie: "[REDACTED]",
      buildId: "build-1",
      authorization: "[REDACTED]",
      nested: { password: "[REDACTED]", safe: "visible" },
      circular: { self: "[circular]" },
      error: { name: "Error", code: "E_TEST" },
      line: "first second",
    },
  });
  assert.throws(() => logger.log("info", "invalid event", {}));
  assert.doesNotThrow(() =>
    new StructuredLogger({ writer: () => { throw new Error("sink failed"); }, clock }).log(
      "error",
      "logger.sink.failed",
    ),
  );
});

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}
