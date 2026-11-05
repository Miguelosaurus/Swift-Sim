#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { prepareQueuedLivePatch, prepareCompleteQueuedLivePatch } from "../src/liveReload.js";

try {
  const input = readFileSync(0, "utf8");
  // Accepted intent is still capped at 8 MiB. A transient compilation projection
  // may additionally carry immutable original source; it is never journaled twice.
  if (Buffer.byteLength(input) > 17 * 1024 * 1024) throw new Error("Invalid compiler request.");
  const record = JSON.parse(input);
  if (!Array.isArray(record?.files) || record.files.length === 0 || record.files.length > 32) throw new Error("Invalid compiler request.");
  console.log(JSON.stringify(process.argv[2] === "--complete-coverage-v3" ? prepareCompleteQueuedLivePatch(record) : prepareQueuedLivePatch(record)));
} catch (error) {
  const allowed = ["QUEUED_MECHANISM_UNSUPPORTED", "QUEUED_EDIT_NOT_COMPATIBLE", "PATCH_STORAGE_INSUFFICIENT", "PATCH_ARTIFACT_INVALID", "LIVE_COMPILER_CONTEXT_UPDATE_REQUIRED"];
  console.error(JSON.stringify({ code: allowed.includes(error?.code) ? error.code : "PATCH_COMPILE_FAILED" }));
  process.exitCode = 1;
}
