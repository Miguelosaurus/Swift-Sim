import { randomUUID } from "node:crypto";
import { SessionStore as BaseSessionStore } from "./sessionStoreBase.js";
import {
  cleanupSimulatorLifecycleClaims,
  registerSimulatorSessionStore,
  reserveSimulatorLifecycleClaim,
  simulatorSessionRuntimeSnapshot,
} from "./simulatorLifecycle.js";

const SESSION_START_LEASE_MS = 60_000;

export class SessionStore extends BaseSessionStore {
  constructor(options = {}) {
    super(options);
    this.publishLifecycleRegistry();
  }

  create(input) {
    this.reconcileTarget(input);
    const session = super.create(input);
    session.stream.raw = {
      ...(session.stream.raw || {}),
      swiftSimLifecycleClaimID: randomUUID(),
    };
    super.save(session);
    this.publishLifecycleRegistry();
    reserveSimulatorLifecycleClaim(session, { storeID: this.path });
    return session;
  }

  save(session) {
    const saved = super.save(session);
    this.publishLifecycleRegistry();
    const snapshot = safeRuntimeSnapshot(saved);
    if (saved?.stream?.state === "running" && snapshot?.disposition === "owned-running") {
      cleanupSimulatorLifecycleClaims(saved);
    }
    return saved;
  }

  findReusable(input) {
    this.reconcileTarget(input);
    const session = super.findReusable(input);
    this.publishLifecycleRegistry();
    return session;
  }

  flush() {
    const result = super.flush();
    this.publishLifecycleRegistry();
    return result;
  }

  reconcileTarget(input = {}) {
    const simulatorUDID = String(input.simulatorUDID || input.simulator || "").trim();
    if (!simulatorUDID) return;
    const project = input.project === undefined ? null : String(input.project || "");
    const scheme = input.scheme === undefined ? null : String(input.scheme || "");
    let sessions;
    try {
      sessions = [...super.readCurrentState().values()].map((session) => structuredClone(session));
    } catch {
      this.publishLifecycleRegistry(false);
      return;
    }
    for (const session of sessions) {
      if (session.simulatorUDID !== simulatorUDID) continue;
      if (project !== null && session.project !== project) continue;
      if (scheme !== null && session.scheme !== scheme) continue;
      const snapshot = safeRuntimeSnapshot(session);
      if (!snapshot || ["busy", "unreadable"].includes(snapshot.disposition)) continue;
      if (session.stream?.state === "running" && snapshot.disposition === "owned-running") {
        // The durable session already contains the complete stream projection.
        // Runtime state intentionally contains only a minimal public projection,
        // so re-promoting an exact owner would erase its URLs and controls.
        continue;
      }
      if (["starting", "running"].includes(session.stream?.state)
          && ["handoff-running", "claimed-running"].includes(snapshot.disposition)) {
        if (snapshot.projection) this.promoteSession(session, snapshot);
        continue;
      }
      if (session.stream?.state === "running"
          && ["stopped", "failed", "superseded"].includes(snapshot.disposition)) {
        this.retireSession(session, snapshot.disposition);
        continue;
      }
      if (session.stream?.state === "starting"
          && startLeaseExpired(session)
          && ["stopped", "failed", "missing", "superseded"].includes(snapshot.disposition)) {
        // A fresh start may temporarily observe terminal state from the
        // predecessor runtime, including the native-to-fallback handoff.
        // Preserve its lease until expiry unless a running claim is adopted.
        this.retireSession(session, snapshot.disposition);
      }
    }
    this.publishLifecycleRegistry();
  }

  promoteSession(session, snapshot) {
    const projection = snapshot.projection;
    const runtimeNonce = String(snapshot.runtime?.nonce || "").trim();
    if (!projection || !runtimeNonce) return;
    session.stream = {
      ...session.stream,
      ...projection,
      state: "running",
      raw: {
        ...(session.stream?.raw || {}),
        swiftSimLifecycleNonce: runtimeNonce,
      },
    };
    session.logs.push(`reconciled ${session.stream.transport || "serve-sim"} runtime after helper recovery`);
    super.save(session);
    cleanupSimulatorLifecycleClaims(session);
  }

  retireSession(session, disposition) {
    session.stream.state = disposition === "failed" ? "failed" : "stopped";
    session.logs.push(`retired stale Simulator session after runtime became ${disposition}`);
    super.save(session);
    cleanupSimulatorLifecycleClaims(session);
  }

  publishLifecycleRegistry(readable = true) {
    let sessions = [];
    if (readable) {
      try {
        sessions = [...super.readCurrentState().values()].map((session) => structuredClone(session));
      } catch {
        readable = false;
      }
    }
    registerSimulatorSessionStore(this.path, sessions, { readable });
  }
}

function safeRuntimeSnapshot(session) {
  try { return simulatorSessionRuntimeSnapshot(session); } catch { return null; }
}

function startLeaseExpired(session) {
  const updatedAt = Date.parse(session?.updatedAt || session?.createdAt || "");
  return !Number.isFinite(updatedAt) || updatedAt + SESSION_START_LEASE_MS <= Date.now();
}
