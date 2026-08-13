import assert from "node:assert/strict";
import test from "node:test";
import { v061Provenance } from "./fixtures/upgrade-evidence/v0.6.1/fixtures.js";

test("published v0.6.1 provenance is pinned in the normal test glob", () => {
  assert.deepEqual(v061Provenance, {
    tag: "v0.6.1",
    commit: "23d671bdb7c712d1680a06e8fec9e9e973038b8a",
    publishedAt: "2026-08-02T20:22:59Z",
    asset: "swift-sim-0.6.1.tar.gz",
    assetSha256: "c8edc4c7efac93d161540d9b34ca762856875929351de2b7975e5923784307aa",
  });
});
