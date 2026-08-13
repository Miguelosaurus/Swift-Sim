import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { SESSION_SQLITE_SCHEMA_STATEMENTS } from "../mac-helper/src/persistence/sessionSqliteSchema.js";
import { SessionShadowComparator } from "../mac-helper/src/persistence/sessionShadowComparison.js";
import { SqliteSessionShadowMismatchRepository } from "../mac-helper/src/persistence/sqliteSessionShadowMismatchRepository.js";
import { SwiftSimSqliteDatabase } from "../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const A = { id: "a", token: "t-a", build: { state: "built" }, stream: { state: "running" }, logs: [] };
const B = { id: "b", token: "t-b", build: { state: "built" }, stream: { state: "stopped" }, logs: [] };

test("session shadow evidence is redacted and repeat-safe", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "swift-sim-session-shadow-"));
  const database = new SwiftSimSqliteDatabase({ path: join(root, "state.sqlite") });
  for (const statement of SESSION_SQLITE_SCHEMA_STATEMENTS) database.exec(statement);
  t.after(async () => { database.close(); await rm(root, { recursive: true, force: true }); });
  const mismatches = new SqliteSessionShadowMismatchRepository(database);
  let tick = 0;
  const compare = new SessionShadowComparator({ mismatchRepository: mismatches, now: () => `2026-08-13T20:00:0${tick++}.000Z` });
  assert.equal(compare.compare({ legacy: [A], sqlite: [A] }).matched, true);
  const first = compare.compare({ legacy: [A], sqlite: [B] });
  const second = compare.compare({ legacy: [A], sqlite: [B] });
  assert.equal(first.matched, false);
  assert.equal(second.evidence.observationCount, 2);
  assert.equal(JSON.stringify(second).includes("t-a"), false);
  assert.equal(JSON.stringify(second).includes("t-b"), false);
});
