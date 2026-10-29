#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { validateEvidenceReport } from "./evidence-contract.js";

const path = process.argv[2];
if (!path) throw new Error("usage: validate-evidence.mjs <report.json>");
const report = JSON.parse(readFileSync(path, "utf8"));
const result = validateEvidenceReport(report);
console.log(JSON.stringify(result, null, 2));
if (!result.valid) process.exitCode = 1;
