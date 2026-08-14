export interface DurableSessionRecord {
  id: string;
  token: string;
  project: string;
  scheme: string;
  simulatorUDID: string;
  createdAt: string;
}

/**
 * Frozen P4-SESSION-BOUNDARY projection. The legacy aggregate `updatedAt` and
 * `revision` are intentionally absent because SessionStore advances them for
 * runtime/stream writes as well as domain changes. A later repository must not
 * copy those mixed-authority epochs without an explicit orchestrator decision.
 */
export const DURABLE_SESSION_FIELDS = [
  "id",
  "token",
  "project",
  "scheme",
  "simulatorUDID",
  "createdAt",
] as const satisfies readonly (keyof DurableSessionRecord)[];
