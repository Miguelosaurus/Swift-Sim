import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appIconSource,
  captureBuildIcon,
  readBuildIcon,
} from "../mac-helper/src/deviceBuildIcon.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-icons-"));
  const app = join(root, "App.app");
  const artifacts = join(root, "build-1");
  mkdirSync(app);
  mkdirSync(artifacts);
  writeFileSync(join(app, "Info.plist"), "fixture");
  writeFileSync(join(app, "AppIcon60@2x.png"), png);
  const info = { CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconFiles: ["AppIcon60"] } } };
  return {
    root,
    app,
    artifacts,
    info,
    build: { id: "build-1", app: { name: "Example" }, artifacts: { root: artifacts } },
    options: {
      readInfo: () => info,
      reserve: (p) => writeFileSync(p, "", { flag: "wx", mode: 0o600 }),
      convert: async (_, p) => {
        writeFileSync(p, png);
        return true;
      },
      publish: renameSync,
      discard: (p) => rmSync(p),
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
test("a declared compiled icon becomes a small digest-bound artifact with a stable content digest", async () => {
  const f = fixture();
  try {
    assert.equal(appIconSource(f.app, f.info), join(f.app, "AppIcon60@2x.png"));
    assert.equal(await captureBuildIcon(f.build, f.app, f.options), true);
    assert.equal(f.build.app.iconDigest, createHash("sha256").update(png).digest("hex"));
    assert.deepEqual(readBuildIcon(f.build, { rootPath: f.root }), png);
    writeFileSync(join(f.artifacts, "app-icon.png"), Buffer.from("changed"));
    assert.equal(readBuildIcon(f.build, { rootPath: f.root }), null);
  } finally {
    f.cleanup();
  }
});
test("icon selection rejects undeclared files, traversal, symlinks, oversized and malformed payloads", () => {
  const f = fixture();
  try {
    assert.equal(appIconSource(f.app, {}), null);
    assert.equal(appIconSource(f.app, { CFBundleIconFiles: ["../AppIcon60"] }), null);
    rmSync(join(f.app, "AppIcon60@2x.png"));
    symlinkSync(join(f.root, "foreign.png"), join(f.app, "AppIcon60@2x.png"));
    writeFileSync(join(f.root, "foreign.png"), png);
    assert.equal(appIconSource(f.app, f.info), null);
    rmSync(join(f.app, "AppIcon60@2x.png"));
    writeFileSync(join(f.app, "AppIcon60@2x.png"), Buffer.alloc(2 * 1024 * 1024 + 1));
    assert.equal(appIconSource(f.app, f.info), null);
    writeFileSync(join(f.app, "AppIcon60@2x.png"), "not PNG");
    assert.equal(appIconSource(f.app, f.info), null);
    assert.equal(readBuildIcon({ ...f.build, id: "../foreign" }, { rootPath: f.root }), null);
  } finally {
    f.cleanup();
  }
});
test("optional conversion failures preserve build identity and do not publish stale metadata", async () => {
  const f = fixture();
  try {
    const before = structuredClone(f.build);
    assert.equal(
      await captureBuildIcon(f.build, f.app, { ...f.options, convert: async () => false }),
      false,
    );
    assert.deepEqual(f.build, before);
    assert.equal(readBuildIcon(f.build, { rootPath: f.root }), null);
    assert.equal(
      await captureBuildIcon(f.build, f.app, {
        ...f.options,
        convert: async (_, p) => {
          const large = Buffer.from(png);
          large.writeUInt32BE(10000, 16);
          writeFileSync(p, large);
          return true;
        },
      }),
      false,
    );
    assert.deepEqual(f.build, before);
  } finally {
    f.cleanup();
  }
});
