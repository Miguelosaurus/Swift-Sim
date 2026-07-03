import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";

export class DeviceBuildStore {
  constructor({ path = join(homedir(), ".swift-sim", "device-builds.json") } = {}) {
    this.path = path;
    this.builds = new Map();
    this.load();
  }

  create(input) {
    const now = new Date().toISOString();
    const build = {
      id: randomUUID(),
      token: input.token || randomBytes(24).toString("base64url"),
      remoteBaseUrl: input.remoteBaseUrl || "",
      delivery: {
        mode: input.delivery || (input.remoteBaseUrl ? "custom" : "quick-tunnel"),
        provider: input.remoteBaseUrl ? "user-configured" : "cloudflare-quick-tunnel",
        expiresAt: "",
      },
      project: input.project || "",
      workspace: input.workspace || "",
      scheme: input.scheme || "",
      configuration: input.configuration || "Release",
      exportMethod: input.exportMethod || "development",
      preserveData: input.preserveData !== false,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + normalizeDeviceBuildTTLMinutes(input.ttlMinutes) * 60 * 1000).toISOString(),
      state: "queued",
      app: {
        name: input.scheme || "iOS App",
        bundleIdentifier: "",
        version: "",
        build: "",
        teamID: "",
      },
      signing: {
        style: "",
        method: input.exportMethod || "development",
        deviceInstallable: false,
        updateSafe: "unknown",
        warnings: [],
      },
      artifacts: {
        root: "",
        archivePath: "",
        exportPath: "",
        ipaPath: "",
        manifestPath: "",
      },
      logs: [],
    };
    this.save(build);
    return build;
  }

  save(build) {
    build.updatedAt = new Date().toISOString();
    this.builds.set(build.id, build);
    this.flush();
    return build;
  }

  get(id) {
    this.load();
    return this.builds.get(id);
  }

  list() {
    this.load();
    return [...this.builds.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  load() {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw);
      this.builds = new Map((parsed.builds || []).map((build) => [build.id, build]));
    } catch {
      this.builds = new Map();
    }
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({ builds: [...this.builds.values()] }, null, 2)
    );
  }
}
