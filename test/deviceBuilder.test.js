import test from "node:test";
import assert from "node:assert/strict";
import { buildManifest, deviceBuildLinks, publicDeviceBuild } from "../mac-helper/src/deviceBuilder.js";

function fixtureBuild() {
  return {
    id: "build-123",
    token: "secret-token",
    remoteBaseUrl: "https://mac.example.ts.net",
    scheme: "Example",
    configuration: "Debug",
    buildSettings: ["OTHER_LDFLAGS=$(inherited) -Xlinker -interposable"],
    state: "ready",
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
    expiresAt: "2026-06-25T00:30:00.000Z",
    preserveData: true,
    delivery: {
      mode: "quick-tunnel",
      provider: "cloudflare-quick-tunnel",
      expiresAt: "2026-06-25T00:30:00.000Z",
    },
    app: {
      identity: "app-identity",
      name: "Example App",
      bundleIdentifier: "com.example.app",
      version: "1.0",
      build: "42",
      teamID: "TEAM123",
    },
    signing: {
      method: "development",
      deviceInstallable: true,
      updateSafe: "same-bundle-update",
      warnings: ["App data is preserved only when signing stays compatible."],
    },
    installation: {
      state: "requested",
      requestedAt: "2026-06-25T00:10:00.000Z",
      verifiedAt: "",
      devices: [],
    },
  };
}

test("device build links use opaque id and token", () => {
  const links = deviceBuildLinks(fixtureBuild());
  assert.equal(
    links.universalLink,
    "https://mac.example.ts.net/d/build-123?token=secret-token"
  );
  assert.equal(
    links.customScheme,
    "swift-sim://device-build/build-123?token=secret-token&base=https%3A%2F%2Fmac.example.ts.net"
  );
  assert.match(links.installURL, /^itms-services:\/\/\?action=download-manifest&url=/);
});

test("device build manifest points at authenticated IPA artifact", () => {
  const manifest = buildManifest(fixtureBuild());
  assert.match(manifest, /<key>bundle-identifier<\/key>\s*<string>com\.example\.app<\/string>/);
  assert.match(manifest, /<key>bundle-version<\/key>\s*<string>42<\/string>/);
  assert.match(
    manifest,
    /https:\/\/mac\.example\.ts\.net\/api\/device-builds\/build-123\/artifact\/ipa\?token=secret-token/
  );
});

test("public device build hides artifact paths", () => {
  const publicBuild = publicDeviceBuild({
    ...fixtureBuild(),
    artifacts: {
      ipaPath: "/Users/example/private/App.ipa",
      archivePath: "/Users/example/private/App.xcarchive",
    },
  });
  assert.equal(publicBuild.app.bundleIdentifier, "com.example.app");
  assert.equal(publicBuild.links.universalLink, "https://mac.example.ts.net/d/build-123?token=secret-token");
  assert.equal(publicBuild.delivery.mode, "quick-tunnel");
  assert.equal(publicBuild.installation.state, "requested");
  assert.equal(publicBuild.configuration, "Debug");
  assert.equal(publicBuild.liveReload.eligible, true);
  assert.equal(JSON.stringify(publicBuild).includes("/Users/example"), false);
});
