// @ts-check
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync,
} from "node:fs";
import { lstat, mkdir, open, rm } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** @typedef {import("./ports.js").ArtifactStore} ArtifactStore */
/** @typedef {import("./ports.js").ArtifactWriteOptions} ArtifactWriteOptions */
/** @typedef {{ device: string, inode: string }} RootIdentity */
/** @typedef {{ root: string, path: string, rootIdentity: RootIdentity }} ApprovedArtifactPath */

/** @implements {ArtifactStore} */
export class NodeArtifactStore {
  constructor() {
    /** @type {Map<string, ApprovedArtifactPath>} */
    this.approvedPaths = new Map();
  }

  /** @param {string} root @param {string} candidate */
  resolveContained(root, candidate) {
    const resolvedRoot = normalizeAbsoluteRoot(root);
    const rootStat = lstatSync(resolvedRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw invalidArtifactPathError();
    const resolvedCandidate = isAbsolute(candidate)
      ? resolve(candidate)
      : resolve(resolvedRoot, candidate);
    if (!isContained(resolvedRoot, resolvedCandidate)) throw invalidArtifactPathError();
    const approved = {
      root: resolvedRoot,
      path: resolvedCandidate,
      rootIdentity: identityOf(rootStat),
    };
    assertApprovedComponentsSync(approved);
    this.approvedPaths.set(resolvedCandidate, approved);
    return resolvedCandidate;
  }

  /** @param {string} path @param {number} mode */
  async createDirectory(path, mode) {
    const approved = this.approved(path);
    const normalizedMode = normalizeMode(mode, "directory");
    await assertApprovedComponents(approved);
    await mkdir(approved.path, { recursive: true, mode: normalizedMode });
    await assertApprovedComponents(approved);
  }

  /** @param {string} path @param {number} mode */
  createDirectorySync(path, mode) {
    const approved = this.approved(path);
    const normalizedMode = normalizeMode(mode, "directory");
    assertApprovedComponentsSync(approved);
    mkdirSync(approved.path, { recursive: true, mode: normalizedMode });
    assertApprovedComponentsSync(approved);
  }

  /**
   * @param {string} path
   * @param {string | Uint8Array} value
   * @param {ArtifactWriteOptions} options
   */
  async write(path, value, options) {
    const approved = this.approved(path);
    const normalized = normalizeWriteOptions(options);
    await assertApprovedComponents(approved);
    const handle = await open(approved.path, writeFlags(normalized.replace), normalized.mode);
    try {
      await handle.writeFile(value);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }

  /**
   * @param {string} path
   * @param {string | Uint8Array} value
   * @param {ArtifactWriteOptions} options
   */
  writeSync(path, value, options) {
    const approved = this.approved(path);
    const normalized = normalizeWriteOptions(options);
    assertApprovedComponentsSync(approved);
    const descriptor = openSync(approved.path, writeFlags(normalized.replace), normalized.mode);
    try {
      const buffer = Buffer.from(value);
      let offset = 0;
      while (offset < buffer.length) {
        const written = writeSync(descriptor, buffer, offset, buffer.length - offset);
        if (written <= 0) throw new Error("Artifact write made no forward progress.");
        offset += written;
      }
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  /** @param {string} path */
  async read(path) {
    const approved = this.approved(path);
    await assertApprovedComponents(approved);
    const handle = await open(approved.path, constants.O_RDONLY | noFollowFlag());
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  }

  /** @param {string} path */
  readSync(path) {
    const approved = this.approved(path);
    assertApprovedComponentsSync(approved);
    const descriptor = openSync(approved.path, constants.O_RDONLY | noFollowFlag());
    try {
      return new Uint8Array(readFileSync(descriptor));
    } finally {
      closeSync(descriptor);
    }
  }

  /** @param {string} path */
  async removeTree(path) {
    const approved = this.approved(path);
    await assertApprovedComponents(approved);
    await rm(approved.path, { recursive: true, force: true });
  }

  /** @param {string} path */
  removeTreeSync(path) {
    const approved = this.approved(path);
    assertApprovedComponentsSync(approved);
    rmSync(approved.path, { recursive: true, force: true });
  }

  /** @param {string} path */
  approved(path) {
    const resolved = resolve(String(path || ""));
    const approved = this.approvedPaths.get(resolved);
    if (!approved || approved.path !== resolved) throw invalidArtifactPathError();
    return approved;
  }
}

/** @param {string} root */
function normalizeAbsoluteRoot(root) {
  if (typeof root !== "string" || !root || !isAbsolute(root)) {
    throw invalidArtifactPathError();
  }
  return resolve(root);
}

/** @param {string} root @param {string} candidate */
function isContained(root, candidate) {
  if (candidate === root) return true;
  const child = relative(root, candidate);
  return Boolean(child && !isAbsolute(child) && child !== ".." && !child.startsWith(`..${sep}`));
}

/** @param {ApprovedArtifactPath} approved */
async function assertApprovedComponents(approved) {
  const paths = componentPaths(approved.root, approved.path);
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    try {
      const stat = await lstat(path);
      if (stat.isSymbolicLink()) throw invalidArtifactPathError();
      if (index === 0 && !sameIdentity(identityOf(stat), approved.rootIdentity)) {
        throw invalidArtifactPathError();
      }
    } catch (error) {
      if (index > 0 && hasCode(error, "ENOENT")) return;
      throw error;
    }
  }
}

/** @param {ApprovedArtifactPath} approved */
function assertApprovedComponentsSync(approved) {
  const paths = componentPaths(approved.root, approved.path);
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index];
    try {
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) throw invalidArtifactPathError();
      if (index === 0 && !sameIdentity(identityOf(stat), approved.rootIdentity)) {
        throw invalidArtifactPathError();
      }
    } catch (error) {
      if (index > 0 && hasCode(error, "ENOENT")) return;
      throw error;
    }
  }
}

/** @param {string} root @param {string} candidate */
function componentPaths(root, candidate) {
  const child = relative(root, candidate);
  const parts = child ? child.split(sep).filter(Boolean) : [];
  const result = [root];
  let current = root;
  for (const part of parts) {
    current = resolve(current, part);
    result.push(current);
  }
  return result;
}

/** @param {import("node:fs").Stats} stat */
function identityOf(stat) {
  return { device: String(stat.dev), inode: String(stat.ino) };
}

/** @param {RootIdentity} left @param {RootIdentity} right */
function sameIdentity(left, right) {
  return left.device === right.device && left.inode === right.inode;
}

/** @param {ArtifactWriteOptions} options */
function normalizeWriteOptions(options) {
  if (!options || typeof options !== "object" || typeof options.replace !== "boolean") {
    throw new TypeError("Artifact write options require a boolean replace value.");
  }
  return {
    mode: normalizeMode(options.mode, "file"),
    replace: options.replace,
  };
}

/** @param {number} mode @param {string} label */
function normalizeMode(mode, label) {
  if (!Number.isInteger(mode) || mode < 0 || mode > 0o777) {
    throw new RangeError(`Artifact ${label} mode must be an integer from 0 to 0777.`);
  }
  return mode;
}

/** @param {boolean} replace */
function writeFlags(replace) {
  return (
    constants.O_WRONLY |
    constants.O_CREAT |
    noFollowFlag() |
    (replace ? constants.O_TRUNC : constants.O_EXCL)
  );
}

function noFollowFlag() {
  return constants.O_NOFOLLOW || 0;
}

function invalidArtifactPathError() {
  const error = /** @type {Error & { code: string }} */ (
    new Error("Swift Sim refused an artifact path outside its approved private root.")
  );
  error.code = "SWIFT_SIM_ARTIFACT_PATH_INVALID";
  return error;
}

/** @param {unknown} error @param {string} code */
function hasCode(error, code) {
  if (!error || typeof error !== "object") return false;
  return /** @type {{ code?: unknown }} */ (error).code === code;
}
