import { AsyncLocalStorage } from "node:async_hooks";

const sessionRequestStorage = new AsyncLocalStorage();

export function enterSessionRequestContext({ transport = "" } = {}) {
  const context = { transport: String(transport || "") };
  sessionRequestStorage.enterWith(context);
  return context;
}

export function currentSessionTransportPreference() {
  return String(sessionRequestStorage.getStore()?.transport || "");
}
