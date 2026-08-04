// @ts-check
import { NodeAtomicFileStore } from "./nodeAtomicFileStore.js";

/** @typedef {import("./ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("./ports.js").RuntimeJournalRecord} RuntimeJournalRecord */
/** @typedef {import("./ports.js").RuntimeJournalStore} RuntimeJournalStore */

const JOURNAL_WRITE_OPTIONS = Object.freeze({
  mode: 0o600,
  createParentMode: 0o700,
  replace: true,
  syncDirectory: true,
});

/** @implements {RuntimeJournalStore} */
export class NodeRuntimeJournalStore {
  /** @param {{ fileStore?: AtomicFileStore }} [options] */
  constructor({ fileStore = new NodeAtomicFileStore() } = {}) {
    this.fileStore = fileStore;
  }

  /** @param {string} path @param {RuntimeJournalRecord} record */
  async publish(path, record) {
    await this.fileStore.writeJSON(path, record, JOURNAL_WRITE_OPTIONS);
  }

  /** @param {string} path @param {RuntimeJournalRecord} record */
  publishSync(path, record) {
    this.fileStore.writeJSONSync(path, record, JOURNAL_WRITE_OPTIONS);
  }

  /** @param {string} path */
  async read(path) {
    return this.fileStore.readJSON(path);
  }

  /** @param {string} path */
  readSync(path) {
    return this.fileStore.readJSONSync(path);
  }

  /** @param {string} path */
  async remove(path) {
    await this.fileStore.remove(path);
  }

  /** @param {string} path */
  removeSync(path) {
    this.fileStore.removeSync(path);
  }
}
