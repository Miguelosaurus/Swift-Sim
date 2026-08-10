import assert from "node:assert/strict";
import test from "node:test";
import {
  appleAppSiteAssociation,
  renderDeviceBuildFallbackPage,
  renderSessionFallbackPage,
} from "../mac-helper/src/http/helperPresentation.js";

test("session fallback page preserves deep-link script and HTML escaping", () => {
  const customScheme = 'swiftsim://open?value=<unsafe>&quote="yes"';
  const html = renderSessionFallbackPage({ customScheme });
  assert.match(html, /<title>Swift Sim Session<\/title>/);
  assert.match(html, /Opening Swift Sim/);
  assert.ok(html.includes(JSON.stringify(customScheme)));
  assert.ok(html.includes("swiftsim://open?value=&lt;unsafe&gt;&amp;quote=&quot;yes&quot;"));
});

test("device build fallback page preserves ready, failed, warning, and install projections", () => {
  const baseBuild = {
    state: "ready",
    scheme: "Example",
    expiresAt: "2026-08-10T23:00:00.000Z",
    app: { name: "<Example & App>", bundleIdentifier: "dev.example.<unsafe>" },
    signing: { warnings: ["Signing <warning>"] },
  };
  const ready = renderDeviceBuildFallbackPage({
    build: baseBuild,
    links: {
      customScheme: "swiftsim://install?build=<one>",
      installURL: "itms-services://?url=<manifest>",
    },
  });
  assert.ok(ready.includes("<h1>&lt;Example &amp; App&gt;</h1>"));
  assert.ok(ready.includes("App ID: dev.example.&lt;unsafe&gt;"));
  assert.ok(ready.includes("Signing &lt;warning&gt;"));
  assert.ok(ready.includes("background: #34c759"));
  assert.ok(ready.includes("background: #1683ff"));
  assert.ok(ready.includes("swiftsim://install?build=&lt;one&gt;"));
  assert.ok(ready.includes("itms-services://?url=&lt;manifest&gt;"));

  const failed = renderDeviceBuildFallbackPage({
    build: { ...baseBuild, state: "failed", signing: { warnings: [] } },
    links: { customScheme: "swiftsim://install?build=failed" },
  });
  assert.ok(failed.includes("background: #ff3b30"));
  assert.ok(failed.includes("background: #8f98a3"));
  assert.ok(failed.includes('href="#"'));
});

test("apple app site association preserves session, pairing, and device-install components", () => {
  const association = appleAppSiteAssociation("TEAMID.dev.example.SwiftSim");
  assert.deepEqual(association, {
    applinks: {
      apps: [],
      details: [
        {
          appIDs: ["TEAMID.dev.example.SwiftSim"],
          components: [
            { "/": "/s/*", comment: "Open Swift Sim companion sessions." },
            { "/": "/pair", comment: "Pair Swift Sim companion with this Mac helper." },
            { "/": "/d/*", comment: "Open Swift Sim device build installs." },
          ],
        },
      ],
    },
  });
});
