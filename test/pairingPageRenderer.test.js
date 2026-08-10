import assert from "node:assert/strict";
import test from "node:test";
import { renderPairingPage } from "../mac-helper/src/http/pairingPageRenderer.js";

test("pairing page renderer preserves the existing invite deep link and escapes visible content", () => {
  const html = renderPairingPage({
    pairing: {
      installationID: "mac/id",
      macName: '<Desk & "Mac">',
      token: "must-not-be-used",
      invite: "invite value",
      expiresAt: "2026-08-10T19:00:00.000Z",
    },
    base: "https://desk-mac.tail.example/",
  });

  assert.match(html, /<title>Connect Swift Sim<\/title>/);
  assert.match(html, /Pair with &lt;Desk &amp; &quot;Mac&quot;&gt;/);
  assert.doesNotMatch(html, /Pair with <Desk/);
  assert.match(html, /swift-sim:\/\/pair\?invite=invite%20value/);
  assert.match(html, /macID=mac%2Fid/);
  assert.match(html, /base=https%3A%2F%2Fdesk-mac\.tail\.example/);
  assert.match(html, /expiresAt=2026-08-10T19%3A00%3A00\.000Z/);
  assert.doesNotMatch(html, /token=must-not-be-used/);
});

test("pairing page renderer preserves token links and the default Mac label", () => {
  const html = renderPairingPage({
    pairing: { installationID: "mac-1", token: "pair token" },
    base: "",
  });
  assert.match(html, /Pair with this Mac/);
  assert.match(html, /swift-sim:\/\/pair\?token=pair%20token&macID=mac-1/);
});
