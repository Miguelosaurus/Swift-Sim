import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { normalizeDeviceBuildTTLMinutes } from "./deviceBuildDefaults.js";

export class DeviceBuildStore {
  constructor({ path = join(homedir(), ".swift-sim", "device-builds.json") } = {}) {
    this.path = path;
    this.builds = new Map();
    this.apps = new Map();
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
        identity: "",
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
      installation: {
        state: "unknown",
        requestedAt: "",
        verifiedAt: "",
        devices: [],
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

  markInstallRequested(id) {
    const build = this.get(id);
    if (!build) return null;
    build.installation = normalizeInstallation(build.installation);
    build.installation.state = build.installation.state === "verified" ? "verified" : "requested";
    build.installation.requestedAt = new Date().toISOString();
    return this.save(build);
  }

  saveVerification(id, verification) {
    const build = this.get(id);
    if (!build) return null;
    build.installation = {
      ...normalizeInstallation(build.installation),
      state: verification.state || "unknown",
      verifiedAt: verification.verifiedAt || new Date().toISOString(),
      devices: Array.isArray(verification.devices) ? verification.devices : [],
    };
    return this.save(build);
  }

  list() {
    this.load();
    return [...this.builds.values()].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  listApps({ includeArchived = false } = {}) {
    this.load();
    const grouped = new Map();
    for (const build of this.list()) {
      const identity = build.app?.identity || deviceAppIdentity(build.app) || `build-${build.id}`;
      if (!grouped.has(identity)) {
        const saved = this.apps.get(identity) || {};
        grouped.set(identity, {
          id: identity,
          name: build.app?.name || build.scheme || "iOS App",
          bundleIdentifier: build.app?.bundleIdentifier || "",
          teamID: build.app?.teamID || "",
          archivedAt: saved.archivedAt || "",
          builds: [],
        });
      }
      grouped.get(identity).builds.push(build);
    }
    return [...grouped.values()]
      .filter((app) => includeArchived || !app.archivedAt)
      .sort((a, b) => String(b.builds[0]?.createdAt || "").localeCompare(String(a.builds[0]?.createdAt || "")));
  }

  getApp(id) {
    return this.listApps({ includeArchived: true }).find((app) => app.id === id) || null;
  }

  setAppArchived(id, archived) {
    const app = this.getApp(id);
    if (!app) return null;
    const current = this.apps.get(id) || {};
    this.apps.set(id, {
      ...current,
      archivedAt: archived ? new Date().toISOString() : "",
    });
    this.flush();
    return this.getApp(id);
  }

  deleteApp(id, { deleteArtifacts = true } = {}) {
    const app = this.getApp(id);
    if (!app) return false;
    for (const build of app.builds) {
      if (deleteArtifacts && build.artifacts?.root) {
        rmSync(build.artifacts.root, { recursive: true, force: true });
      }
      this.builds.delete(build.id);
    }
    this.apps.delete(id);
    this.flush();
    return true;
  }

  load() {
    try {
      const raw = readFileSync(this.path, "utf8");
      const parsed = JSON.parse(raw);
      this.builds = new Map((parsed.builds || []).map((build) => {
        const normalized = normalizeBuild(build);
        return [normalized.id, normalized];
      }));
      this.apps = new Map(Object.entries(parsed.apps || {}));
    } catch {
      this.builds = new Map();
      this.apps = new Map();
    }
  }

  flush() {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(
      this.path,
      JSON.stringify({
        version: 2,
        apps: Object.fromEntries(this.apps),
        builds: [...this.builds.values()],
      }, null, 2)
    );
  }
}

export function deviceAppIdentity(app = {}) {
  const bundleIdentifier = String(app.bundleIdentifier || "").trim().toLowerCase();
  if (!bundleIdentifier) return "";
  const teamID = String(app.teamID || "").trim().toUpperCase();
  return createHash("sha256")
    .update(`${teamID}\0${bundleIdentifier}`)
    .digest("base64url")
    .slice(0, 24);
}

function normalizeBuild(build) {
  build.app = build.app || {};
  build.app.identity = build.app.identity || deviceAppIdentity(build.app);
  build.installation = normalizeInstallation(build.installation);
  return build;
}

function normalizeInstallation(installation = {}) {
  return {
    state: installation.state || "unknown",
    requestedAt: installation.requestedAt || "",
    verifiedAt: installation.verifiedAt || "",
    devices: Array.isArray(installation.devices) ? installation.devices : [],
  };
}
