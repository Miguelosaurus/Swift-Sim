import {
  hasNumber,
  hasString,
  isInteger,
  isRecord,
  parseContract,
  type Validator,
} from "./validation.js";

export interface ProcessIdentity {
  pid: number;
  processGroupID: number;
  executable: string;
  startToken: string;
  instanceNonce: string;
}

export const isProcessIdentity: Validator<ProcessIdentity> = (value): value is ProcessIdentity => {
  if (!isRecord(value) || !hasString(value, "executable")) {
    return false;
  }
  const pid = value.pid;
  const processGroupID = value.processGroupID;
  return (
    hasNumber(value, "pid") &&
    isInteger(pid) &&
    pid > 0 &&
    hasNumber(value, "processGroupID") &&
    isInteger(processGroupID) &&
    processGroupID > 0 &&
    hasString(value, "startToken") &&
    hasString(value, "instanceNonce")
  );
};

export function parseProcessIdentity(value: unknown): ProcessIdentity {
  return parseContract(value, isProcessIdentity, "process identity");
}
