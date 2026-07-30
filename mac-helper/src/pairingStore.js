import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
    return this.pairing;
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
    return this.pairing;
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
    return Boolean(token && token === this.current().token);
  }

  load() {
    try {
      const parsed = JSON.parse(readFileSync(this.path, "utf8"));
      if (!parsed || typeof parsed !== "object" || !parsed.token) {
        this.pairing = undefined;
        return;
      }
      this.pairing = {
        ...parsed,
        installationID: parsed.installationID || randomUUID(),
      };
      if (!parsed.installationID) this.flush();
    } catch {
      this.pairing = undefined;
    }
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    writeFileSync(this.path, JSON.stringify(this.pairing, null, 2), { mode: 0o600 });
  }
}
