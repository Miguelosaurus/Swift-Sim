import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performAppTool, readAppContext, saveContextImage, validateContextJPEG } from "../mac-helper/src/appContext.js";
import { NodeArtifactStore } from "../mac-helper/src/infrastructure/nodeArtifactStore.js";

function readArtifact(root, path) {
  const store = new NodeArtifactStore();
  return Buffer.from(store.readSync(store.resolveContained(root, path)));
}

const identity = { bundle_id: "dev.example.fixture", bundle_version: "1.0", build_number: "7",
  executable_uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", debug_dylib_uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  process_nonce: "cccccccc-cccc-cccc-cccc-cccccccccccc", connection_nonce: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  is_active: true, root_ready: true, root_revision: 2 };
const capabilities = ["developer-context-v1"];
const response = (extra = {}) => ({ success: true, data: { schema_version: 1, identity, capabilities, ...extra } });
// Minimal SOF envelope for testing the bounded dimension parser, not a decoded
// image fixture or evidence of native capture correctness.
function image(width = 1, height = 1) {
  const bytes = Buffer.from([255, 216, 255, 192, 0, 8, 8, height >> 8, height & 255, width >> 8, width & 255, 0, 255, 217]);
  return { mimeType: "image/jpeg", bytes: bytes.length, data: bytes.toString("base64") };
}
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "swift-sim-context-")));
  chmodSync(root, 0o700);
  const capturePath = join(root, "compilations.json");
  const project = join(root, "Fixture.xcodeproj"); mkdirSync(project);
  writeFileSync(capturePath, JSON.stringify({ binaryIdentity: identity,
    binding: { projectPath: project, projectRoot: root, scheme: "Fixture" } }), { mode: 0o600 });
  const requests = [];
  const options = { project, scheme: "Fixture", capturePath, artifactRoot: root,
    control: async (request) => { requests.push(request); return response(); } };
  return { root, options, requests, cleanup() { rmSync(root, { recursive: true, force: true }); } };
}

test("context defaults to a scoped current-project observation, with no capture or setup", async () => {
  const f = fixture();
  try {
    const value = await readAppContext({ ...f.options, project: undefined, scheme: undefined, cwd: f.root });
    assert.equal(value.outcome, "context-ready");
    assert.equal(value.runtime.revision, 2);
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].screenshot, false);
    assert.equal(f.requests[0].bundle_id, identity.bundle_id);
    assert.equal(JSON.stringify(value).includes(identity.process_nonce), false);
    assert.equal(readdirSync(f.root).length, 2);
  } finally { f.cleanup(); }
});

test("wrong project, scheme and unscoped cwd never contact another app", async () => {
  const f = fixture();
  try {
    for (const extra of [{ project: join(f.root, "Other.xcodeproj") }, { scheme: "Other" }, { project: undefined, cwd: "/" }]) {
      const value = await readAppContext({ ...f.options, ...extra });
      assert.equal(value.code, "APP_CONTEXT_SCOPE_REQUIRED");
    }
    assert.equal(f.requests.length, 0);
  } finally { f.cleanup(); }
});

test("workspace-root agents infer a nested native project without crossing into another repository", async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.root, ".git"));
    const nested = join(f.root, "apps/mobile"); mkdirSync(nested, { recursive: true });
    const project = join(nested, "App.xcodeproj"); mkdirSync(project);
    writeFileSync(f.options.capturePath, JSON.stringify({ binaryIdentity: identity,
      binding: { projectPath: project, projectRoot: nested, scheme: "Fixture" } }), { mode: 0o600 });
    const value = await readAppContext({ ...f.options, project: undefined, cwd: f.root });
    assert.equal(value.outcome, "context-ready");
    const other = join(f.root, "other-repository"); mkdirSync(other); mkdirSync(join(other, ".git"));
    assert.equal((await readAppContext({ ...f.options, project: undefined, cwd: other })).code, "APP_CONTEXT_SCOPE_REQUIRED");
    assert.equal(f.requests.length, 1);
  } finally { f.cleanup(); }
});

test("wrong binary, malformed revision and old engine fail without materializing image", async () => {
  const f = fixture(); let saved = 0;
  try {
    for (const data of [response({ identity: { ...identity, debug_dylib_uuid: identity.executable_uuid } }),
      response({ identity: { ...identity, root_revision: -1 } }), response({ capabilities: [] }),
      { success: false, error: "Unknown action: developer_context /private/path" }]) {
      const result = await readAppContext({ ...f.options, screenshot: true, control: async () => data, saveImage: () => { saved++; } });
      assert.equal(result.outcome, "needs-user-action");
      assert.equal(JSON.stringify(result).includes("/private/path"), false);
    }
    assert.equal(saved, 0);
  } finally { f.cleanup(); }
});

test("explicit screenshot materializes a private bounded artifact without inline base64", async () => {
  const f = fixture();
  try {
    const payload = image();
    const result = await readAppContext({ ...f.options, screenshot: true, control: async () => response({ screenshot: payload }) });
    assert.equal(result.outcome, "context-ready");
    assert.equal(result.screenshot.width, 1);
    assert.equal(lstatSync(result.screenshot.path).mode & 0o777, 0o600);
    assert.equal(lstatSync(join(f.root, "app-context")).mode & 0o777, 0o700);
    assert.equal(readArtifact(f.root, result.screenshot.path).toString("base64"), payload.data);
    assert.equal(JSON.stringify(result).includes(payload.data), false);
  } finally { f.cleanup(); }
});

test("latest saved report is exact-build scoped and needs no foreground phone connection", async () => {
  const f = fixture(); const calls = [];
  try {
    const result = await readAppContext({ ...f.options, report: "latest", control: async (request) => {
      calls.push(request);
      assert.equal(request.action, "developer_report");
      return response({
        report_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee", created_at: new Date().toISOString(),
        identity: { ...identity, process_nonce: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        metadata: { note: "First outline looked jumpy", sdk_version: "test", phase: "refreshed", revision: 1,
          token: "never-forward", raw_log: "never-forward", source_path: "/private/source" },
        screenshot: image(),
      });
    } });
    assert.equal(result.outcome, "context-ready");
    assert.equal(result.report.fromCurrentProcess, null);
    assert.equal(result.runtime.state, "not-observed");
    assert.equal(result.report.note, "First outline looked jumpy");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].debug_dylib_uuid, identity.debug_dylib_uuid);
    assert.equal(JSON.stringify(result).includes("never-forward"), false);
    assert.equal(JSON.stringify(result).includes("/private/source"), false);
  } finally { f.cleanup(); }
});

test("busy, absent reports and background screenshot have bounded typed guidance", async () => {
  const f = fixture();
  try {
    for (const [input, code] of [[{ success: false, error: "DEVELOPER_BUSY" }, "APP_CONTEXT_BUSY"],
      [{ success: false, error: "REPORT_NOT_FOUND" }, "APP_CONTEXT_REPORT_NOT_FOUND"],
      [response({ identity: { ...identity, is_active: false }, screenshot: image() }), "APP_CONTEXT_CAPTURE_UNAVAILABLE"]]) {
      const result = await readAppContext({ ...f.options, screenshot: true, control: async () => input });
      assert.equal(result.code, code);
    }
    assert.equal((await readAppContext({ ...f.options, screenshot: true, report: "latest" })).code, "APP_CONTEXT_OPTIONS_INVALID");
  } finally { f.cleanup(); }
});

test("private capture redirection and broad permission fail before engine contact", async () => {
  const f = fixture();
  try {
    chmodSync(f.options.capturePath, 0o644);
    assert.equal((await readAppContext(f.options)).code, "APP_CONTEXT_NOT_BOUND");
    chmodSync(f.options.capturePath, 0o600);
    const alias = join(f.root, "alias.json"); symlinkSync(f.options.capturePath, alias);
    assert.equal((await readAppContext({ ...f.options, capturePath: alias })).code, "APP_CONTEXT_NOT_BOUND");
    assert.equal(f.requests.length, 0);
  } finally { f.cleanup(); }
});

test("image validation rejects oversized dimensions, noncanonical base64 and mismatched byte claims", () => {
  assert.equal(validateContextJPEG(image(1000, 2000)).width, 1000);
  for (const value of [image(2000, 2000), { ...image(), bytes: 100 }, { ...image(), data: image().data + "\n" },
    { ...image(), mimeType: "image/png" }, { ...image(), bytes: 2 ** 25 }]) assert.throws(() => validateContextJPEG(value));
});

test("artifact cache stays bounded across concurrent callers and preserves unknown entries", async () => {
  const f = fixture();
  try {
    await Promise.all(Array.from({ length: 8 }, () => saveContextImage(image(), { rootPath: f.root })));
    assert.equal(readdirSync(join(f.root, "app-context")).length, 5);
    writeFileSync(join(f.root, "app-context/keep.txt"), "preserve", { mode: 0o600 });
    await assert.rejects(saveContextImage(image(), { rootPath: f.root }));
    assert.equal(readArtifact(f.root, join(f.root, "app-context/keep.txt")).toString("utf8"), "preserve");
  } finally { f.cleanup(); }
});

test("agent tools bind an explicit action to the observed app process and connection", async () => {
  const f = fixture(); const requests = [];
  try {
    for (const options of [{ appearance: "dark" }, { refresh: true }]) {
      const value = await performAppTool({ ...f.options, ...options, control: async (request) => {
        requests.push(request);
        return request.action === "developer_context" ? response() : response({ operation_id: request.operation_id, result: { success: true } });
      } });
      assert.equal(value.outcome, "tool-completed");
      assert.equal(value.nativeCodeUpdate, false);
      assert.equal(requests.at(-1).process_nonce, identity.process_nonce);
      assert.equal(requests.at(-1).connection_nonce, identity.connection_nonce);
    }
    assert.equal(requests.length, 4);
    assert.equal(requests[2].screenshot, false);
  } finally { f.cleanup(); }
});

test("tool operation refuses ambiguous options and a changed process without claiming refresh", async () => {
  const f = fixture();
  try {
    for (const options of [{}, { appearance: "dark", refresh: true }, { appearance: "unknown" }]) {
      assert.equal((await performAppTool({ ...f.options, ...options })).code, "APP_CONTEXT_TOOL_INVALID");
    }
    assert.equal(f.requests.length, 0);
    const result = await performAppTool({ ...f.options, refresh: true, control: async (request) => request.action === "developer_context"
      ? response() : response({ identity: { ...identity, process_nonce: "ffffffff-ffff-ffff-ffff-ffffffffffff" },
        operation_id: request.operation_id, result: { success: true } }) });
    assert.equal(result.code, "APP_CONTEXT_TOOL_UNCONFIRMED");
  } finally { f.cleanup(); }
});

test("lost tool replies and native timeouts preserve uncertainty instead of recommending an update", async () => {
  const f = fixture();
  try {
    for (const reply of [null, { success: false, error: "DEVELOPER_TOOL_UNCONFIRMED" }]) {
      const result = await performAppTool({ ...f.options, appearance: "dark", control: async (request) =>
        request.action === "developer_context" ? response() : reply });
      assert.equal(result.code, "APP_CONTEXT_TOOL_UNCONFIRMED");
      assert.match(result.guidance, /do not blindly repeat/i);
    }
  } finally { f.cleanup(); }
});
