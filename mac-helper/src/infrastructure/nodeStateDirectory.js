// @ts-check

import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Ensure the private root used by current filesystem-backed repositories.
 *
 * This is an explicit composition concern during the repository migration
 * window. Individual repositories keep ownership of their files and locks.
 *
 * @param {{ home?: string }} [options]
 */
export function ensureSwiftSimStateDirectory({ home = homedir() } = {}) {
  if (typeof home !== "string" || home.length === 0) {
    throw new TypeError("Swift Sim state directory requires a non-empty home path.");
  }
  const stateDirectory = join(home, ".swift-sim");
  mkdirSync(stateDirectory, { recursive: true, mode: 0o700 });
  return stateDirectory;
}
