import { lstatSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { normalizedLiveBinaryIdentity } from "./liveBinaryIdentity.js";

const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const FOREGROUND = new Set([
  "waiting",
  "opening",
  "prompt-requested",
  "unconfirmed",
  "rejected",
  "cancelled",
  "expired",
]);

// Presentation only. No RPC, claim, install, signature scan, file write or new
// polling loop. Cache only compact fields; capability URLs/device IDs stay here.
export function createInstallPresentationReader({
  rootPath = join(homedir(), ".swift-sim"),
  now = () => Date.now(),
} = {}) {
  const cache = new Map();
  function privateStat(path, directory = false) {
    try {
      const s = lstatSync(path);
      if (
        s.isSymbolicLink() ||
        (directory ? !s.isDirectory() : !s.isFile()) ||
        s.uid !== process.getuid() ||
        s.mode & 0o077 ||
        (!directory && (s.nlink !== 1 || s.size > 1024 * 1024))
      )
        throw new Error("INSTALL_STATUS_UNAVAILABLE");
      return s;
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  }
  function read(path, parse, limit) {
    const s = privateStat(path);
    if (!s) {
      cache.delete(path);
      return [];
    }
    if (s.size > limit) throw new Error("INSTALL_STATUS_UNAVAILABLE");
    const key = [s.dev, s.ino, s.size, s.mtimeMs, s.ctimeMs].join(":");
    if (cache.get(path)?.key === key) return cache.get(path).value;
    const value = parse(JSON.parse(readFileSync(path, "utf8")));
    // Replacements during a read must not publish a mixed generation.
    const after = privateStat(path);
    if (
      !after ||
      [after.dev, after.ino, after.size, after.mtimeMs, after.ctimeMs].join(":") !== key
    )
      throw new Error("INSTALL_STATUS_UNAVAILABLE");
    cache.set(path, { key, value });
    return value;
  }
  function foreground(value) {
    if (!Array.isArray(value) || value.length > 32) throw new Error();
    const seen = new Set();
    return value.map((r) => {
      if (
        !UUID.test(r.id || "") ||
        seen.has(r.id) ||
        !FOREGROUND.has(r.state) ||
        typeof r.value !== "string" ||
        r.value.length > 4096 ||
        !Number.isFinite(r.expiresAt) ||
        typeof r.selector?.bundle_id !== "string"
      )
        throw new Error();
      if (
        Object.keys(r.selector).sort().join(",") !==
        "build_number,bundle_id,bundle_version,debug_dylib_uuid,executable_uuid"
      )
        throw new Error();
      normalizedLiveBinaryIdentity(r.selector);
      seen.add(r.id);
      const p = JSON.parse(r.value);
      if (
        p.buildID?.toLowerCase() !== r.id.toLowerCase() ||
        p.bundleID !== r.selector.bundle_id ||
        typeof p.version !== "string" ||
        p.version.length > 80 ||
        typeof p.build !== "string" ||
        p.build.length > 80 ||
        !/^[a-f0-9]{64}$/.test(p.sha256 || "")
      )
        throw new Error();
      return {
        id: r.id.toLowerCase(),
        state: r.state,
        expiresAt: r.expiresAt * 1000,
        bundle: p.bundleID,
        version: p.version,
        build: p.build,
      };
    });
  }
  function native(value) {
    if (
      value?.schema !== 1 ||
      !value.entries ||
      typeof value.entries !== "object" ||
      Array.isArray(value.entries) ||
      Object.keys(value.entries).length > 128
    )
      throw new Error();
    return Object.entries(value.entries).map(([key, r]) => {
      if (
        !UUID.test(key) ||
        r.buildID !== key ||
        !["submitting", "installed", "installed-version-observed"].includes(r.state) ||
        !r.identity ||
        !["bundle", "version", "build"].every(
          (k) =>
            typeof r.identity[k] === "string" &&
            r.identity[k].length > 0 &&
            r.identity[k].length <= 256,
        )
      )
        throw new Error();
      return {
        id: key.toLowerCase(),
        state: r.state === "submitting" ? "unconfirmed" : "confirming",
        bundle: r.identity.bundle,
        version: r.identity.version,
        build: r.identity.build,
      };
    });
  }
  return (builds) => {
    const targets = builds
      .filter(
        (b) =>
          b.state === "ready" &&
          !["verified", "launch-confirmed"].includes(b.installation?.state) &&
          UUID.test(b.id || ""),
      )
      .slice(0, 500);
    const result = new Map();
    const files = new Set();
    if (!targets.length) {
      cache.clear();
      return result;
    }
    const unavailable = (rows) => {
      for (const b of rows) result.set(b.id, { state: "unavailable" });
    };
    try {
      privateStat(rootPath, true);
      const path = join(rootPath, "install-requests.json");
      files.add(path);
      for (const r of read(path, foreground, 196608)) {
        const b = targets.find(
          (b) =>
            b.id === r.id &&
            b.app?.bundleIdentifier === r.bundle &&
            b.app?.version === r.version &&
            b.app?.build === r.build,
        );
        if (b)
          result.set(b.id, {
            state: r.state === "waiting" && r.expiresAt <= now() ? "expired" : r.state,
          });
      }
    } catch {
      unavailable(targets);
    }
    const directory = join(rootPath, "native-build-delivery");
    const groups = new Map();
    for (const b of targets)
      if (b.app?.teamID && b.app?.bundleIdentifier) {
        const key = createHash("sha256")
          .update(b.app.teamID + ":" + b.app.bundleIdentifier)
          .digest("hex");
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(b);
      }
    for (const rows of [...groups.values()].slice(128)) unavailable(rows);
    let bytes = 0;
    try {
      privateStat(directory, true);
      for (const [key, rows] of [...groups].slice(0, 128)) {
        const path = join(directory, key + ".json");
        files.add(path);
        try {
          const size = privateStat(path)?.size || 0;
          bytes += size;
          if (bytes > 4 * 1024 * 1024) throw new Error();
          for (const r of read(path, native, 1024 * 1024)) {
            const b = rows.find(
              (b) =>
                b.id === r.id &&
                b.app.bundleIdentifier === r.bundle &&
                b.app.version === r.version &&
                b.app.build === r.build,
            );
            if (b && !result.has(b.id)) result.set(b.id, { state: r.state });
          }
        } catch {
          unavailable(rows);
        }
      }
    } catch {
      unavailable(targets);
    }
    for (const key of cache.keys()) if (!files.has(key)) cache.delete(key);
    return result;
  };
}
