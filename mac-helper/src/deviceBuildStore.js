import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import {
  deviceBuildExpiryDate,
  normalizeDeviceBuildTTLMinutes,
} from "./deviceBuildDefaults.js";

export const MAX_DEVICE_BUILD_LOG_LINES = 500;
export const ACTIVE_DEVICE_BUILD_STATES = new Set([
  "queued",
  "preparing",
  "building",
  "archiving",
  "exporting",
  "delivering",
]);

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
      ttlMinutes: normalizeDeviceBuildTTLMinutes(input.ttlMinutes),
      // The install-link lifetime begins only after delivery is ready.
      expiresAt: "",
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
    normalizeBuild(build);
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

  renewInstallLink(id, { ttlMinutes } = {}) {
    const build = this.get(id);
    if (!build) return null;
    build.ttlMinutes = normalizeDeviceBuildTTLMinutes(ttlMinutes);
    build.expiresAt = deviceBuildExpiryDate(build.ttlMinutes);
    if (build.delivery?.mode !== "custom") {
      build.remoteBaseUrl = "";
      build.delivery = {
        mode: "quick-tunnel",
        provider: "cloudflare-quick-tunnel",
        expiresAt: "",
      };
    } else {
      build.delivery.expiresAt = build.expiresAt;
    }
    return this.save(build);
  }

  saveVerification(id, verification) {
    const build = this.get(id);
    if (!build) return null;
    const previous = normalizeInstallation(build.installation);
    const reportedState = verification.state || "unknown";
    const nextState = reportedState === "unknown" && previous.state === "requested"
      ? "requested"
      : reportedState;
    build.installation = {
      ...previous,
      state: nextState,
      verifiedAt: reportedState === "verified"
        ? verification.verifiedAt || new Date().toISOString()
        : previous.verifiedAt,
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
      const identity = build.app?.identity || deviceAppIdentity(build.app);
      // A failed build that never resolved a signed bundle is diagnostic history,
      // not an app. Treating its build UUID as an app created duplicate rows.
      if (!identity) continue;
      if (!grouped.has(identity)) {
        const saved = this.apps.get(identity) || {};
        const isInternal = isInternalCatalogBuild(build);
        grouped.set(identity, {
          id: identity,
          name: build.app?.name || build.scheme || "iOS App",
          bundleIdentifier: build.app?.bundleIdentifier || "",
          teamID: build.app?.teamID || "",
          archivedAt: saved.archivedAt || (isInternal ? build.createdAt : ""),
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

  latestReusableBuildForApp(id) {
    const app = this.getApp(id);
    if (!app) return null;
    return app.builds.find((build) => (
      build.state === "ready"
      && Boolean(build.project || build.workspace)
      && Boolean(build.scheme)
      && Boolean(build.app?.bundleIdentifier)
      && Boolean(build.app?.teamID)
    )) || null;
  }

  nextBuildNumber(app, projectBuildNumber = "") {
    const identity = deviceAppIdentity(app);
    if (!identity) return String(projectBuildNumber || "");
    const projectNumber = parseBuildNumber(projectBuildNumber);
    const previousNumbers = this.list()
      .filter((build) => (
        build.app?.identity === identity
        || deviceAppIdentity(build.app) === identity
      ))
      .map((build) => parseBuildNumber(build.app?.build))
      .filter((value) => value !== null);
    const previousMaximum = previousNumbers.length > 0
      ? Math.max(...previousNumbers)
      : null;

    if (projectNumber === null && previousMaximum === null) return String(projectBuildNumber || "");
    if (previousMaximum === null) return String(projectNumber);
    if (projectNumber === null) return String(previousMaximum + 1);
    return String(Math.max(projectNumber, previousMaximum + 1));
  }

  findRebuild({ appID, idempotencyKey, activeOnly = false }) {
    return this.list().find((build) => {
      if (build.rebuild?.appID !== appID) return false;
      if (idempotencyKey && build.rebuild?.idempotencyKey !== idempotencyKey) return false;
      return !activeOnly || ACTIVE_DEVICE_BUILD_STATES.has(build.state);
    }) || null;
  }

  createRebuild(source, { appID, idempotencyKey }) {
    const build = this.create({
      project: source.project,
      workspace: source.workspace,
      scheme: source.scheme,
      configuration: source.configuration,
      exportMethod: source.exportMethod,
      preserveData: true,
      delivery: "quick-tunnel",
    });
    build.buildSettings = Array.isArray(source.buildSettings)
      ? [...source.buildSettings]
      : [];
    build.allowProvisioningUpdates = Boolean(source.allowProvisioningUpdates);
    build.app = { ...source.app };
    build.signing = {
      ...build.signing,
      method: source.exportMethod || source.signing?.method || "development",
      updateSafe: "identity-check-pending",
      warnings: [],
    };
    build.rebuild = {
      appID,
      sourceBuildID: source.id,
      idempotencyKey,
      expectedBundleIdentifier: source.app.bundleIdentifier,
      expectedTeamID: source.app.teamID,
    };
    build.logs.push("Build requested from Swift Sim on iPhone.");
    return this.save(build);
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

export function isInternalCatalogBuild(build = {}) {
  const project = String(build.project || build.workspace || "").replaceAll("\\", "/");
  const bundleIdentifier = String(build.app?.bundleIdentifier || "").toLowerCase();
  return (
    project.includes("/Swift-Sim/.build/qa-")
    || project.includes("/Swift-Sim/Companion/")
    || project.includes("/SwiftSimPhysicalProbe/")
    || (project.includes("/tmp/") && bundleIdentifier.endsWith(".test"))
    || project.includes("/swift-sim-benchmark-")
    || project.includes("/swift-sim-debug-device-")
    || project.includes("benchmarks/fixtures/")
    || bundleIdentifier === "dev.local.mirrorqa"
    || bundleIdentifier === "dev.local.swiftsimcompanion"
    || bundleIdentifier === "com.seaandsea.swiftsimcompanion"
    || bundleIdentifier === "com.seaandsea.swiftsimupdateprobe"
    || bundleIdentifier === "com.miguel.swift-sim-physical-probe"
    || bundleIdentifier === "com.swiftsim.benchmark.catalog"
  );
}

function normalizeBuild(build) {
  build.ttlMinutes = normalizeDeviceBuildTTLMinutes(build.ttlMinutes);
  build.app = build.app || {};
  build.app.identity = build.app.identity || deviceAppIdentity(build.app);
  build.installation = normalizeInstallation(build.installation);
  build.logs = Array.isArray(build.logs)
    ? build.logs.slice(-MAX_DEVICE_BUILD_LOG_LINES)
    : [];
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

function parseBuildNumber(value) {
  const text = String(value || "").trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : null;
}
