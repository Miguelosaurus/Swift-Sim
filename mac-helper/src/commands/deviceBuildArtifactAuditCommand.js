// @ts-check

import { summarizeDeviceBuildArtifactAudit } from "../deviceBuildArtifactAuditSummary.js";

export const DEVICE_BUILD_ARTIFACT_AUDIT_COMMAND = "device-build-artifact-audit";

/** @param {string | undefined} command */
export function deviceBuildArtifactAuditCommandIsSupported(command) {
  return command === DEVICE_BUILD_ARTIFACT_AUDIT_COMMAND;
}

/**
 * Handle the internal helper diagnostic command before the compatibility
 * runtime is constructed. This is deliberately separate from setup-status and
 * serve startup so artifact measurement is opt-in and read-only.
 *
 * @param {{
 *   argv: string[],
 *   inspect(): Promise<Record<string, unknown>>,
 *   writeLine?: (line: string) => void,
 * }} options
 */
export async function dispatchDeviceBuildArtifactAuditCommand({
  argv,
  inspect,
  writeLine = (line) => console.log(line),
}) {
  const [command, ...args] = argv;
  if (!deviceBuildArtifactAuditCommandIsSupported(command)) return false;
  if (args.length > 0) {
    throw new Error(`${DEVICE_BUILD_ARTIFACT_AUDIT_COMMAND} does not accept arguments.`);
  }
  if (typeof inspect !== "function") {
    throw new TypeError("Device-build artifact audit command requires inspect.");
  }
  if (typeof writeLine !== "function") {
    throw new TypeError("Device-build artifact audit command requires writeLine.");
  }
  const audit = await inspect();
  writeLine(JSON.stringify(summarizeDeviceBuildArtifactAudit(audit), null, 2));
  return true;
}
