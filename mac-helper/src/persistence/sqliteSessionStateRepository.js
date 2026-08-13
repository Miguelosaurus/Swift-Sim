// @ts-check

import { parseSessionRecord } from "../contracts/session.js";

export class SqliteSessionStateRepository {
  #database;
  #list;
  #get;
  #clear;
  #insert;

  constructor(database) {
    this.#database = database;
    this.#list = database.prepare("SELECT id, record_json FROM session_records ORDER BY id");
    this.#get = database.prepare("SELECT id, record_json FROM session_records WHERE id = ?");
    this.#clear = database.prepare("DELETE FROM session_records");
    this.#insert = database.prepare("INSERT INTO session_records(id, revision, updated_at, stream_state, record_json) VALUES (?, ?, ?, ?, ?)");
  }

  read() {
    return this.#list.all().map(readRow);
  }

  get(id) {
    const row = this.#get.get(id);
    return row ? readRow(row) : null;
  }

  replace(snapshot) {
    const records = normalizeSessionStateSnapshot(snapshot);
    this.#database.transaction(() => this.replaceInCurrentTransaction(records));
  }

  replaceInCurrentTransaction(snapshot) {
    const records = normalizeSessionStateSnapshot(snapshot);
    this.#clear.run();
    for (const record of records) {
      this.#insert.run(record.id, record.revision ?? 0, record.updatedAt ?? null, record.stream.state, JSON.stringify(record));
    }
  }
}

export function normalizeSessionStateSnapshot(snapshot) {
  if (!Array.isArray(snapshot)) throw new Error("Session state snapshot must be an array.");
  const records = snapshot.map((value) => structuredClone(parseSessionRecord(value)));
  records.sort((left, right) => left.id.localeCompare(right.id));
  for (let index = 1; index < records.length; index += 1) {
    if (records[index - 1].id === records[index].id) throw new Error(`Duplicate session id: ${records[index].id}.`);
  }
  return records;
}

function readRow(row) {
  if (!row || typeof row.record_json !== "string") throw new Error("SQLite returned an invalid session row.");
  const record = structuredClone(parseSessionRecord(JSON.parse(row.record_json)));
  if (row.id !== record.id) throw new Error("SQLite session row id disagrees with its record.");
  return record;
}
