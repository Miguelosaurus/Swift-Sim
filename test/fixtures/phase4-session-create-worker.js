import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SessionStore as BaseSessionStore } from "../../mac-helper/src/sessionStoreBase.js";
import {
  createSqliteDurableSessionStore,
  SqliteDurableSessionMutationRepository,
} from "../../mac-helper/src/persistence/phase4SessionStore.js";
import { PHASE4_SQLITE_MIGRATIONS } from "../../mac-helper/src/persistence/phase4SqliteSchema.js";
import { SwiftSimSqliteDatabase } from "../../mac-helper/src/persistence/swiftSimSqliteDatabase.js";

const [root, action, boundary = "", disposition = "pause"] = process.argv.slice(2);
const database = new SwiftSimSqliteDatabase({
  path: join(root, "state.sqlite"),
  migrations: PHASE4_SQLITE_MIGRATIONS,
});
let paused = false;
function checkpoint(point) {
  if (paused || boundary !== point) return;
  paused = true;
  writeFileSync(join(root, "creator-ready.json"), JSON.stringify({ point, pid: process.pid }));
  if (disposition === "crash") process.exit(0);
  const deadline = Date.now() + 12_000;
  while (!existsSync(join(root, "creator-release"))) {
    if (Date.now() >= deadline) throw new Error("Session create test barrier timed out.");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
const stage = SqliteDurableSessionMutationRepository.prototype.stageCreateIntent;
SqliteDurableSessionMutationRepository.prototype.stageCreateIntent = function (value) {
  stage.call(this, value);
  checkpoint("before-durable");
};
const upsert = SqliteDurableSessionMutationRepository.prototype.upsert;
SqliteDurableSessionMutationRepository.prototype.upsert = function (value) {
  const result = upsert.call(this, value);
  checkpoint("after-durable");
  return result;
};
const publish = BaseSessionStore.prototype.writeStateUnlocked;
BaseSessionStore.prototype.writeStateUnlocked = function (sessions) {
  checkpoint("during-publication");
  publish.call(this, sessions);
  checkpoint("after-publication");
};
try {
  writeFileSync(join(root, `${action}-attempting`), "1");
  const store = createSqliteDurableSessionStore({
    database,
    legacyPath: join(root, "sessions.json"),
  });
  if (action === "creator") {
    store.create(JSON.parse(readFileSync(join(root, "create-input.json"), "utf8")));
  }
  writeFileSync(join(root, `${action}-done.json`), JSON.stringify(store.list()));
} finally {
  database.close();
}
