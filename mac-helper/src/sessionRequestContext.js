import { AsyncLocalStorage } from "node:async_hooks";

const sessionRequestStorage = new AsyncLocalStorage();

export function enterSessionRequestContext({ transport = "" } = {}) {
  sessionRequestStorage.enterWith({ transport: String(transport || "") });
}

export function currentSessionTransportPreference() {
  return String(sessionRequestStorage.getStore()?.transport || "");
}
