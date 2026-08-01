import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildPairingLinks } from "../mac-helper/src/links.js";
import { PairingStore } from "../mac-helper/src/pairingStore.js";

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
    const moduleURL = pathToFileURL(join(process.cwd(), "mac-helper/src/pairingStore.js")).href;
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
