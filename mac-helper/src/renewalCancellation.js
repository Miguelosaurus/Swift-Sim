import { randomUUID } from "node:crypto";

const processNonce = randomUUID();

export function renewalCancellationPath(cancelPath, {
  pid = process.pid,
  nonce = processNonce,
} = {}) {
  const base = String(cancelPath || "");
  if (!base) return "";
  const numericPID = Number(pid);
  const safePID = Number.isInteger(numericPID) && numericPID > 0 ? numericPID : 0;
  const safeNonce = String(nonce || "process")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 64) || "process";
  return `${base}.renewal-${safePID}-${safeNonce}.cancelled`;
}

export function renewalCancellationFilePrefix(cancelPath) {
  return `${String(cancelPath || "")}.renewal-`;
}

export function isProcessScopedRenewalCancellationPath(path) {
  return /\.renewal-\d+-[a-zA-Z0-9-]+\.cancelled$/.test(String(path || ""));
}
