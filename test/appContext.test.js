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

test("environment tools validate values, gate old engines, and forward exact wire values", async () => {
  const f = fixture();
  try {
    for (const [option, tool, values] of [
      ["textSize", "text-size", ["app-default", "xs", "s", "m", "l", "xl", "xxl", "xxxl", "ax1", "ax2", "ax3", "ax4", "ax5"]],
      ["layoutDirection", "layout-direction", ["app-default", "ltr", "rtl"]],
    ]) {
      const calls = [];
      const old = await performAppTool({ ...f.options, [option]: values[0], control: async request => { calls.push(request); return response(); } });
      assert.equal(old.code, "APP_CONTEXT_UPDATE_REQUIRED");
      assert.equal(calls.length, 1);
      for (const value of values) {
        const requests = [];
        const result = await performAppTool({ ...f.options, [option]: value, control: async request => {
          requests.push(request);
          return request.action === "developer_context"
            ? response({ capabilities: [...capabilities, "developer-environment-v1"] })
            : response({ operation_id: request.operation_id, result: { success: true } });
        } });
        assert.equal(result.outcome, "tool-completed");
        assert.equal(result.tool, tool); assert.equal(result.value, value);
        assert.equal(requests[1].tool, tool); assert.equal(requests[1].value, value);
      }
      assert.equal((await performAppTool({ ...f.options, [option]: "invalid" })).code, "APP_CONTEXT_TOOL_INVALID");
    }
    for (const options of [{ textSize: "l", layoutDirection: "rtl" }, { appearance: "dark", textSize: "l" },
      { layoutDirection: "ltr", refresh: true }]) {
      assert.equal((await performAppTool({ ...f.options, ...options })).code, "APP_CONTEXT_TOOL_INVALID");
    }
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

function inspection(overrides = {}) {
  return { schemaVersion: 1, capturedAt: Date.now(), revision: 2, width: 390, height: 844,
    truncated: false, elements: [{ id: "e1", role: "button", label: "Save", identifier: "save",
      frame: [20, 40, 100, 44], enabled: false, selected: false, source: "accessibility" }], ...overrides };
}
function inspectionControl(snapshot, mutate = value => value) {
  return async request => request.action === "developer_context"
    ? response({ capabilities: [...capabilities, "developer-inspection-v1"] })
    : mutate(response({ operation_id: request.operation_id, result: { success: true, inspection: snapshot } }));
}

test("on-demand elements use exact connection without UI actions and allowlist native metadata", async () => {
  const f = fixture();
  try {
    const snapshot = inspection(); snapshot.elements[0].rawSecret = "omit";
    snapshot.elements.push({ id: "e2", role: "secure-input", value: "must-not-forward", frame: [20, 100, 100, 44], selected: false, source: "uikit" });
    snapshot.selectedElement = "e1";
    const requests = [];
    const control = inspectionControl(snapshot);
    const value = await readAppContext({ ...f.options, elements: true, control: async request => { requests.push(request); return control(request); } });
    assert.equal(value.outcome, "context-ready"); assert.equal(value.screen.elements[0].enabled, false);
    assert.equal(value.screen.selectedElement, "e1");
    assert.equal(value.screen.elements[1].value, undefined); assert.equal(value.screen.elements[0].rawSecret, undefined);
    assert.equal(requests.length, 2); assert.equal(requests[1].tool, "inspect");
    assert.equal(requests[1].connection_nonce, identity.connection_nonce);
    assert.deepEqual(readdirSync(f.root).sort(), ["Fixture.xcodeproj", "app-context-elements.json", "compilations.json"]);
    assert.equal(lstatSync(join(f.root, "app-context-elements.json")).mode & 0o777, 0o600);
  } finally { f.cleanup(); }
});

test("inspection rejects oversized, stale, malformed geometry, duplicate ids and fabricated selection", async () => {
  const f = fixture();
  try {
    const element = inspection().elements[0];
    for (const snapshot of [inspection({ capturedAt: Date.now() - 31_000 }), inspection({ revision: 3 }),
      inspection({ elements: Array(65).fill(element) }), inspection({ elements: [element, element] }),
      inspection({ selectedElement: "e3" }), inspection({ elements: [{ ...element, frame: [0, 0, Infinity, 40] }] }),
      inspection({ elements: [{ ...element, frame: [380, 0, 100, 40] }] }),
      inspection({ elements: [{ ...element, label: "a".repeat(161) }] }), inspection({ arbitrary: "a".repeat(33_000) })]) {
      const value = await readAppContext({ ...f.options, elements: true, control: inspectionControl(snapshot) });
      assert.equal(value.outcome, "needs-user-action"); assert.equal(value.screen, undefined);
    }
  } finally { f.cleanup(); }
});

test("inspection refuses unsupported, changed-process, changed-revision, wrong-operation and report combinations", async () => {
  const f = fixture();
  try {
    assert.equal((await readAppContext({ ...f.options, elements: true })).code, "APP_CONTEXT_UPDATE_REQUIRED");
    assert.equal(f.requests.length, 1);
    assert.equal((await readAppContext({ ...f.options, elements: true, report: "latest" })).code, "APP_CONTEXT_OPTIONS_INVALID");
    for (const mutate of [v => ({ ...v, data: { ...v.data, operation_id: "wrong" } }),
      v => ({ ...v, data: { ...v.data, identity: { ...identity, root_revision: 3 } } }),
      v => ({ ...v, data: { ...v.data, identity: { ...identity, process_nonce: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee" } } })]) {
      assert.equal((await readAppContext({ ...f.options, elements: true, control: inspectionControl(inspection(), mutate) })).code, "APP_CONTEXT_INSPECTION_UNAVAILABLE");
    }
  } finally { f.cleanup(); }
});

test("agent input taps a fresh element once, sends exact points, and never echoes typed text", async () => {
  const f = fixture(); let clock = Date.now();
  try {
    await readAppContext({ ...f.options, now: () => clock, elements: true, control: inspectionControl(inspection()) });
    const sent = [];
    const input = (options, result = { success: true }) => performAppTool({ ...f.options, now: () => clock, ...options,
      control: async request => {
        if (request.action === "developer_context") return response({ capabilities: [...capabilities, "developer-input-v1"] });
        sent.push(request); return response({ operation_id: request.operation_id, result });
      } });

    const tapped = await input({ tap: "e1" });
    assert.equal(tapped.outcome, "tool-completed"); assert.equal(tapped.target, "e1");
    assert.deepEqual([sent[0].tool, sent[0].value], ["tap", "70,62"]);
    assert.equal((await input({ tap: "e1" })).code, "APP_CONTEXT_ELEMENTS_STALE", "an action clears element IDs");
    assert.equal(sent.length, 1);

    const scrolled = await input({ scroll: "down" });
    assert.deepEqual([sent[1].tool, sent[1].value], ["swipe", "195,591,195,253"], "the screen size survives an action");
    assert.equal(scrolled.tool, "scroll");
    await input({ tap: "10.5,20" }); assert.equal(sent[2].value, "10.5,20");
    await input({ swipe: "1,2,3,4" }); assert.equal(sent[3].value, "1,2,3,4");

    const typed = await input({ type: "secret note" });
    assert.equal(sent[4].value, "secret note");
    assert.equal(JSON.stringify(typed).includes("secret"), false);
    assert.equal((await input({ type: "x" }, { success: false, error: "DEVELOPER_INPUT_NO_FOCUSED_FIELD" })).code, "APP_CONTEXT_INPUT_REJECTED");

    await readAppContext({ ...f.options, now: () => clock, elements: true, control: inspectionControl(inspection()) });
    clock += 61_000;
    assert.equal((await input({ tap: "e1" })).code, "APP_CONTEXT_ELEMENTS_STALE", "element IDs expire");
  } finally { f.cleanup(); }
});

test("agent input refuses malformed values, old engines and another process's elements before sending", async () => {
  const f = fixture();
  try {
    await readAppContext({ ...f.options, elements: true, control: inspectionControl(inspection()) });
    const sent = [];
    const input = (options, extra = { capabilities: [...capabilities, "developer-input-v1"] }) => performAppTool({ ...f.options, ...options,
      control: async request => {
        if (request.action === "developer_context") return response(extra);
        sent.push(request); return response({ operation_id: request.operation_id, result: { success: true } });
      } });
    for (const options of [{ tap: "e1", type: "x" }, { tap: "e1", appearance: "dark" }]) {
      assert.equal((await input(options)).code, "APP_CONTEXT_TOOL_INVALID");
    }
    for (const options of [{ tap: "1" }, { tap: "-1,2" }, { tap: "a,b" }, { swipe: "1,2,3" }, { scroll: "sideways" },
      { type: "" }, { type: "x".repeat(513) }]) {
      assert.equal((await input(options)).code, "APP_CONTEXT_TOOL_INVALID", JSON.stringify(options).slice(0, 40));
    }
    assert.equal((await input({ tap: "e9" })).code, "APP_CONTEXT_ELEMENTS_STALE");
    assert.equal((await input({ tap: "e1" }, { capabilities })).code, "APP_CONTEXT_UPDATE_REQUIRED");
    assert.equal((await input({ tap: "e1" }, { capabilities: [...capabilities, "developer-input-v1"],
      identity: { ...identity, process_nonce: "ffffffff-ffff-ffff-ffff-ffffffffffff" } })).code, "APP_CONTEXT_ELEMENTS_STALE");
    assert.equal((await input({ scroll: "down" }, { capabilities: [...capabilities, "developer-input-v1"],
      identity: { ...identity, root_revision: 3 } })).outcome, "tool-completed", "scrolling needs only the same process");
    assert.equal((await input({ tap: "e1" }, { capabilities: [...capabilities, "developer-input-v1"],
      identity: { ...identity, root_revision: 3 } })).code, "APP_CONTEXT_ELEMENTS_STALE");
    assert.equal(sent.length, 1);
  } finally { f.cleanup(); }
});

test("input returns a fresh screen using the action revision and falls back on inspection failure", async () => {
  const f = fixture();
  try {
    let revision = 2, failInspect = false;
    const requests = [];
    const control = async request => {
      requests.push(request);
      if (request.action === "developer_context") return response({ identity: { ...identity, root_revision: revision },
        capabilities: [...capabilities, "developer-input-v1", "developer-inspection-v1"] });
      if (request.tool === "inspect") {
        if (failInspect) throw new Error("offline");
        return response({ identity: { ...identity, root_revision: revision }, operation_id: request.operation_id,
          result: { success: true, inspection: inspection({ revision }) } });
      }
      revision = 3;
      return response({ identity: { ...identity, root_revision: revision }, operation_id: request.operation_id, result: { success: true } });
    };
    const first = await performAppTool({ ...f.options, tap: "10,20", control });
    assert.equal(first.screen.revision, 3);
    assert.equal(requests[2].tool, "inspect");
    assert.equal(requests[2].process_nonce, identity.process_nonce);
    assert.equal(requests[2].connection_nonce, identity.connection_nonce);
    const second = await performAppTool({ ...f.options, tap: "e1", control });
    assert.equal(second.outcome, "tool-completed");
    assert.equal(requests[4].value, "70,62");
    failInspect = true;
    const fallback = await performAppTool({ ...f.options, type: "private", control });
    assert.equal(fallback.outcome, "tool-completed");
    assert.equal(fallback.screen, undefined);
    assert.match(fallback.next, /Read the screen again/);
    assert.equal(JSON.stringify(fallback).includes("private"), false);
    assert.equal((await performAppTool({ ...f.options, tap: "e1", control })).code, "APP_CONTEXT_ELEMENTS_STALE");
  } finally { f.cleanup(); }
});

test("tap-label selects exact then case-insensitive matches and refuses ambiguity", async () => {
  const f = fixture();
  try {
    let elements = inspection().elements, sent = [];
    const control = async request => {
      sent.push(request);
      if (request.action === "developer_context") return response({ capabilities: [...capabilities, "developer-input-v1", "developer-inspection-v1"] });
      return response({ operation_id: request.operation_id, result: { success: true,
        ...(request.tool === "inspect" ? { inspection: inspection({ elements }) } : {}) } });
    };
    const run = tapLabel => performAppTool({ ...f.options, tapLabel, control });
    const other = { ...elements[0], id: "e2", label: "save", frame: [100, 100, 20, 20] };
    elements = [...elements, other];
    let result = await run("Save");
    assert.equal(result.target, "e1"); assert.equal(result.label, "Save"); assert.equal(result.screen.revision, 2);
    assert.equal(sent.find(r => r.tool === "tap").value, "70,62");
    sent = []; result = await run("SAVE");
    assert.equal(result.code, "APP_CONTEXT_ELEMENT_AMBIGUOUS"); assert.deepEqual(result.matchingIds, ["e1", "e2"]);
    assert.equal(sent.some(r => r.tool === "tap"), false);
    sent = []; result = await run("missing");
    assert.equal(result.code, "APP_CONTEXT_ELEMENT_NOT_FOUND"); assert.equal(sent.some(r => r.tool === "tap"), false);
    elements = [other]; result = await run("SAVE"); assert.equal(result.target, "e2");
    assert.equal((await run("")).code, "APP_CONTEXT_TOOL_INVALID");
    assert.equal((await run("x".repeat(201))).code, "APP_CONTEXT_TOOL_INVALID");
    assert.equal((await performAppTool({ ...f.options, tapLabel: "Save", control: async () => response({ capabilities: [...capabilities, "developer-input-v1"] }) })).code, "APP_CONTEXT_UPDATE_REQUIRED");
  } finally { f.cleanup(); }
});
