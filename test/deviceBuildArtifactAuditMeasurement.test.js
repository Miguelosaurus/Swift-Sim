import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { NodeDeviceBuildArtifactUsage } from "../mac-helper/src/infrastructure/nodeDeviceBuildArtifactUsage.js";
import { createDeviceBuildArtifactAuditService } from "../mac-helper/src/deviceBuildArtifactAuditService.js";

const ARTIFACT_DIRECTORY = "/private/tmp/swift-sim/device-builds";

function fakeDirent(name, { directory = true, symlink = false } = {}) {
  return {
    name,
    isDirectory: () => directory,
    isSymbolicLink: () => symlink,
  };
}

function fakeStat({ directory = false, symlink = false } = {}) {
  return {
    isDirectory: () => directory,
    isSymbolicLink: () => symlink,
  };
}

function build(id, { root = resolve(ARTIFACT_DIRECTORY, id), compilerReady = false } = {}) {
  return {
    id,
    state: "ready",
    liveReload: { compilerReady },
    artifacts: {
      root,
      archivePath: resolve(root, "App.xcarchive"),
      exportPath: resolve(root, "export"),
      ipaPath: resolve(root, "export", "App.ipa"),
      resultBundlePath: resolve(root, "App.xcresult"),
    },
  };
}

function usageHarness({ entries, sizes, pathKinds = {} }) {
  const commands = [];
  const commandRunner = {
    async run(request) {
      commands.push(request);
      const paths = request.args.slice(1);
      return {
        code: 0,
        stdout: paths.map((path) => `${sizes[path] ?? 0}\t${path}`).join("\n"),
        stderr: "",
        error: "",
      };
    },
  };
  const usage = new NodeDeviceBuildArtifactUsage({
    commandRunner,
    environmentNames: () => ["PATH"],
    readDirectory: () => entries,
    lstat: (path) => {
      if (path === ARTIFACT_DIRECTORY) return fakeStat({ directory: true });
      const kind = pathKinds[path];
      if (kind === "missing" || kind === undefined) {
        const error = Object.assign(new Error("missing"), { code: "ENOENT" });
        throw error;
      }
      if (kind === "symlink") return fakeStat({ symlink: true });
      if (kind === "directory") return fakeStat({ directory: true });
      return fakeStat();
    },
  });
  return { usage, commands };
}

test("usage adapter measures canonical roots/components and reports orphan roots without mutation", async () => {
  const first = build("build-1");
  const second = build("build-2", { compilerReady: true });
  const orphan = resolve(ARTIFACT_DIRECTORY, "orphan");
  const paths = {
    firstRoot: first.artifacts.root,
    firstDerived: resolve(first.artifacts.root, "DerivedData"),
    firstArchive: first.artifacts.archivePath,
    firstExport: first.artifacts.exportPath,
    firstIpa: first.artifacts.ipaPath,
    firstResult: first.artifacts.resultBundlePath,
    firstScratch: resolve(first.artifacts.root, "ExportOptions.plist"),
    secondRoot: second.artifacts.root,
    secondDerived: resolve(second.artifacts.root, "DerivedData"),
    secondExport: second.artifacts.exportPath,
    secondIpa: second.artifacts.ipaPath,
  };
  const sizes = {
    [paths.firstRoot]: 1_000,
    [paths.firstDerived]: 500,
    [paths.firstArchive]: 100,
    [paths.firstExport]: 200,
    [paths.firstResult]: 20,
    [paths.firstScratch]: 10,
    [paths.secondRoot]: 2_000,
    [paths.secondDerived]: 1_500,
    [paths.secondExport]: 300,
    [orphan]: 25,
  };
  const pathKinds = Object.fromEntries(Object.keys(sizes).map((path) => [path, "directory"]));
  pathKinds[paths.firstScratch] = "file";
  pathKinds[paths.firstIpa] = "file";
  pathKinds[paths.secondIpa] = "file";
  const { usage, commands } = usageHarness({
    entries: [fakeDirent("build-1"), fakeDirent("build-2"), fakeDirent("orphan")],
    sizes,
    pathKinds,
  });

  const result = await usage.measure({ builds: [first, second], artifactDirectory: ARTIFACT_DIRECTORY });

  assert.equal(result.inventory.length, 2);
  assert.deepEqual(result.inventory[0], {
    buildID: "build-1",
    root: paths.firstRoot,
    totalKiB: 1_000,
    derivedDataKiB: 500,
    archiveKiB: 100,
    resultBundleKiB: 20,
    exportPayloadKiB: 200,
    scratchKiB: 10,
  });
  assert.equal(result.inventory[1].derivedDataKiB, 1_500);
  assert.deepEqual(result.orphanRoots, [{ name: "orphan", root: orphan, totalKiB: 25 }]);
  assert.deepEqual(result.issues, []);
  assert.ok(commands.length >= 1);
  assert.ok(commands.every((command) => command.executable === "/usr/bin/du"));
  assert.ok(commands.every((command) => command.args[0] === "-sk"));
});

test("ready audit never counts a root or IPA ancestor as reclaimable", async () => {
  const value = build("protected-alias");
  value.artifacts.archivePath = value.artifacts.exportPath;
  value.artifacts.resultBundlePath = value.artifacts.root;
  const sizes = {
    [value.artifacts.root]: 1_000,
    [resolve(value.artifacts.root, "DerivedData")]: 500,
    [value.artifacts.exportPath]: 300,
  };
  const pathKinds = Object.fromEntries(Object.keys(sizes).map((path) => [path, "directory"]));
  pathKinds[value.artifacts.ipaPath] = "file";
  const { usage } = usageHarness({
    entries: [fakeDirent(value.id)],
    sizes,
    pathKinds,
  });

  const result = await usage.measure({ builds: [value], artifactDirectory: ARTIFACT_DIRECTORY });

  assert.equal(result.inventory[0].derivedDataKiB, 500);
  assert.equal(result.inventory[0].archiveKiB, 0);
  assert.equal(result.inventory[0].resultBundleKiB, 0);
  assert.equal(result.inventory[0].exportPayloadKiB, 300);
  assert.ok(result.issues.some((entry) => entry.code === "component-protects-install-payload"));
});

test("ready audit excludes reclaimable intermediates when the retained IPA cannot be proven safe", async () => {
  const value = build("missing-ipa");
  const sizes = {
    [value.artifacts.root]: 1_000,
    [resolve(value.artifacts.root, "DerivedData")]: 500,
    [value.artifacts.archivePath]: 100,
    [value.artifacts.exportPath]: 200,
  };
  const pathKinds = Object.fromEntries(Object.keys(sizes).map((path) => [path, "directory"]));
  const { usage } = usageHarness({
    entries: [fakeDirent(value.id)],
    sizes,
    pathKinds,
  });

  const result = await usage.measure({ builds: [value], artifactDirectory: ARTIFACT_DIRECTORY });

  assert.equal(result.inventory[0].derivedDataKiB, 0);
  assert.equal(result.inventory[0].archiveKiB, 0);
  assert.equal(result.inventory[0].resultBundleKiB, 0);
  assert.equal(result.inventory[0].scratchKiB, 0);
  assert.equal(result.inventory[0].exportPayloadKiB, 200);
  assert.ok(result.issues.some((entry) => entry.code === "install-payload-unproven"));
});

test("usage adapter fails safe on mismatched, symlinked, and outside-root metadata", async () => {
  const mismatched = build("mismatch", { root: "/private/tmp/elsewhere/mismatch" });
  const symlinked = build("symlinked");
  const outside = build("outside");
  outside.artifacts.archivePath = "/private/tmp/outside.xcarchive";
  const outsideRoot = outside.artifacts.root;
  const outsideExport = outside.artifacts.exportPath;
  const outsideIpa = outside.artifacts.ipaPath;
  const sizes = {
    [outsideRoot]: 100,
    [outsideExport]: 50,
  };
  const { usage } = usageHarness({
    entries: [fakeDirent("mismatch"), fakeDirent("symlinked", { symlink: true }), fakeDirent("outside")],
    sizes,
    pathKinds: {
      [outsideRoot]: "directory",
      [outsideExport]: "directory",
      [outsideIpa]: "file",
    },
  });

  const result = await usage.measure({
    builds: [mismatched, symlinked, outside],
    artifactDirectory: ARTIFACT_DIRECTORY,
  });

  assert.deepEqual(result.inventory.map((entry) => entry.buildID), ["outside"]);
  assert.ok(result.issues.some((entry) => entry.code === "root-mismatch" && entry.buildID === "mismatch"));
  assert.ok(result.issues.some((entry) => entry.code === "unsafe-root" && entry.buildID === "symlinked"));
  assert.ok(result.issues.some((entry) => entry.code === "component-outside-root" && entry.buildID === "outside"));
  assert.equal(result.inventory[0].archiveKiB, 0);
});

test("usage adapter never follows an unsafe artifact-directory symlink", async () => {
  let listed = false;
  const usage = new NodeDeviceBuildArtifactUsage({
    commandRunner: {
      async run() {
        throw new Error("must not run");
      },
    },
    environmentNames: () => [],
    readDirectory: () => {
      listed = true;
      return [];
    },
    lstat: () => fakeStat({ symlink: true }),
  });

  const result = await usage.measure({ builds: [], artifactDirectory: ARTIFACT_DIRECTORY });

  assert.equal(listed, false);
  assert.deepEqual(result.inventory, []);
  assert.ok(result.issues.some((entry) => entry.code === "unsafe-artifact-directory"));
});

test("audit service composes measurement and planner without exposing cleanup", async () => {
  const value = build("service-build");
  const usage = {
    async measure() {
      return {
        inventory: [
          {
            buildID: value.id,
            root: value.artifacts.root,
            totalKiB: 1_000,
            derivedDataKiB: 500,
            archiveKiB: 100,
            resultBundleKiB: 20,
            exportPayloadKiB: 200,
            scratchKiB: 10,
          },
        ],
        orphanRoots: [],
        issues: [],
      };
    },
  };
  const service = createDeviceBuildArtifactAuditService({
    listBuilds: () => [value],
    artifactDirectory: () => ARTIFACT_DIRECTORY,
    usage,
  });

  const result = await service.inspect();

  assert.equal(result.readOnly, true);
  assert.equal(result.measurementComplete, true);
  assert.equal(result.reclaimableKiB, 630);
  assert.equal("cleanup" in service, false);
  assert.equal("delete" in service, false);
});
