import { createHash, randomUUID } from "node:crypto";
import { constants, lstatSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

const MAX_BYTES = 128 * 1024;
const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

function readPNG(path, maximum = MAX_BYTES, maxDimension = 256, optimized = false) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 24 || stat.size > maximum) return null;
    const bytes = readFileSync(path, { flag: constants.O_RDONLY | constants.O_NOFOLLOW });
    if (bytes.length !== stat.size || bytes.length > maximum) return null;
    if (!bytes.subarray(0, 8).equals(PNG)) return null;
    const offset = optimized && bytes.toString("ascii", 12, 16) === "CgBI" ? 20 + bytes.readUInt32BE(8) : 8;
    if (offset + 24 > bytes.length || bytes.toString("ascii", offset + 4, offset + 8) !== "IHDR") return null;
    const width = bytes.readUInt32BE(offset + 8); const height = bytes.readUInt32BE(offset + 12);
    return width > 0 && height > 0 && width <= maxDimension && height <= maxDimension ? bytes : null;
  } catch { return null; }
}

export function appIconSource(appPath, info = {}) {
  try {
    if (!lstatSync(appPath).isDirectory() || lstatSync(appPath).isSymbolicLink()) return null;
    const declared = [info.CFBundleIcons?.CFBundlePrimaryIcon?.CFBundleIconFiles,
      info["CFBundleIcons~ipad"]?.CFBundlePrimaryIcon?.CFBundleIconFiles, info.CFBundleIconFiles].flat().filter((name) =>
      typeof name === "string" && name.length <= 160 && basename(name) === name && !/[\\\u0000-\u001f]/.test(name)).map((name) => name.replace(/\.png$/i, ""));
    const candidates = readdirSync(appPath).filter((name) => name.endsWith(".png") && declared.some((stem) =>
      name === stem || name === `${stem}.png` || name.startsWith(`${stem}@`) || name.startsWith(`${stem}~`)));
    for (const name of candidates.sort((a, b) => Number(b.includes("@3x")) - Number(a.includes("@3x")) || a.localeCompare(b))) {
      const path = join(appPath, name);
      if (readPNG(path, 2 * 1024 * 1024, 2048, true)) return path;
    }
  } catch {}
  return null;
}

// Optional build presentation; failure must never fail a signed build. Conversion
// belongs to the existing bounded build command adapter, not an idle worker.
export async function captureBuildIcon(build, appPath, { readInfo, convert, reserve, publish, discard } = {}) {
  let temporary;
  try {
    const root = resolve(build.artifacts.root);
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(build.id) || basename(root) !== build.id || lstatSync(root).isSymbolicLink()) return false;
    const infoPath = join(appPath, "Info.plist"); const metadata = lstatSync(infoPath);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > 1024 * 1024) return false;
    const source = appIconSource(appPath, readInfo(infoPath));
    if (!source) return false;
    const destination = join(root, `app-icon.${randomUUID()}.pending.png`);
    reserve(destination); temporary = destination;
    if (!await convert(source, temporary)) return false;
    const bytes = readPNG(temporary);
    if (!bytes) return false;
    const finalPath = join(root, "app-icon.png");
    publish(temporary, finalPath); temporary = null;
    build.app.iconDigest = digest(bytes);
    return true;
  } catch { return false; }
  finally { if (temporary) try { discard(temporary); } catch {} }
}

export function readBuildIcon(build, { rootPath = join(homedir(), ".swift-sim", "device-builds") } = {}) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(build?.id || "") || !/^[a-f0-9]{64}$/.test(build.app?.iconDigest || "")) return null;
  const root = join(rootPath, build.id);
  try { if (!lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink()) return null; } catch { return null; }
  const bytes = readPNG(join(root, "app-icon.png"));
  return bytes && digest(bytes) === build.app.iconDigest ? bytes : null;
}
