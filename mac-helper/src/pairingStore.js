import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { homedir, hostname } from "node:os";

export class PairingStore {
  constructor({ path = join(homedir(), ".swift-sim", "pairing.json") } = {}) {
    this.path = path;
    this.pairing = undefined;
    this.load();
  }

  current() {
    this.load();
    if (!this.pairing) {
      return this.rotate();
    }
    return structuredClone(this.pairing);
  }

  rotate() {
    const now = new Date().toISOString();
    this.pairing = {
      token: randomBytes(32).toString("base64url"),
      installationID: this.pairing?.installationID || randomUUID(),
      macName: process.env.SWIFT_SIM_MAC_NAME || hostname(),
      createdAt: this.pairing?.createdAt || now,
      updatedAt: now,
    };
    this.flush();
    return structuredClone(this.pairing);
  }

  status() {
    const pairing = this.current();
    return {
      ok: true,
      installationID: pairing.installationID,
      macName: pairing.macName,
      helper: "swift-sim-helper",
      updatedAt: pairing.updatedAt,
    };
  }

  tokenMatches(token) {
    const expected = this.current().token;
    if (!expected || !token) return false;
    const expectedBuffer = Buffer.from(String(expected), "utf8");
    const actualBuffer = Buffer.from(String(token), "utf8");
    return expectedBuffer.length === actualBuffer.length
      && timingSafeEqual(expectedBuffer, actualBuffer);
  }

  load() {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(this.path, "utf8"));
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.pairing = undefined;
        return;
      }
      throw pairingStateError(this.path, error);
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
        || typeof parsed.token !== "string" || !parsed.token
        || (parsed.installationID !== undefined
          && (typeof parsed.installationID !== "string" || !parsed.installationID))) {
      throw pairingStateError(this.path, new Error("the stored pairing record is malformed"));
    }

    this.pairing = {
      token: parsed.token,
      installationID: parsed.installationID || randomUUID(),
      macName: typeof parsed.macName === "string" && parsed.macName
        ? parsed.macName
        : process.env.SWIFT_SIM_MAC_NAME || hostname(),
      createdAt: typeof parsed.createdAt === "string" && parsed.createdAt
        ? parsed.createdAt
        : new Date().toISOString(),
      updatedAt: typeof parsed.updatedAt === "string" && parsed.updatedAt
        ? parsed.updatedAt
        : new Date().toISOString(),
    };
    if (!parsed.installationID) this.flush();
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = openSync(temporaryPath, "wx", 0o600);
      writeFileSync(descriptor, JSON.stringify(this.pairing, null, 2), "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporaryPath, this.path);
      syncDirectory(dirname(this.path));
    } catch (error) {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch {}
      }
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }
}

function syncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch {
    // The file itself is already synced. Some filesystems do not permit
    // fsync on a directory, so directory syncing is best-effort only.
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch {}
    }
  }
}

function pairingStateError(path, error) {
  return new Error(
    `Unable to read Swift Sim pairing state at ${path}: ${error instanceof Error ? error.message : String(error)}. `
      + "Swift Sim will not rotate the helper identity automatically. Restore or remove this file explicitly."
  );
}
