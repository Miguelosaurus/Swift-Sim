import assert from "node:assert/strict";
import test from "node:test";
import { spawn, spawnSync } from "node:child_process";
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

test("ready-build handoff starts a stopped isolated helper through recovery and publishes the build", { timeout: 25000 }, async () => {
  const home = mkdtempSync(join(tmpdir(), "swift-sim-ready-helper-"));
  const reservation = createServer();
  reservation.listen(0, "127.0.0.1"); await once(reservation, "listening");
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const env = { ...process.env, HOME: home, SWIFT_SIM_PORT: String(port), SWIFT_SIM_MAC_NAME: "Fixture Mac" };
  delete env.SWIFT_SIM_MARKETPLACE_ROOT;
  delete env.SWIFT_SIM_HELPER_WAS_RUNNING;
  try {
    const script = `
      import assert from 'node:assert/strict';
      import { DeviceBuildStore } from ${JSON.stringify(new URL("../mac-helper/src/deviceBuildStore.js", import.meta.url).href)};
      import { PairingStore } from ${JSON.stringify(new URL("../mac-helper/src/pairingStore.js", import.meta.url).href)};
      import { announceReadyBuild } from ${JSON.stringify(new URL("../mac-helper/src/cliRuntimeBoundary.js", import.meta.url).href)};
      import { fetchActivityFeed } from ${JSON.stringify(new URL("../mac-helper/src/deliveryStatus.js", import.meta.url).href)};
      const pairing = new PairingStore().current();
      const store = new DeviceBuildStore({ maintenance: false });
      const build = store.create({ scheme: 'Fixture' });
      build.state = 'ready';
      build.remoteBaseUrl = 'https://fixture.invalid';
      build.artifacts.ipaPath = '/fixture/app.ipa';
      build.expiresAt = new Date(Date.now() + 60000).toISOString();
      store.save(build);
      await announceReadyBuild(build.id, { listBuilds: () => store.list(), loadPairing: () => pairing });
      const feed = await fetchActivityFeed(pairing);
      assert.equal(feed.events.find(event => event.buildId === build.id)?.kind, 'build-ready');
      console.log('published');
    `;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
      env, encoding: "utf8", timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), "published");
  } finally {
    const listener = spawnSync("/usr/sbin/lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { encoding: "utf8" });
    const pid = Number(listener.stdout.trim());
    if (pid > 1) {
      try { process.kill(-pid, "SIGTERM"); } catch {}
      for (let turn = 0; turn < 80; turn++) {
        try { process.kill(pid, 0); } catch { break; }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      try { process.kill(-pid, "SIGKILL"); } catch {}
    }
    rmSync(home, { recursive: true, force: true });
  }
});
