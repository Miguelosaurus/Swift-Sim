// @ts-check
import { spawn, spawnSync } from "node:child_process";
import {
  ownedProcessIsAlive,
  terminateOwnedProcess,
  terminateOwnedProcessSync,
  waitForOwnedProcessExit,
} from "./nodeProcessControl.js";

/** @typedef {import("../contracts/command.js").CommandResult} CommandResult */
/** @typedef {import("./ports.js").CommandEnvironmentPolicy} CommandEnvironmentPolicy */
/** @typedef {import("./ports.js").CommandRequest} CommandRequest */
/** @typedef {import("./ports.js").CommandRunner} CommandRunner */
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
  /** @param {CommandRequest} request */
  run(request) {
    const normalized = normalizeRequest(request);
    if (normalized.cancellationSignal?.aborted) {
      return Promise.resolve(cancelledResult());
    }
    return runAsynchronously(normalized);
  }

  /** @param {CommandRequest} request */
  runSync(request) {
    const normalized = normalizeRequest(request);
    if (normalized.cancellationSignal?.aborted) return cancelledResult();
    if (normalized.cancellationSignal) {
      return {
        code: null,
        stdout: "",
        stderr: "",
        error: "Synchronous commands cannot observe a cancellation signal while blocked.",
      };
    }

    const detached = normalized.processGroup === "new";
    const result = spawnSync(normalized.executable, normalized.args, {
      cwd: normalized.cwd,
      env: normalized.environment,
      input: normalized.input,
      encoding: "buffer",
      timeout: normalized.timeoutMs,
      maxBuffer: normalized.outputLimitBytes,
      killSignal: "SIGTERM",
      detached,
      windowsHide: true,
    });
    const pid = Number(result.pid);
    const output = boundedOutput(
      bufferValue(result.stdout),
      bufferValue(result.stderr),
      normalized.outputLimitBytes,
    );
    const errorCode = codedError(result.error);
    const timedOut = errorCode === "ETIMEDOUT";
    const outputExceeded = errorCode === "ENOBUFS" || output.exceeded;
    let descendantsSurvived = false;
    let terminated = true;
    if (Number.isInteger(pid) && pid > 1 && detached && ownedProcessIsAlive(pid, true)) {
      descendantsSurvived = result.status === 0 && !timedOut && !outputExceeded;
      terminated = terminateOwnedProcessSync(pid, true, TERMINATION_GRACE_MS);
    }

    if (timedOut) {
      return {
        code: null,
        stdout: output.stdout,
        stderr: output.stderr,
        error: terminated
          ? `${normalized.executable} timed out`
          : `${normalized.executable} timed out and its process group could not be confirmed stopped`,
        timedOut: true,
        ...(result.signal ? { signal: result.signal } : {}),
      };
    }
    if (outputExceeded) {
      return {
        code: null,
        stdout: output.stdout,
        stderr: output.stderr,
        error: terminated
          ? `${normalized.executable} exceeded the ${normalized.outputLimitBytes}-byte output limit`
          : `${normalized.executable} exceeded the output limit and its process group could not be confirmed stopped`,
        ...(result.signal ? { signal: result.signal } : {}),
      };
    }
    if (descendantsSurvived) {
      return {
        code: null,
        stdout: output.stdout,
        stderr: output.stderr,
        error: terminated
          ? `${normalized.executable} exited successfully while descendant processes were still running`
          : `${normalized.executable} exited, but its process group could not be confirmed stopped`,
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

/** @param {NormalizedCommandRequest} request */
function runAsynchronously(request) {
  return new Promise((resolve) => {
    const detached = request.processGroup === "new";
    let child;
    try {
      child = spawn(request.executable, request.args, {
        cwd: request.cwd,
        env: request.environment,
        stdio: ["pipe", "pipe", "pipe"],
        detached,
        windowsHide: true,
      });
    } catch (error) {
      resolve({ code: null, stdout: "", stderr: "", error: safeErrorMessage(error) });
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
    let timer;

    const outputs = () => ({
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8"),
    });

    /** @param {CommandResult} result */
    const settle = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.cancellationSignal?.removeEventListener("abort", cancel);
      resolve(result);
    };

    /** @param {(terminated: boolean) => CommandResult} resultFactory */
    const terminateAndSettle = (resultFactory) => {
      if (settled || terminating) return;
      terminating = true;
      clearTimeout(timer);
      request.cancellationSignal?.removeEventListener("abort", cancel);
      child.stdin.destroy();
      if (!Number.isInteger(pid) || pid <= 1) {
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
        const result = cancelledResult(output.stdout, output.stderr);
        if (!terminated) {
          result.error = "Command was cancelled, but its process could not be confirmed stopped.";
          result.cancellationError = {
            message: result.error,
            code: "ABORT_ERR",
          };
        }
        return result;
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
      clearTimeout(timer);
      request.cancellationSignal?.removeEventListener("abort", cancel);
      void (async () => {
        let descendantsSurvived = false;
        let terminated = true;
        if (detached && Number.isInteger(pid) && pid > 1) {
          const exited = await waitForOwnedProcessExit(pid, true, SUCCESS_DESCENDANT_WAIT_MS);
          if (!exited) {
            descendantsSurvived = code === 0;
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

    if (request.input === undefined) child.stdin.end();
    else child.stdin.end(request.input);
  });
}

/** @param {CommandRequest} request @returns {NormalizedCommandRequest} */
function normalizeRequest(request) {
  if (!request || typeof request !== "object") throw new TypeError("A command request is required.");
  const executable = normalizedString(request.executable, "Command executable");
  const args = normalizedStringArray(request.args, "Command arguments");
  const policy = request.policy;
  if (!policy || typeof policy !== "object") throw new TypeError("Command policy is required.");
  const acceptedExitCodes = normalizedExitCodes(policy.acceptedExitCodes);
  if (policy.processGroup !== "inherit" && policy.processGroup !== "new") {
    throw new TypeError("Command processGroup must be inherit or new.");
  }
  const normalized = {
    executable,
    args,
    environment: commandEnvironment(request.environment),
    timeoutMs: positiveInteger(policy.timeoutMs, "Command timeout"),
    outputLimitBytes: positiveInteger(policy.outputLimitBytes, "Command output limit"),
    processGroup: policy.processGroup,
    acceptedExitCodes,
  };
  return {
    ...normalized,
    ...(request.cwd === undefined ? {} : { cwd: normalizedString(request.cwd, "Command cwd") }),
    ...(request.input === undefined ? {} : { input: normalizedInput(request.input) }),
    ...(request.cancellationSignal === undefined
      ? {}
      : { cancellationSignal: normalizedAbortSignal(request.cancellationSignal) }),
  };
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

/** @param {unknown} value */
function normalizedInput(value) {
  if (typeof value === "string" || value instanceof Uint8Array) return value;
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
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value) ||
    value.includes("\0")
  ) {
    throw new TypeError(`${label} must be a ${allowEmpty ? "NUL-free" : "non-empty NUL-free"} string.`);
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

/**
 * @param {NormalizedCommandRequest} request
 * @param {number | null} code
 * @param {string} stdout
 * @param {string} stderr
 * @param {string | null} signal
 */
function completedResult(request, code, stdout, stderr, signal) {
  const accepted = code !== null && request.acceptedExitCodes.has(code);
  return {
    code,
    stdout,
    stderr,
    ...(accepted
      ? {}
      : {
        error: stderr || stdout || `${request.executable} failed with exit code ${code}`,
      }),
    ...(signal ? { signal } : {}),
  };
}

/** @param {string} [stdout] @param {string} [stderr] */
function cancelledResult(stdout = "", stderr = "") {
  return {
    code: null,
    stdout,
    stderr,
    error: "Command was cancelled.",
    cancellationError: {
      message: "Command was cancelled.",
      code: "ABORT_ERR",
    },
  };
}

/** @param {Buffer} stdout @param {Buffer} stderr @param {number} limit */
function boundedOutput(stdout, stderr, limit) {
  const combined = Buffer.concat([stdout, stderr]);
  const exceeded = combined.length > limit;
  const bounded = combined.subarray(0, limit);
  const stdoutLength = Math.min(stdout.length, bounded.length);
  return {
    stdout: bounded.subarray(0, stdoutLength).toString("utf8"),
    stderr: bounded.subarray(stdoutLength).toString("utf8"),
    exceeded,
  };
}

/** @param {unknown} value */
function bufferValue(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value);
  return Buffer.alloc(0);
}

/** @param {unknown} error */
function codedError(error) {
  if (!error || typeof error !== "object") return "";
  const code = /** @type {{ code?: unknown }} */ (error).code;
  return typeof code === "string" ? code : "";
}

/** @param {unknown} error */
function safeErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
