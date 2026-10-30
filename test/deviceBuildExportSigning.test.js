import test from "node:test";
import assert from "node:assert/strict";
import { exportOptionsPlist } from "../mac-helper/src/deviceBuilderCore.js";

const build = { exportMethod: "ad-hoc", app: { bundleIdentifier: "com.example.app", teamID: "EXAMPLE123" }, signing: {} };
test("automatic export keeps the automatic profile-selection flow", () => {
  const xml = exportOptionsPlist(build, { CODE_SIGN_STYLE: "Automatic", PROVISIONING_PROFILE_SPECIFIER: "ignored" });
  assert.match(xml, /<key>method<\/key>\s*<string>ad-hoc<\/string>/);
  assert.match(xml, /<key>signingStyle<\/key>\s*<string>automatic<\/string>/);
  assert.doesNotMatch(xml, /provisioningProfiles|signingCertificate/);
});
test("manual export retains the resolved profile, exact app and certificate without account lookup", () => {
  const xml = exportOptionsPlist({ ...build, buildSettings: ["CODE_SIGN_STYLE=Automatic", "PROVISIONING_PROFILE_SPECIFIER=stale"] }, { CODE_SIGN_STYLE: "Manual", PROVISIONING_PROFILE_SPECIFIER: "Push & OTA", EXPANDED_CODE_SIGN_IDENTITY: "a".repeat(40) });
  assert.match(xml, /<key>signingStyle<\/key>\s*<string>manual<\/string>/);
  assert.match(xml, /<key>com.example.app<\/key><string>Push &amp; OTA<\/string>/);
  assert.match(xml, new RegExp(`<key>signingCertificate</key><string>${"a".repeat(40)}</string>`));
  assert.doesNotMatch(xml, /stale|automatic/);
});
test("manual CLI overrides use the final profile setting and support UUID selectors", () => {
  const xml = exportOptionsPlist({ ...build, buildSettings: ["CODE_SIGN_STYLE=Manual", "PROVISIONING_PROFILE=old", "PROVISIONING_PROFILE=exact-profile", "CODE_SIGN_IDENTITY=Apple Distribution"] });
  assert.match(xml, /<key>com.example.app<\/key><string>exact-profile<\/string>/);
  assert.match(xml, /<key>signingCertificate<\/key><string>Apple Distribution<\/string>/);
  assert.doesNotMatch(xml, /<string>old<\/string>/);
});
test("incomplete manual export cannot fall back to automatic signing or a different app", () => {
  assert.throws(() => exportOptionsPlist(build, { CODE_SIGN_STYLE: "Manual" }), /Manual signing requires/);
  assert.throws(() => exportOptionsPlist({ ...build, app: {} }, { CODE_SIGN_STYLE: "Manual", PROVISIONING_PROFILE_SPECIFIER: "profile" }), /exact app bundle/);
});
