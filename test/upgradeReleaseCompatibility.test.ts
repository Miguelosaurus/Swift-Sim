import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  parsePairingCredential,
  parsePairingInvitation,
} from "../mac-helper/src/contracts/pairing.js";
import {
  NodeAtomicFileStore,
} from "../mac-helper/src/infrastructure/nodeAtomicFileStore.js";
import {
  parseDeviceBuildLegacySnapshot,
} from "../mac-helper/src/persistence/deviceBuildLockedLegacySnapshot.js";

const FIXTURE_ROOT = resolve("test/fixtures/upgrade-evidence/v0.6.1");
const STATE_ROOT = join(FIXTURE_ROOT, "home", ".swift-sim");

test(
  "published v0.6.1 persisted state remains readable by current contracts",
  () => {
    const fileStore = new NodeAtomicFileStore();
    const manifest = JSON.parse(
      fileStore.readTextSync(join(FIXTURE_ROOT, "manifest.json")),
    );
    assert.equal(manifest.sourceRelease.tag, "v0.6.1");
    assert.equal(
      manifest.sourceRelease.commit,
      "23d671bdb7c712d1680a06e8fec9e9e973038b8a",
    );
    assert.equal(manifest.sourceRelease.asset, "swift-sim-0.6.1.tar.gz");
    assert.equal(
      manifest.sourceRelease.assetSha256,
      "c8edc4c7efac93d161540d9b34ca762856875929351de2b7975e5923784307aa",
    );

    const credential = parsePairingCredential(
      JSON.parse(fileStore.readTextSync(join(STATE_ROOT, "pairing.json"))),
    );
    const invitations = JSON.parse(
      fileStore.readTextSync(join(STATE_ROOT, "pairing-invites.json")),
    ).map(parsePairingInvitation);
    assert.equal(credential.installationID, "installation-v061");
    assert.equal(invitations[0]?.id, "upgrade-invite-v061");

    const deviceBuilds = parseDeviceBuildLegacySnapshot(
      fileStore.readTextSync(join(STATE_ROOT, "device-builds.json")),
      "v0.6.1/device-builds.json",
    );
    assert.equal(deviceBuilds.sourceVersion, 5);
    assert.equal(deviceBuilds.snapshot.builds[0]?.id, "build-v061");
    assert.equal(
      deviceBuilds.snapshot.builds[0]?.app.bundleIdentifier,
      "com.example.swiftsim.upgradefixture",
    );
  },
);
