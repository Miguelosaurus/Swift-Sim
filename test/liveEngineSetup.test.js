import test from "node:test";
import assert from "node:assert/strict";
import {
  installLiveEngineForSetup,
  inspectInstalledEngineForSetup,
} from "../mac-helper/src/liveReload.js";
import { COMPONENTS } from "../mac-helper/src/componentCompatibility.js";
import { signedEngineFixture } from "./fixtures/signed-engine.js";

test(
  "real signed clean install, upgrade and repeat setup retain no archive or backup",
  { skip: process.platform !== "darwin" },
  async (t) => {
    const f = signedEngineFixture();
    t.after(f.dispose);
    const archive = f.archive();
    let requests = 0,
      stops = 0;
    const options = {
      rootPath: f.state,
      spec: { ...COMPONENTS.engine, sha256: archive.sha256 },
      runtime: {
        arch: "arm64",
        fetch: async (url) => {
          assert.equal(url, COMPONENTS.engine.url);
          requests++;
          return new Response(archive.bytes);
        },
        stop: async () => {
          stops++;
          assert.deepEqual(f.manifest(), f.original);
        },
      },
    };
    const result = await installLiveEngineForSetup(options);
    assert.equal(result.state, "installed");
    assert.equal(
      result.compatible,
      false,
      "a synthetic signed test binary is not the production engine",
    );
    assert.equal(inspectInstalledEngineForSetup(f.state).sha256, archive.sha256);
    assert.deepEqual(f.names(), ["InjectionNext.app", "manifest.json"]);
    const repeat = await installLiveEngineForSetup(options);
    assert.equal(repeat.state, "unchanged");
    assert.equal(requests, 1);
    assert.equal(stops, 1);
  },
);
for (const kind of ["checksum", "signature", "size", "http"])
  test(
    `real setup rejects ${kind} failure before stopping the current engine`,
    { skip: process.platform !== "darwin" },
    async (t) => {
      const f = signedEngineFixture();
      t.after(f.dispose);
      const archive = f.archive(kind === "signature");
      let stops = 0;
      const spec = {
        ...COMPONENTS.engine,
        sha256: kind === "checksum" ? "0".repeat(64) : archive.sha256,
      };
      const fetch = async () =>
        kind === "http"
          ? new Response("missing", { status: 404 })
          : new Response(
              archive.bytes,
              kind === "size"
                ? { headers: { "content-length": String(spec.maxArchiveBytes + 1) } }
                : {},
            );
      await assert.rejects(
        installLiveEngineForSetup({
          rootPath: f.state,
          spec,
          runtime: {
            arch: "arm64",
            fetch,
            stop: async () => {
              stops++;
            },
          },
        }),
      );
      assert.equal(stops, 0);
      assert.equal(f.hasCurrent(), true);
      assert.deepEqual(f.manifest(), f.original);
      assert.deepEqual(f.names(), ["InjectionNext.app", "manifest.json"]);
    },
  );
