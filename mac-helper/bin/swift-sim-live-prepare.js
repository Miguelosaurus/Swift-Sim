#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { prepareQueuedLivePatch } from "../src/liveReload.js";

try {
  const input = readFileSync(0, "utf8");
  if (Buffer.byteLength(input) > 9 * 1024 * 1024) throw new Error("Invalid compiler request.");
  const record = JSON.parse(input);
  if (!Array.isArray(record?.files) || record.files.length === 0 || record.files.length > 32) throw new Error("Invalid compiler request.");
  console.log(JSON.stringify(prepareQueuedLivePatch(record)));
} catch {
  console.error("The queued replacement could not be compiled.");
  process.exitCode = 1;
}
