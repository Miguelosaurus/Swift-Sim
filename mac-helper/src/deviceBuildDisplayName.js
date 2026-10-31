import { spawnSync } from "node:child_process";
import { lstatSync } from "node:fs";
import { basename, join } from "node:path";

function safeName(value) {
  return typeof value === "string" && value.trim().length <= 60
    && !/[\/\\\u0000-\u001f\u007f]|https?:|Bearer |token=|\$\(|\$\{/i.test(value) ? value.trim() : "";
}

export function appDisplayNameFromSettings(settings = {}, fallback = "") {
  return safeName(settings?.INFOPLIST_KEY_CFBundleDisplayName)
    || safeName(settings?.INFOPLIST_KEY_CFBundleName)
    || safeName(fallback);
}

export function archivedAppDisplayName(archivePath, settings = {}, fallback = "") {
  const product = settings?.FULL_PRODUCT_NAME || settings?.WRAPPER_NAME;
  if (typeof archivePath !== "string" || !archivePath || typeof product !== "string" || product.length > 255 || basename(product) !== product || !product.endsWith(".app")) return safeName(fallback);
  return builtAppDisplayName(join(archivePath, "Products", "Applications", product), fallback);
}

// Presentation only. Read the compiled app during packaging, never during
// activity polling; this cannot change signing or build-identity authority.
export function builtAppDisplayName(appPath, fallback = "") {
  try {
    const app = lstatSync(appPath);
    const path = join(appPath, "Info.plist");
    const info = lstatSync(path);
    if (!app.isDirectory() || app.isSymbolicLink() || !info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 1024 * 1024) return safeName(fallback);
    const result = spawnSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", path], { encoding: "utf8", timeout: 2000, maxBuffer: 1024 * 1024 });
    if (result.status !== 0) return safeName(fallback);
    const value = JSON.parse(result.stdout);
    return safeName(value.CFBundleDisplayName) || safeName(value.CFBundleName) || safeName(fallback);
  } catch { return safeName(fallback); }
}
