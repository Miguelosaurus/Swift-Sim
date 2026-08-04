import {
  hasBoolean,
  hasNumber,
  hasOptionalString,
  hasString,
  isRecord,
  isString,
  isStringArray,
  parseContract,
  type Validator,
} from "./validation.js";

export interface CommandResult {
  command: string;
  argv: readonly string[];
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export const isCommandResult: Validator<CommandResult> = (value): value is CommandResult => {
  if (!isRecord(value) || !hasString(value, "command") || !isStringArray(value.argv)) {
    return false;
  }
  return (
    (value.exitCode === null || hasNumber(value, "exitCode")) &&
    hasOptionalString(value, "signal") &&
    isString(value.stdout) &&
    isString(value.stderr) &&
    hasBoolean(value, "timedOut")
  );
};

export function parseCommandResult(value: unknown): CommandResult {
  return parseContract(value, isCommandResult, "command result");
}
