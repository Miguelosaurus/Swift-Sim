// @ts-check
import { randomUUID } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { link, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** @typedef {import("./ports.js").AtomicFileStore} AtomicFileStore */
/** @typedef {import("./ports.js").AtomicWriteOptions} AtomicWriteOptions */

/** @implements {AtomicFileStore} */
export class NodeAtomicFileStore {
  /** @param {string} path */
  async readText(path) {
    return readFile(path, "utf8");
  }

  /** @param {string} path */
  readTextSync(path) {
    return readFileSync(path, "utf8");
  }

  /** @param {string} path */
  async readJSON(path) {
    return JSON.parse(await this.readText(path));
  }

  /** @param {string} path */
  readJSONSync(path) {
    return JSON.parse(this.readTextSync(path));
  }

  /**
   * @param {string} path
   * @param {string} value
   * @param {AtomicWriteOptions} options
   */
  async writeText(path, value, options) {
    await writeAtomic(path, value, options);
  }

  /**
   * @param {string} path
   * @param {string} value
   * @param {AtomicWriteOptions} options
   */
  writeTextSync(path, value, options) {
    writeAtomicSync(path, value, options);
  }

  /**
   * @param {string} path
   * @param {unknown} value
   * @param {AtomicWriteOptions} options
   */
  async writeJSON(path, value, options) {
    await this.writeText(path, serializeJSON(value), options);
  }

  /**
   * @param {string} path
   * @param {unknown} value
   * @param {AtomicWriteOptions} options
   */
  writeJSONSync(path, value, options) {
    this.writeTextSync(path, serializeJSON(value), options);
  }

  /** @param {string} path */
  async remove(path) {
    await rm(path, { force: true });
  }

  /** @param {string} path */
  removeSync(path) {
    rmSync(path, { force: true });
  }
}

/**
 * @param {string} path
 * @param {string} value
 * @param {AtomicWriteOptions} options
 */
async function writeAtomic(path, value, options) {
  const normalized = normalizeWrite(path, options);
  await mkdir(normalized.parent, {
    recursive: true,
    mode: normalized.createParentMode,
  });
  const temporaryPath = temporaryPathFor(path);
  /** @type {import("node:fs/promises").FileHandle | undefined} */
  let handle;
  try {
    handle = await open(temporaryPath, "wx", normalized.mode);
    await handle.writeFile(value, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    if (normalized.replace) {
      await rename(temporaryPath, path);
    } else {
      await link(temporaryPath, path);
      await removeTemporaryFile(temporaryPath);
    }
    if (normalized.syncDirectory) await syncDirectory(normalized.parent);
  } catch (error) {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
    await removeTemporaryFile(temporaryPath);
    throw error;
  }
}

/**
 * @param {string} path
 * @param {string} value
 * @param {AtomicWriteOptions} options
 */
function writeAtomicSync(path, value, options) {
  const normalized = normalizeWrite(path, options);
  mkdirSync(normalized.parent, {
    recursive: true,
    mode: normalized.createParentMode,
  });
  const temporaryPath = temporaryPathFor(path);
  /** @type {number | undefined} */
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", normalized.mode);
    writeFileSync(descriptor, value, "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (normalized.replace) {
      renameSync(temporaryPath, path);
    } else {
      linkSync(temporaryPath, path);
      removeTemporaryFileSync(temporaryPath);
    }
    if (normalized.syncDirectory) syncDirectorySync(normalized.parent);
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
    removeTemporaryFileSync(temporaryPath);
    throw error;
  }
}

/**
 * @param {string} path
 * @param {AtomicWriteOptions} options
 */
function normalizeWrite(path, options) {
  if (typeof path !== "string" || !path) {
    throw new TypeError("Atomic file path must be a non-empty string.");
  }
  if (!options || typeof options !== "object") {
    throw new TypeError("Atomic write options are required.");
  }
  if (typeof options.replace !== "boolean" || typeof options.syncDirectory !== "boolean") {
    throw new TypeError("Atomic replace and syncDirectory options must be booleans.");
  }
  return {
    parent: dirname(path),
    mode: normalizeMode(options.mode, "file"),
    createParentMode: normalizeMode(options.createParentMode, "parent directory"),
    replace: options.replace,
    syncDirectory: options.syncDirectory,
  };
}

/** @param {number} mode @param {string} label */
function normalizeMode(mode, label) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    throw new RangeError(`Atomic ${label} mode must be an integer from 0 to 0777.`);
  }
  return mode;
}

/** @param {unknown} value */
function serializeJSON(value) {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) {
    throw new TypeError("Atomic JSON value must be serializable.");
  }
  return serialized;
}

/** @param {string} path */
function temporaryPathFor(path) {
  return `${path}.${process.pid}.${randomUUID()}.tmp`;
}

/** @param {string} path */
async function removeTemporaryFile(path) {
  try {
    await rm(path, { force: true });
  } catch {
    // Publication may already have succeeded through a hard link. A leftover
    // randomized temporary name is safer than reporting a false write failure.
  }
}

/** @param {string} path */
function removeTemporaryFileSync(path) {
  try {
    rmSync(path, { force: true });
  } catch {
    // Publication may already have succeeded through a hard link. A leftover
    // randomized temporary name is safer than reporting a false write failure.
  }
}

/** @param {string} path */
async function syncDirectory(path) {
  let handle;
  try {
    handle = await open(path, "r");
    await handle.sync();
  } catch {
    // The published file itself is already synced. Some filesystems reject
    // directory fsync, so directory syncing remains best-effort.
  } finally {
    if (handle) {
      try {
        await handle.close();
      } catch {}
    }
  }
}

/** @param {string} path */
function syncDirectorySync(path) {
  /** @type {number | undefined} */
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // The published file itself is already synced. Some filesystems reject
    // directory fsync, so directory syncing remains best-effort.
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {}
    }
  }
}
