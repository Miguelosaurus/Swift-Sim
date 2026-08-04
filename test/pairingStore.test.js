import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPairingLinks } from "../mac-helper/src/links.js";
import { PairingStore } from "../mac-helper/src/pairingStore.js";
import { PairingInviteStore } from "../mac-helper/src/pairingInviteStore.js";

const execFileAsync = promisify(execFile);

test("pairing token rotation preserves the helper installation identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-store-"));
  try {
    const path = join(directory, "pairing.json");
    const store = new PairingStore({ path });
    const first = store.current();
    const second = store.rotate();
    assert.notEqual(first.token, second.token);
    assert.equal(first.installationID, second.installationID);

    const restarted = new PairingStore({ path }).current();
    assert.equal(restarted.installationID, first.installationID);
    assert.equal(restarted.token, second.token);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy pairing state is migrated to a persistent installation identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-migration-"));
  try {
    const path = join(directory, "pairing.json");
    writeFileSync(path, JSON.stringify({
      token: "legacy-token",
      macName: "Legacy Mac",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z",
    }));
    const pairing = new PairingStore({ path }).current();
    assert.ok(pairing.installationID);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).installationID, pairing.installationID);
    assert.deepEqual(readdirSync(directory), ["pairing.json"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed pairing state fails closed without rotating identity", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-corrupt-"));
  try {
    const path = join(directory, "pairing.json");
    writeFileSync(path, "{not-json");
    assert.throws(() => new PairingStore({ path }), /will not rotate the helper identity automatically/);
    assert.equal(readFileSync(path, "utf8"), "{not-json");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pairing tokens use a length-safe constant-time comparison", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-token-"));
  try {
    const store = new PairingStore({ path: join(directory, "pairing.json") });
    const pairing = store.current();
    assert.equal(store.tokenMatches(pairing.token), true);
    assert.equal(store.tokenMatches(`${pairing.token}x`), false);
    assert.equal(store.tokenMatches(""), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("concurrent first-use pairing readers converge on one credential", async () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-concurrent-"));
  try {
    const path = join(directory, "pairing.json");
    const moduleURL = new URL("../mac-helper/src/pairingStore.js", import.meta.url).href;
    const script = `
      import { PairingStore } from ${JSON.stringify(moduleURL)};
      process.stdout.write(JSON.stringify(new PairingStore({ path: process.argv[1] }).current()));
    `;
    const outputs = await Promise.all(Array.from({ length: 4 }, () =>
      execFileAsync(process.execPath, ["--input-type=module", "-e", script, path], {
        cwd: process.cwd(),
        encoding: "utf8",
      })
    ));
    const records = outputs.map(({ stdout }) => JSON.parse(stdout));
    const persisted = JSON.parse(readFileSync(path, "utf8"));
    for (const record of records) {
      assert.equal(record.token, persisted.token);
      assert.equal(record.installationID, persisted.installationID);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pairing links carry stable identity and preserve the external base URL", () => {
  const links = buildPairingLinks({
    token: "pair-token",
    installationID: "helper-installation-id",
  }, "https://mac.example.test");
  assert.match(links.universalLink, /macID=helper-installation-id/);
  assert.match(links.universalLink, /base=https%3A%2F%2Fmac\.example\.test/);
  assert.match(links.customScheme, /macID=helper-installation-id/);
});

test("pairing invitations are short-lived, one-time, and idempotent for the same client", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-invite-"));
  let now = Date.parse("2026-08-02T10:00:00.000Z");
  try {
    const store = new PairingInviteStore({
      path: join(directory, "pairing-invites.json"),
      ttlMs: 60_000,
      now: () => now,
    });
    const pairing = { token: "durable-token", installationID: "mac-id", macName: "Mac" };
    const created = store.create({ pairing });
    assert.equal(store.inspect(created.invite)?.claimed, false);
    assert.deepEqual(store.claim(created.invite, "short", pairing), { ok: false, code: "malformed" });

    const first = store.claim(created.invite, "client-a", pairing);
    assert.equal(first.ok, true);
    assert.equal(first.idempotent, false);
    assert.equal(first.pairing.token, pairing.token);

    const retry = store.claim(created.invite, "client-a", pairing);
    assert.equal(retry.ok, true);
    assert.equal(retry.idempotent, true);

    const other = store.claim(created.invite, "client-b", pairing);
    assert.deepEqual(other, { ok: false, code: "consumed" });

    now += 61_000;
    assert.equal(store.inspect(created.invite), null);

    assert.throws(() => store.create({ pairing, ttlMs: 16 * 60 * 1000 }), /between 1 and 15 minutes/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pairing invitations reject a replaced helper installation", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-invite-binding-"));
  try {
    const store = new PairingInviteStore({ path: join(directory, "pairing-invites.json") });
    const created = store.create({
      pairing: { token: "durable-token", installationID: "old-mac-id" },
    });
    assert.deepEqual(
      store.claim(created.invite, "client-a", { token: "new-token", installationID: "new-mac-id" }),
      { ok: false, code: "expired" },
    );
    assert.equal(store.inspect(created.invite)?.claimed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pairing invitations reclaim a dead writer lock", () => {
  const directory = mkdtempSync(join(tmpdir(), "swift-sim-pairing-invite-lock-"));
  try {
    const path = join(directory, "pairing-invites.json");
    const lock = `${path}.lock`;
    mkdirSync(lock);
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ pid: -1, nonce: "dead" }));
    const store = new PairingInviteStore({ path });
    const created = store.create({
      pairing: { token: "durable-token", installationID: "mac-id" },
    });
    assert.match(created.invite, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(store.inspect(created.invite)?.claimed, false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("pairing invitation links never contain the durable helper token", () => {
  const links = buildPairingLinks({
    token: "durable-token",
    invite: "temporary-invite",
    expiresAt: "2026-08-02T10:05:00.000Z",
    installationID: "mac-id",
    macName: "Example Mac",
  }, "https://mac.example.ts.net");
  assert.match(links.universalLink, /invite=temporary-invite/);
  assert.doesNotMatch(links.universalLink, /durable-token/);
  assert.match(links.customScheme, /invite=temporary-invite/);
  assert.doesNotMatch(links.customScheme, /durable-token/);
});
