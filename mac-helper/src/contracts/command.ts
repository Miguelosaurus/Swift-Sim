import {
  hasBoolean,
  hasOptionalString,
  hasString,
  isString,
  isRecord,
  isStringArray,
  parseContract,
  type Validator,
} from "./validation.js";

/** Result returned by deviceBuilderCore.runBuffered and buildValidation. */
export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
  signal?: string;
  cancellationError?: string;
}

/** Input identity retained separately from the result produced by a command. */
export interface CommandInvocation {
  command: string;
  args: readonly string[];
}

export const isCommandResult: Validator<CommandResult> = (value): value is CommandResult => {
  if (
    !isRecord(value) ||
    !hasNumberOrNull(value, "code") ||
    !isString(value.stdout) ||
    !isString(value.stderr)
  ) {
    return false;
  }
  return (
    hasOptionalString(value, "error") &&
    hasOptionalString(value, "signal") &&
    (value.timedOut === undefined || hasBoolean(value, "timedOut")) &&
    (value.cancellationError === undefined || hasString(value, "cancellationError"))
  );
};

export const isCommandInvocation: Validator<CommandInvocation> = (
  value,
): value is CommandInvocation =>
  isRecord(value) && hasString(value, "command") && isStringArray(value.args);

export function parseCommandResult(value: unknown): CommandResult {
  return parseContract(value, isCommandResult, "command result");
}

function hasNumberOrNull(record: Record<string, unknown>, key: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(record, key) &&
    (record[key] === null || (typeof record[key] === "number" && Number.isFinite(record[key])))
  );
}
