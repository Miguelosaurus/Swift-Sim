import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SESSION_SQLITE_SCHEMA_STATEMENTS } from "../mac-helper/src/persistence/sessionSqliteSchema.js";
import { SqliteSessionStateRepository } from "../mac-helper/src/persistence/sqliteSessionStateRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const A = { id: "a", token: "t-a", orientation: "landscape", revision: 3, build: { state: "built", extra: "kept" }, stream: { state: "running", pid: 123 }, logs: ["ready"] };
const B = { id: "b", token: "t-b", revision: 1, build: { state: "external-or-not-run" }, stream: { state: "stopped" }, logs: [] };

test("session repository preserves fields and rolls back failed replacement", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-session-repo-"));
  const database = new SwiftSimSqliteDatabase({ path: join(root, "state.sqlite") });
  for (const statement of SESSION_SQLITE_SCHEMA_STATEMENTS) database.exec(statement);
  t.after(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
  const sessions = new SqliteSessionStateRepository(database);
  sessions.replace([B, A]);
  assert.deepEqual(sessions.read(), [A, B]);
  assert.equal(sessions.get("a").orientation, "landscape");
  database.exec(`CREATE TRIGGER reject_blocked_session BEFORE INSERT ON session_records WHEN NEW.id = 'blocked' BEGIN SELECT RAISE(ABORT, 'blocked session'); END`);
  assert.throws(() => sessions.replace([A, { ...B, id: "blocked" }]), /blocked session/);
  assert.deepEqual(sessions.read(), [A, B]);
});
