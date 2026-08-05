// @ts-check
import {
  terminateOwnedProcess,
  waitForOwnedProcessExit,
} from "./nodeProcessControl.js";

/** @typedef {import("../contracts/command.js").CommandResult} CommandResult */
/** @typedef {import("./ports.js").CommandEnvironmentPolicy} CommandEnvironmentPolicy */
/** @typedef {import("./ports.js").CommandRequest} CommandRequest */
/** @typedef {import("./ports.js").CommandRunner} CommandRunner */
/** @typedef {typeof import("node:child_process").spawn} SpawnFunction */
/** @typedef {typeof import("node:child_process").spawnSync} SpawnSyncFunction */
/**
 * @typedef {{
 *   executable: string,
 *   args: string[],
 *   cwd?: string,
 *   environment: Record<string, string>,
 *   input?: string | Uint8Array,
 *   cancellationSignal?: AbortSignal,
 *   timeoutMs: number,
 *   outputLimitBytes: number,
 *   processGroup: "inherit" | "new",
 *   acceptedExitCodes: Set<number>,
 * }} NormalizedCommandRequest
 */

const TERMINATION_GRACE_MS = 2_000;
const SUCCESS_DESCENDANT_WAIT_MS = 500;

/** @implements {CommandRunner} */
export class NodeCommandRunner {
  /** @param {{ spawn: SpawnFunction, spawnSync: SpawnSyncFunction }} runtime */
  constructor(runtime) {
    if (!runtime || typeof runtime !== "object") {
      throw new TypeError("NodeCommandRunner requires an explicit process runtime.");
    }
    if (typeof runtime.spawn !== "function" || typeof runtime.spawnSync !== "function") {
      throw new TypeError("NodeCommandRunner runtime must provide spawn and spawnSync.");
    }
    this.spawn = runtime.spawn;
    this.spawnSync = runtime.spawnSync;
  }

  /** @param {CommandRequest} request */
  run(request) {
    const normalized = normalizeRequest(request);
    if (normalized.cancellationSignal?.aborted) {
      return Promise.resolve(cancelledResult());
    }
    return runAsynchronously(normalized, this.spawn);
  }

  /** @param {CommandRequest} request */
  runSync(request) {
    const normalized = normalizeRequest(request);
    if (normalized.cancellationSignal?.aborted) return cancelledResult();
    if (normalized.cancellationSignal) {
      return failedResult(
        "Synchronous commands cannot observe a cancellation signal while blocked.",
      );
    }
    if (normalized.processGroup === "new") {
      return failedResult(
        "Synchronous commands cannot establish an owned process group; use asynchronous execution.",
      );
    }

    const result = this.spawnSync(normalized.executable, normalized.args, {
      cwd: normalized.cwd,
      env: normalized.environment,
      input: normalized.input,
      encoding: "buffer",
      timeout: normalized.timeoutMs,
      maxBuffer: normalized.outputLimitBytes,
      killSignal: "SIGTERM",
      windowsHide: true,
    });
    const output = boundedOutput(
      bufferValue(result.stdout),
      bufferValue(result.stderr),
      normalized.outputLimitBytes,
    );
    const spawnErrorCode = codedError(result.error);
    const timedOut = spawnErrorCode === "ETIMEDOUT";
    const outputExceeded = spawnErrorCode === "ENOBUFS" || output.exceeded;

    if (timedOut) {
      return {
        code: null,
        stdout: output.stdout,
        stderr: output.stderr,
        error: `${normalized.executable} timed out`,
        timedOut: true,
        ...(result.signal ? { signal: result.signal } : {}),
      };
    }
    if (outputExceeded) {
      return {
        code: null,
        stdout: output.stdout,
        stderr: output.stderr,
        error: `${normalized.executable} exceeded the ${normalized.outputLimitBytes}-byte output limit`,
        ...(result.signal ? { signal: result.signal } : {}),
      };
    }
    if (result.error) {
      return {
        code: result.status,
        stdout: output.stdout,
        stderr: output.stderr,
        error: safeErrorMessage(result.error),
        ...(result.signal ? { signal: result.signal } : {}),
      };
    }
    return completedResult(
      normalized,
      result.status,
      output.stdout,
      output.stderr,
      result.signal,
    );
  }
}

/** @param {NormalizedCommandRequest} request @param {SpawnFunction} spawnImplementation */
function runAsynchronously(request, spawnImplementation) {
  return new Promise((resolve) => {
    const detached = request.processGroup === "new";
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawnImplementation(request.executable, request.args, {
        cwd: request.cwd,
        env: request.environment,
        detached,
        windowsHide: true,
      });
    } catch (error) {
      resolve(failedResult(safeErrorMessage(error)));
      return;
    }

    const pid = Number(child.pid);
    /** @type {Buffer[]} */
    const stdoutChunks = [];
    /** @type {Buffer[]} */
    const stderrChunks = [];
    let capturedBytes = 0;
    let settled = false;
    let terminating = false;
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    let timer;

    const outputs = () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    });

    /** @param {CommandResult} result */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      request.cancellationSignal?.removeEventListener("abort", cancel);
      resolve(result);
    };

    /** @param {(terminated: boolean) => CommandResult} resultFactory */
    const terminateAndSettle = (resultFactory) => {
      if (settled || terminating) return;
      terminating = true;
      if (timer) clearTimeout(timer);
      request.cancellationSignal?.removeEventListener("abort", cancel);
      child.stdin.destroy();
      if (!validPID(pid)) {
        try {
          child.kill("SIGKILL");
        } catch {}
        settle(resultFactory(false));
        return;
      }
      void terminateOwnedProcess(pid, detached, TERMINATION_GRACE_MS).then((terminated) => {
        settle(resultFactory(terminated));
      });
    };

    const cancel = () => {
      terminateAndSettle((terminated) => {
        const output = outputs();
        if (terminated) return cancelledResult(output.stdout, output.stderr);
        const message = "Command was cancelled, but its process could not be confirmed stopped.";
        return {
          code: null,
          stdout: output.stdout,
          stderr: output.stderr,
          error: message,
          cancellationError: { message, code: "ABORT_ERR" },
        };
      });
    };

    /** @param {Buffer[]} chunks @param {Buffer | string | Uint8Array} value */
    const appendOutput = (chunks, value) => {
      if (settled || terminating) return;
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value);
      const remaining = Math.max(0, request.outputLimitBytes - capturedBytes);
      if (remaining > 0) chunks.push(buffer.subarray(0, remaining));
      capturedBytes += buffer.length;
      if (capturedBytes > request.outputLimitBytes) {
        terminateAndSettle((terminated) => {
          const output = outputs();
          return {
            code: null,
            stdout: output.stdout,
            stderr: output.stderr,
            error: terminated
              ? `${request.executable} exceeded the ${request.outputLimitBytes}-byte output limit`
              : `${request.executable} exceeded the output limit and its process could not be confirmed stopped`,
          };
        });
      }
    };

    child.stdout.on("data", (chunk) => appendOutput(stdoutChunks, chunk));
    child.stderr.on("data", (chunk) => appendOutput(stderrChunks, chunk));
    child.stdin.on("error", () => {});
    child.once("error", (error) => {
      if (terminating) return;
      const output = outputs();
      settle({
        code: null,
        stdout: output.stdout,
        stderr: output.stderr,
        error: safeErrorMessage(error),
      });
    });
    child.once("close", (code, signal) => {
      if (settled || terminating) return;
      terminating = true;
      if (timer) clearTimeout(timer);
      request.cancellationSignal?.removeEventListener("abort", cancel);
      void (async () => {
        let descendantsSurvived = false;
        let terminated = true;
        if (detached && validPID(pid)) {
          const exited = await waitForOwnedProcessExit(pid, true, SUCCESS_DESCENDANT_WAIT_MS);
          if (!exited) {
            descendantsSurvived = isAcceptedExit(request, code);
            terminated = await terminateOwnedProcess(pid, true, TERMINATION_GRACE_MS);
          }
        }
        const output = outputs();
        if (!terminated) {
          settle({
            code: null,
            stdout: output.stdout,
            stderr: output.stderr,
            error: `${request.executable} exited, but its process group could not be confirmed stopped`,
          });
          return;
        }
        if (descendantsSurvived) {
          settle({
            code: null,
            stdout: output.stdout,
            stderr: output.stderr,
            error: `${request.executable} exited successfully while descendant processes were still running`,
          });
          return;
        }
        settle(completedResult(request, code, output.stdout, output.stderr, signal));
      })();
    });

    request.cancellationSignal?.addEventListener("abort", cancel, { once: true });
    timer = setTimeout(() => {
      terminateAndSettle((terminated) => {
        const output = outputs();
        return {
          code: null,
          stdout: output.stdout,
          stderr: output.stderr,
          error: terminated
            ? `${request.executable} timed out`
            : `${request.executable} timed out and its process could not be confirmed stopped`,
          timedOut: true,
        };
      });
    }, request.timeoutMs);
    if (request.cancellationSignal?.aborted) {
      cancel();
      return;
    }

    if (request.input === undefined) child.stdin.end();
    else child.stdin.end(request.input);
  });
}

/** @param {CommandRequest} request @returns {NormalizedCommandRequest} */
function normalizeRequest(request) {
  if (!request || typeof request !== "object") {
    throw new TypeError("A command request is required.");
  }
  const policy = request.policy;
  if (!policy || typeof policy !== "object") throw new TypeError("Command policy is required.");
  if (policy.processGroup !== "inherit" && policy.processGroup !== "new") {
    throw new TypeError("Command processGroup must be inherit or new.");
  }
  /** @type {NormalizedCommandRequest} */
  const normalized = {
    executable: normalizedString(request.executable, "Command executable"),
    args: normalizedStringArray(request.args, "Command arguments"),
    environment: commandEnvironment(request.environment),
    timeoutMs: positiveInteger(policy.timeoutMs, "Command timeout"),
    outputLimitBytes: positiveInteger(policy.outputLimitBytes, "Command output limit"),
    processGroup: policy.processGroup,
    acceptedExitCodes: normalizedExitCodes(policy.acceptedExitCodes),
  };
  if (request.cwd !== undefined) normalized.cwd = normalizedString(request.cwd, "Command cwd");
  if (request.input !== undefined) normalized.input = normalizedInput(request.input);
  if (request.cancellationSignal !== undefined) {
    normalized.cancellationSignal = normalizedAbortSignal(request.cancellationSignal);
  }
  return normalized;
}

/** @param {CommandEnvironmentPolicy} policy */
function commandEnvironment(policy) {
  if (!policy || typeof policy !== "object") {
    throw new TypeError("Command environment policy is required.");
  }
  const inherit = normalizedEnvironmentNames(policy.inherit, "inherited environment names");
  const unset = new Set(normalizedEnvironmentNames(policy.unset, "unset environment names"));
  if (!policy.overrides || typeof policy.overrides !== "object" || Array.isArray(policy.overrides)) {
    throw new TypeError("Command environment overrides must be an object.");
  }
  /** @type {Record<string, string>} */
  const environment = {};
  for (const name of inherit) {
    const value = process.env[name];
    if (value !== undefined && !unset.has(name)) environment[name] = value;
  }
  for (const [name, value] of Object.entries(policy.overrides)) {
    normalizedEnvironmentName(name);
    if (value === undefined || unset.has(name)) delete environment[name];
    else environment[name] = normalizedEnvironmentValue(value, name);
  }
  for (const name of unset) delete environment[name];
  return environment;
}

/** @param {readonly number[]} values */
function normalizedExitCodes(values) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new TypeError("Command acceptedExitCodes must contain at least one code.");
  }
  /** @type {Set<number>} */
  const result = new Set();
  for (const value of values) {
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      throw new RangeError("Command exit codes must be integers from 0 to 255.");
    }
    result.add(value);
  }
  return result;
}

/** @param {readonly string[]} values @param {string} label */
function normalizedStringArray(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`${label} must be an array.`);
  return values.map((value) => normalizedString(value, label, true));
}

/** @param {readonly string[]} values @param {string} label */
function normalizedEnvironmentNames(values, label) {
  if (!Array.isArray(values)) throw new TypeError(`Command ${label} must be an array.`);
  return values.map((value) => normalizedEnvironmentName(value));
}

/** @param {string} value */
function normalizedEnvironmentName(value) {
  if (typeof value !== "string" || !value || value.includes("=") || value.includes("\0")) {
    throw new TypeError("Command environment names must be non-empty and cannot contain = or NUL.");
  }
  return value;
}

/** @param {string} value @param {string} name */
function normalizedEnvironmentValue(value, name) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new TypeError(`Command environment value for ${name} must be a NUL-free string.`);
  }
  return value;
}

/** @param {string | Uint8Array} value */
function normalizedInput(value) {
  if (typeof value === "string") return value;
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new TypeError("Command input must be a string or Uint8Array.");
}

/** @param {AbortSignal} signal */
function normalizedAbortSignal(signal) {
  if (
    !signal ||
    typeof signal !== "object" ||
    typeof signal.aborted !== "boolean" ||
    typeof signal.addEventListener !== "function" ||
    typeof signal.removeEventListener !== "function"
  ) {
    throw new TypeError("Command cancellationSignal must be an AbortSignal.");
  }
  return signal;
}

/** @param {unknown} value @param {string} label @param {boolean} [allowEmpty] */
function normalizedString(value, label, allowEmpty = false) {
  if (typeof value !== "string" || (!allowEmpty && !value) || value.includes("\0")) {
    throw new TypeError(
      `${label} must be a ${allowEmpty ? "NUL-free" : "non-empty NUL-free"} string.`,
    );
  }
  return value;
}

/** @param {number} value @param {string} label */
function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
  return value;
}

/** @param {NormalizedCommandRequest} request @param {number | null} code */
function isAcceptedExit(request, code) {
  return Number.isInteger(code) && request.acceptedExitCodes.has(Number(code));
}

/**
 * @param {NormalizedCommandRequest} request
 * @param {number | null} code
 * @param {string} stdout
 * @param {string} stderr
 * @param {string | null} signal
 * @returns {CommandResult}
 */
function completedResult(request, code, stdout, stderr, signal) {
  if (isAcceptedExit(request, code)) return { code, stdout, stderr };
  return {
    code,
    stdout,
    stderr,
    error:
      stderr ||
      stdout ||
      (signal
        ? `${request.executable} terminated by ${signal}`
        : `${request.executable} failed with exit code ${String(code)}`),
    ...(signal ? { signal } : {}),
  };
}

/** @param {string} message @returns {CommandResult} */
function failedResult(message) {
  return { code: null, stdout: "", stderr: "", error: message };
}

/** @param {string} [stdout] @param {string} [stderr] @returns {CommandResult} */
function cancelledResult(stdout = "", stderr = "") {
  const message = "Command was cancelled.";
  return {
    code: null,
    stdout,
    stderr,
    error: message,
    cancellationError: { message, code: "ABORT_ERR" },
  };
}

/** @param {Buffer} stdout @param {Buffer} stderr @param {number} limit */
function boundedOutput(stdout, stderr, limit) {
  let remaining = limit;
  const boundedStdout = stdout.subarray(0, remaining);
  remaining -= boundedStdout.length;
  const boundedStderr = stderr.subarray(0, remaining);
  return {
    stdout: boundedStdout.toString("utf8"),
    stderr: boundedStderr.toString("utf8"),
    exceeded: stdout.length + stderr.length > limit,
  };
}

/** @param {Buffer | string | null | undefined} value */
function bufferValue(value) {
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === "string") return Buffer.from(value);
  return Buffer.alloc(0);
}

/** @param {unknown} error */
function codedError(error) {
  if (!error || typeof error !== "object" || !("code" in error)) return "";
  const code = error.code;
  return typeof code === "string" || typeof code === "number" ? String(code) : "";
}

/** @param {unknown} error */
function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/** @param {number} pid */
function validPID(pid) {
  return Number.isInteger(pid) && pid > 1;
}
