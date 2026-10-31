import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appDisplayNameFromSettings, archivedAppDisplayName, builtAppDisplayName } from "../mac-helper/src/deviceBuildDisplayName.js";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-display-name-"));
  const app = join(root, "InternalTargetName.app"); mkdirSync(app);
  const path = join(app, "Info.plist");
  return { root, app, path, write(entries) {
    const xml = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    writeFileSync(path, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${Object.entries(entries).map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`).join("")}</dict></plist>`);
  }, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("build settings provide a human display name without unresolved variable or private-path output", () => {
  assert.equal(appDisplayNameFromSettings({ INFOPLIST_KEY_CFBundleDisplayName: "Swift Sim" }, "SwiftSimCompanion"), "Swift Sim");
  assert.equal(appDisplayNameFromSettings({ INFOPLIST_KEY_CFBundleDisplayName: "$(PRODUCT_NAME)", INFOPLIST_KEY_CFBundleName: "Zenics" }, "InternalTargetName"), "Zenics");
  assert.equal(appDisplayNameFromSettings({ INFOPLIST_KEY_CFBundleDisplayName: "/Users/private/project" }, "Example"), "Example");
  assert.equal(appDisplayNameFromSettings({}, "Example"), "Example");
  assert.equal(appDisplayNameFromSettings(null, "Example"), "Example");
});

test("packaged app display name takes precedence over its internal bundle and IPA filename", { skip: process.platform !== "darwin" }, () => {
  const f = fixture(); try {
    f.write({ CFBundleDisplayName: "Swift Sim", CFBundleName: "SwiftSimCompanion" });
    assert.equal(builtAppDisplayName(f.app, "SwiftSimCompanion"), "Swift Sim");
    f.write({ CFBundleDisplayName: "Zenics", CFBundleName: "ZenicsCalisthenicsVideo" });
    assert.equal(builtAppDisplayName(f.app, "ZenicsCalisthenicsVideo"), "Zenics");
    f.write({ CFBundleName: "Display Bundle Name" });
    assert.equal(builtAppDisplayName(f.app, "InternalTargetName"), "Display Bundle Name");
  } finally { f.cleanup(); }
});

test("missing, malformed, linked and oversized metadata retains a safe packaging fallback", { skip: process.platform !== "darwin" }, () => {
  const f = fixture(); try {
    assert.equal(builtAppDisplayName(f.app, "Example"), "Example");
    writeFileSync(f.path, "malformed"); assert.equal(builtAppDisplayName(f.app, "Example"), "Example");
    writeFileSync(f.path, "x".repeat(1024 * 1024 + 1)); assert.equal(builtAppDisplayName(f.app, "Example"), "Example");
    rmSync(f.path); symlinkSync(join(f.root, "foreign.plist"), f.path);
    writeFileSync(join(f.root, "foreign.plist"), "foreign metadata");
    assert.equal(builtAppDisplayName(f.app, "Example"), "Example");
    assert.equal(builtAppDisplayName(f.app, "/Users/private/fallback"), "");
  } finally { f.cleanup(); }
});

test("Release archives use the selected product's metadata and never traverse an arbitrary product path", { skip: process.platform !== "darwin" }, () => {
  const f = fixture(); try {
    const archive = join(f.root, "InternalScheme.xcarchive");
    const app = join(archive, "Products", "Applications", "DifferentProduct.app");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(app, "Info.plist"), '<plist version="1.0"><dict><key>CFBundleDisplayName</key><string>Swift Sim</string></dict></plist>');
    assert.equal(archivedAppDisplayName(archive, { FULL_PRODUCT_NAME: "DifferentProduct.app" }, "InternalScheme"), "Swift Sim");
    assert.equal(archivedAppDisplayName(archive, { WRAPPER_NAME: "DifferentProduct.app" }, "InternalScheme"), "Swift Sim");
    assert.equal(archivedAppDisplayName(archive, { FULL_PRODUCT_NAME: "../../foreign.app" }, "InternalScheme"), "InternalScheme");
    assert.equal(archivedAppDisplayName(archive, {}, "InternalScheme"), "InternalScheme");
    assert.equal(archivedAppDisplayName(undefined, { FULL_PRODUCT_NAME: "DifferentProduct.app" }, "InternalScheme"), "InternalScheme");
  } finally { f.cleanup(); }
});

test("unsafe compiled display text falls back to the bundle name, then the known build name", { skip: process.platform !== "darwin" }, () => {
  const f = fixture(); try {
    for (const name of ["/Users/private/project", "https://private.invalid", "Bearer secret", "token=secret", "x".repeat(61), "$(PRODUCT_NAME)", "Bad\nName"]) {
      f.write({ CFBundleDisplayName: name, CFBundleName: "Safe Name" });
      assert.equal(builtAppDisplayName(f.app, "Filename"), "Safe Name");
    }
    f.write({ CFBundleDisplayName: "${PRODUCT_NAME}", CFBundleName: "/private/project" });
    assert.equal(builtAppDisplayName(f.app, "Known Build Name"), "Known Build Name");
  } finally { f.cleanup(); }
});
