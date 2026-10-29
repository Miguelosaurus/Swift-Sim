// @ts-check

import { fileURLToPath } from "node:url";

/** @typedef {import("./phase4HelperProcessIdentity.js").SpawnSyncLike} SpawnSyncLike */

const MAINTENANCE_ENTRYPOINT = fileURLToPath(
  new URL("../../bin/swift-sim-phase4-cutover.js", import.meta.url),
);

/**
 * Old releases have no helper identity journal. An explicit absence request is
 * therefore proven from successful machine observations, never from a made-up
 * PID/start token or by starting a migration-capable candidate helper.
 *
 * The process inventory is deliberately host-wide: an ambiguous Swift Sim
 * writer, even one serving a nondefault port, blocks maintenance. No process
 * command or listener PID is returned in the evidence projection.
 * @param {SpawnSyncLike} spawnSync
 */
export function observePhase4UnrecordedHelperAbsence(spawnSync) {
  const processes = observeProcesses(spawnSync);
  const writerCount = processes.filter((entry) => {
    if (!commandMayWriteSwiftSimState(entry.command)) return false;
    // Only this known maintenance program may exempt its own observation.
    // Calling this API from a helper/writer cannot prove that writer absent.
    return !(entry.pid === process.pid && commandIsMaintenanceObserver(entry.command));
  }).length;
  const listenerCount = observeListenerCount(spawnSync);
  const absent = writerCount === 0 && listenerCount === 0;
  return Object.freeze({
    state: absent ? "absent-unrecorded" : "writer-or-listener-present",
    source: "successful-process-inventory-and-listener-observation",
    journalPresent: false,
    journalMatchesExpected: false,
    exactIdentityVerified: absent,
    helperQuiesced: absent,
    pid: null,
    startedAt: null,
    observedStartedAt: null,
    processInventoryCount: processes.length,
    writerCount,
    listenerCount,
  });
}

/** @param {SpawnSyncLike} spawnSync */
function observeProcesses(spawnSync) {
  const result = observeCommand(spawnSync, "/bin/ps", ["-axo", "pid=,command=", "-ww"]);
  if (result.status !== 0 || result.stdout.trim() === "") {
    throw new Error("Phase-4 helper process inventory is unavailable.");
  }
  const seen = new Set();
  const processes = result.stdout
    .trim()
    .split("\n")
    .map((line) => {
      const match = /^\s*([1-9]\d*)\s+(\S.*)$/.exec(line);
      const pid = Number(match?.[1]);
      const command = match?.[2]?.trim();
      if (!Number.isSafeInteger(pid) || !command || seen.has(pid)) {
        throw new Error("Phase-4 helper process inventory is malformed.");
      }
      seen.add(pid);
      return { pid, command };
    });
  // A successful but empty/truncated fixture cannot establish host absence.
  // Every real full ps snapshot necessarily includes this observing process.
  if (!seen.has(process.pid)) {
    throw new Error("Phase-4 helper process inventory omitted the observing process.");
  }
  return processes;
}

/** @param {SpawnSyncLike} spawnSync */
function observeListenerCount(spawnSync) {
  const result = observeCommand(spawnSync, "/usr/sbin/lsof", [
    "-nP",
    "-iTCP:47217",
    "-sTCP:LISTEN",
    "-t",
  ]);
  if (result.status === 1 && result.stdout.trim() === "") return 0;
  if (result.status !== 0 || result.stdout.trim() === "") {
    throw new Error("Phase-4 helper listener observation is inconclusive.");
  }
  const pids = result.stdout.trim().split("\n");
  if (!pids.every((pid) => /^[1-9]\d*$/.test(pid.trim()) && Number.isSafeInteger(Number(pid)))) {
    throw new Error("Phase-4 helper listener observation is malformed.");
  }
  return new Set(pids.map((pid) => Number(pid))).size;
}

/** @param {SpawnSyncLike} spawnSync @param {string} command @param {string[]} args */
function observeCommand(spawnSync, command, args) {
  let result;
  try {
    result = spawnSync(command, args, { encoding: "utf8" });
  } catch (error) {
    throw new Error("Phase-4 helper absence observation failed.", { cause: error });
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Phase-4 helper absence observation returned an invalid result.");
  }
  const values = /** @type {Record<string, unknown>} */ (result);
  if (
    values.error ||
    values.signal ||
    typeof values.stdout !== "string" ||
    typeof values.stderr !== "string" ||
    values.stderr.trim() !== ""
  ) {
    throw new Error("Phase-4 helper absence observation failed.");
  }
  return { status: values.status, stdout: values.stdout };
}

/**
 * Recognize executable/script positions rather than textual mentions in shell
 * commands. The remaining argument text is searched conservatively for Node
 * launch flags before a Swift Sim script; uncertainty blocks rather than
 * classifying a possibly active writer as absent.
 * @param {string} command
 */
function commandMayWriteSwiftSimState(command) {
  const first = /^("[^"]+"|'[^']+'|\S+)(?:\s+(.*))?$/.exec(command);
  if (!first?.[1]) return false;
  const executable = unquote(first[1]).split("/").at(-1) || "";
  const args = first[2] || "";
  const service =
    /(?:^|\s)(?:"[^"\n]*\/|'[^'\n]*\/|\S*\/)?swift-sim(?:-helper)?(?:-entry)?(?:\.js)?["']?\s+serve(?:\s|$)/;
  // Compatibility helpers default to serving when no command is supplied.
  // Treat every direct helper entrypoint conservatively as a possible writer,
  // including Node flags or a custom port without a literal `serve` token.
  const helper =
    /(?:^|\s)(?:"[^"\n]*\/|'[^'\n]*\/|\S*\/)?swift-sim-helper(?:-entry)?(?:\.js)?["']?(?:\s|$)/;
  const writer =
    /(?:^|\s)(?:"[^"\n]*\/|'[^'\n]*\/|\S*\/)?swift-sim-(?:device-gateway|device-delivery|device-delivery-manager|device-builder|session-worker|owned-worker|phase4-cutover)(?:\.js)?(?:["']?)(?:\s|$)/;
  if (/^node(?:[.-]\d+)*$/.test(executable)) {
    return helper.test(args) || service.test(args) || writer.test(args);
  }
  if (/^swift-sim-helper(?:-entry)?(?:\.js)?$/.test(executable)) return true;
  if (/^swift-sim(?:-helper)?(?:-entry)?(?:\.js)?$/.test(executable)) {
    return /^serve(?:\s|$)/.test(args);
  }
  if (/^(?:ba|z|da)?sh$/.test(executable)) {
    // Direct shell-script launch is a possible transient wrapper. A shell -c
    // merely quoting/echoing a helper path is not a helper process.
    return (helper.test(args) || service.test(args)) && !/^-\S*(?:c)(?:\s|$)/.test(args);
  }
  return false;
}

/** @param {string} command */
function commandIsMaintenanceObserver(command) {
  const tokens = command.match(/"[^"\n]*"|'[^'\n]*'|\S+/g)?.map(unquote) || [];
  const executable = tokens.shift()?.split("/").at(-1) || "";
  if (!/^node(?:[.-]\d+)*$/.test(executable)) return false;
  const noValueFlags = new Set([
    "--enable-source-maps",
    "--experimental-sqlite",
    "--trace-warnings",
    "--no-warnings",
  ]);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) return false;
    if (noValueFlags.has(token)) continue;
    // Unknown flags, eval/import bootstrap and ambiguous tokenization cannot
    // establish that the maintenance entrypoint itself owns this process.
    if (token.startsWith("-")) return false;
    return (
      token === MAINTENANCE_ENTRYPOINT &&
      ["status", "prepare", "activate", "cancel", "rollback"].includes(tokens[index + 1] || "")
    );
  }
  return false;
}

/** @param {string} token */
function unquote(token) {
  return /^["']/.test(token) ? token.slice(1, -1) : token;
}
