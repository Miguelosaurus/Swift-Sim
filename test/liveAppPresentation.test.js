import assert from "node:assert/strict";
import test from "node:test";
import { liveAppPresentation } from "../mac-helper/src/liveReload.js";

const info = { CFBundleDisplayName: "Example", CFBundleURLTypes: [{ CFBundleURLSchemes: ["example"] }] };
test("signed presentation requires explicit launch opt-in and declared scheme", () => {
  assert.deepEqual(liveAppPresentation(info), { targetAppName: "Example" });
  assert.deepEqual(liveAppPresentation({ ...info, SwiftSimLaunchURL: "example://home" }), { targetAppName: "Example", launchURL: "example://home" });
  assert.deepEqual(liveAppPresentation({ ...info, SwiftSimLaunchURL: "other://home" }), { targetAppName: "Example" });
});
test("launch handoff excludes credentials, callbacks, system schemes and oversized input", () => {
  for (const value of ["example://user:secret@home", "example://home?token=secret", "example://home#secret", "example://home\n", `example://${"a".repeat(600)}`, "https://example.com", "itms-services://home", "swiftsim://home"]) {
    const scheme = value.split(":")[0];
    const candidate = { ...info, CFBundleURLTypes: [{ CFBundleURLSchemes: [scheme] }], SwiftSimLaunchURL: value };
    assert.deepEqual(liveAppPresentation(candidate), { targetAppName: "Example" });
  }
});
