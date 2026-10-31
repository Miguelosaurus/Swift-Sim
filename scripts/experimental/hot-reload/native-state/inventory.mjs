#!/usr/bin/env node
// Read-only historical target inventory. No build, delivery or product edit.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { classifySwiftSource, generateDynamicReplacementSource, CLASSIFIER_VERSION } from "../../../../mac-helper/src/liveReload.js";

const [beforeRoot, sourceRoot] = process.argv.slice(2);
if (!beforeRoot || !sourceRoot) throw new Error("Usage: inventory.mjs <before-snapshots> <current-app-source-root>");
const entries = [
  ["ThumbnailPipeline.swift", "Utilities", ["image(for:capture:size:store:allowNetwork:)", "prewarm(videos:anchor:viewport:columns:scale:store:)"]],
  ["ThumbnailDiskCache.swift", "Utilities", ["getCachedImage(for:captureTime:size:scope:allowsLegacy:)", "cacheImage(_:for:captureTime:size:scope:)"]],
  ["LibraryView.swift", "Views", ["scrollViewWillBeginDragging(_:)", "prewarmThumbnailNeighborhood(_:)"]],
  ["DataStore.swift", "Services", ["scheduleThumbnailWarmup()"]],
];
const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const rows = entries.map(([file, directory, changedMembers]) => {
  const before = readFileSync(join(beforeRoot, file), "utf8");
  const after = readFileSync(join(sourceRoot, directory, file), "utf8");
  const result = classifySwiftSource(before, after, { beforePath: file, afterPath: file });
  let generation;
  try {
    const source = generateDynamicReplacementSource({ source: after, beforeSource: before, sourcePath: file, moduleName: "ZenicsCalisthenicsVideo" });
    generation = { completeSourceGenerated: Boolean(source), bytes: Buffer.byteLength(source) };
  } catch (error) { generation = { completeSourceGenerated: false, error: error.code || "unknown" }; }
  return { file, beforeSha256: sha256(before), afterSha256: sha256(after), classifierVersion: CLASSIFIER_VERSION, route: result.route, reasonCode: result.reasonCode, changedMembers, generation };
});
console.log(JSON.stringify({ kind: "read-only-historical-target", physicalApplication: false, rows }, null, 2));
