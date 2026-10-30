import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PairingStore } from "../mac-helper/src/pairingStore.js";

for (const gateway of [false, true]) {
  test(`real helper composition ${gateway ? "hides public activity" : "authenticates private activity"}`, { timeout: 25_000 }, async () => {
    const home = mkdtempSync(join(tmpdir(), "swift-sim-activity-helper-"));
    const pairing = new PairingStore({ path: join(home, ".swift-sim", "pairing.json") }).current();
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const child = spawn(process.execPath, [new URL("../mac-helper/bin/swift-sim-helper-entry.js", import.meta.url).pathname, "serve", "--host", "127.0.0.1", "--port", String(port), ...(gateway ? ["--device-builds-only"] : [])], {
      env: { ...process.env, HOME: home, SWIFT_SIM_PORT: String(port), SWIFT_SIM_MAC_NAME: "Fixture Mac" },
      stdio: "ignore",
    });
    const exited = once(child, "exit");
    const request = (path, options = {}) => fetch(`http://127.0.0.1:${port}${path}`, { ...options, signal: AbortSignal.timeout(2000) });
    try {
      let ready = false;
      for (let turn = 0; turn < 60 && child.exitCode === null; turn++) {
        try { if ((await request("/health")).ok) { ready = true; break; } } catch {}
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.equal(ready, true, "isolated helper must start");
      const headers = { authorization: `Bearer ${pairing.token}`, "content-type": "application/json" };
      if (gateway) {
        for (const [path, method] of [["/api/activity", "GET"], ["/api/activity/device", "POST"], [`/api/activity/device/${randomUUID()}`, "DELETE"]]) {
          assert.equal((await request(path, { headers, method })).status, 404);
        }
      } else {
        assert.equal((await request("/api/activity")).status, 401);
        const feed = await request("/api/activity", { headers });
        assert.equal(feed.status, 200);
        const body = await feed.json();
        assert.equal(body.installationId, pairing.installationID);
        assert.deepEqual(body.events, []);
        assert.deepEqual(body.notificationStatus, { configured: false, reason: "APNS_NOT_CONFIGURED" });
        const deviceId = randomUUID();
        const registration = await request("/api/activity/device", { method: "POST", headers, body: JSON.stringify({ deviceId, environment: "sandbox", preferences: { queued: false } }) });
        assert.equal(registration.status, 200);
        const updated = await (await request(`/api/activity?deviceId=${deviceId}`, { headers })).json();
        assert.equal(updated.preferences.queued, false);
        assert.doesNotMatch(JSON.stringify(updated), new RegExp(pairing.token));
        assert.equal((await request(`/api/activity/device/${deviceId}`, { method: "DELETE", headers })).status, 200);
      }
    } finally {
      child.kill("SIGTERM");
      const force = setTimeout(() => child.kill("SIGKILL"), 9000);
      try { await exited; } finally { clearTimeout(force); rmSync(home, { recursive: true, force: true }); }
    }
  });
}
