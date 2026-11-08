import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  renameSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeAtomicFileStore } from "../../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
export const desired = {
  version: "0.5.7",
  sha256: "a".repeat(64),
  sourceRevision: "b".repeat(40),
  localCandidate: false,
};
export const original = Buffer.from('{"version":"0.4.0","operatorField":"preserve"}\n');
export function engineFixture() {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-engine-transaction-"));
  mkdirSync(join(root, "app"));
  writeFileSync(join(root, "app", "marker"), "old");
  writeFileSync(join(root, "manifest.json"), original, { mode: 0o600 });
  return { root, ...engineIO(root), dispose: () => rmSync(root, { recursive: true, force: true }) };
}
export function engineIO(root, after = () => {}) {
  const app = join(root, "app"),
    backup = join(root, "backup"),
    stage = join(root, "stage"),
    staged = join(stage, "app"),
    manifest = join(root, "manifest.json"),
    journal = join(root, "journal.json");
  const files = new NodeAtomicFileStore();
  const id = (path) => (existsSync(path) ? `${lstatSync(path).dev}:${lstatSync(path).ino}` : null);
  const io = {
    currentIdentity: () => id(app),
    backupIdentity: () => id(backup),
    stagedIdentity: () => id(staged),
    stageExists: () => existsSync(stage),
    readManifest: () => (existsSync(manifest) ? readFileSync(manifest) : null),
    readJournal: () => (existsSync(journal) ? JSON.parse(readFileSync(journal, "utf8")) : null),
    async writeJournal(j) {
      await files.writeJSON(journal, j, {
        mode: 0o600,
        createParentMode: 0o700,
        replace: true,
        syncDirectory: true,
      });
      after("journal:" + j.phase);
    },
    async writeManifest(j) {
      await files.writeJSON(manifest, j, {
        mode: 0o600,
        createParentMode: 0o700,
        replace: true,
        syncDirectory: true,
      });
      after("manifest");
    },
    async restoreManifest(bytes) {
      if (bytes === null) rmSync(manifest, { force: true });
      else
        await files.writeText(manifest, bytes.toString("utf8"), {
          mode: 0o600,
          createParentMode: 0o700,
          replace: true,
          syncDirectory: true,
        });
    },
    backupCurrent() {
      renameSync(app, backup);
      after("backup");
    },
    publishStaged() {
      renameSync(staged, app);
      after("publish");
    },
    restoreBackup() {
      renameSync(backup, app);
    },
    removeCurrent() {
      rmSync(app, { recursive: true, force: true });
    },
    removeBackup() {
      rmSync(backup, { recursive: true, force: true });
      after("removeBackup");
    },
    removeStage() {
      rmSync(stage, { recursive: true, force: true });
      after("removeStage");
    },
    removeJournal() {
      rmSync(journal, { force: true });
    },
  };
  const prepare = async () => {
    mkdirSync(staged, { recursive: true });
    writeFileSync(join(staged, "marker"), "new");
    after("prepare");
  };
  const verifyCurrent = async (expected) => {
    try {
      return (
        readFileSync(join(app, "marker"), "utf8") === "new" &&
        JSON.parse(readFileSync(manifest, "utf8")).sha256 === expected.sha256
      );
    } catch {
      return false;
    }
  };
  const snapshot = () => ({
    marker: existsSync(app) ? readFileSync(join(app, "marker"), "utf8") : null,
    manifest: existsSync(manifest) ? readFileSync(manifest) : null,
    names: readdirSync(root).sort(),
  });
  return { io, prepare, verifyCurrent, snapshot };
}
