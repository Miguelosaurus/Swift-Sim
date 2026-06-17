import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export class SessionStore {
  constructor({ path = join(homedir(), ".swift-sim", "sessions.json") } = {}) {
    this.path = path;
    this.sessions = new Map();
    this.load();
  }

  create(input) {
    const now = new Date().toISOString();
    const session = {
      id: randomUUID(),
      token: input.token,
      project: input.project,
      scheme: input.scheme,
      simulatorUDID: input.simulatorUDID,
      remoteBaseUrl: input.remoteBaseUrl || "",
      createdAt: now,
      updatedAt: now,
      build: { state: "external-or-not-run" },
      stream: {
        state: "starting",
        transport: input.transport || "serve-sim",
        quality: "fallback",
        localUrl: "",
        previewUrl: "",
        wsUrl: "",
        port: undefined,
        pid: undefined,
        raw: {},
        limitations: [],
      },
      logs: [],
    };
    this.save(session);
    return session;
  }

  save(session) {
    session.updatedAt = new Date().toISOString();
    this.sessions.set(session.id, session);
    this.flush();
    return session;
  }

  get(sessionId) {
    this.load();
    return this.sessions.get(sessionId);
  }

  list() {
    this.load();
    return [...this.sessions.values()];
  }

  findReusable({ project, scheme, simulatorUDID }) {
    return this.list().find((session) => (
      session.simulatorUDID === simulatorUDID &&
      session.project === project &&
      session.scheme === scheme &&
      session.stream.state === "running"
    ));
  }

  load() {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw);
      this.sessions = new Map(parsed.sessions.map((session) => [session.id, session]));
    } catch {
      this.sessions = new Map();
    }
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({ sessions: [...this.sessions.values()] }, null, 2)
    );
  }
}
