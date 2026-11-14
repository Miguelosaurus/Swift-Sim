import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createFullCallableCompiler } from "../mac-helper/src/fullCallableCompiler.js";
import { NodeCommandRunner } from "../mac-helper/src/infrastructure/nodeCommandRunner.js";

const path = "/tmp/Theme.swift";
const nonce = "0123456789abcdef0123456789abcdef";
test("real generator instruments and patches only eligible recorded constants", { skip: process.platform !== "darwin" }, t => {
  const root = mkdtempSync(join(tmpdir(), "swift-sim-constant-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const compiler = createFullCallableCompiler({ runner: new NodeCommandRunner({ spawn, spawnSync }), cacheRoot: join(root, "cache") });
  const source = `struct Theme {
 static let accent: Color = .blue
 static let amount: Int = 42 // comment
 static let font: Font = .system(size: 14, weight: .bold)
 static let multiline: [Double] = [
   1.5
 ]
 static let link: URL? = URL(string: "https://example.com")
 static let values: [Int] = [1, -2]
 static let inferred = 1
 static let date: Date = Date()
 static let impure: Color = Color.make()
 @MainActor static let actor: Int = 1
 let instance: Int = 1
 static var variable: Int = 1
 static let interpolated: String = "\\(42)"
}
extension Color { static let brand: Color = .red }
struct Generic<T> { static let value: Int = 1 }
class Reference { static let value: Int = 1 }
`;
  const transformed = compiler.instrument({ files: [{ path, source }] }).files[0];
  assert.deepEqual([...transformed.constants].sort(), ["Color.brand", "Theme.accent", "Theme.amount", "Theme.font", "Theme.link", "Theme.multiline", "Theme.values"]);
  assert.match(transformed.source, /^#sourceLocation\(file: .*line: 1\)\n/);
  assert.equal(transformed.source.slice(transformed.source.indexOf("\n") + 1).split("\n").length, source.split("\n").length);
  assert.doesNotMatch(transformed.source, /^import (?:SwiftSimLive|SwiftUI)/m);
  for (const name of ["accent", "amount", "font", "multiline", "link", "values", "brand"]) assert.match(transformed.source, new RegExp(`static var ${name}:`));
  for (const name of ["inferred", "date", "impure", "actor", "interpolated"]) assert.match(transformed.source, new RegExp(`static let ${name}`));
  assert.match(transformed.source, /static var amount: Int \{ 42 \} \/\/ comment/);
  assert.match(transformed.source, /let instance: Int = 1/);
  assert.match(transformed.source, /static var variable: Int = 1/);
  assert.match(transformed.source, /struct Generic<T> \{ static let value/);
  assert.match(transformed.source, /class Reference \{ static let value/);
  for (const declaration of ["struct Color {}", "typealias Color = Int"]) {
    const files = compiler.instrument({ files: [{ path, source }, { path: "/tmp/Shadow.swift", source: declaration }] }).files;
    const keys = files.find(file => file.path === path).constants;
    assert(!keys.includes("Theme.accent")); assert(!keys.includes("Color.brand"));
  }
  const before = "struct Theme { static let accent: Color = .blue\n func label() -> Int { 1 } }";
  const generate = (after, constants = ["Theme.accent"]) => compiler.generate({ module: "Fixture", generation: nonce,
    files: [{ path, before, after }], statefulConstants: { [path]: constants } });
  const result = generate(before.replace(".blue", ".red"));
  assert.equal(result.constantProtocol, 1); assert.equal(result.changedMemberCount, 1);
  // Constants are lowered only with a complete view inventory, so refresh keeps state.
  assert.equal(result.refreshStrategy, "preserve-state-v1");
  assert.equal(generate(before.replace(".blue", ".red").replace("{ 1 }", "{ 2 }")).refreshStrategy, "remount");
  assert.equal(result.members[0].kind, "property"); assert.equal(result.members[0].isStatic, true);
  assert.match(result.sources[0], /@_dynamicReplacement\(for: accent\)/);
  for (const [after, constants] of [
    [before.replace("Color = .blue", "Int = 1"), ["Theme.accent"]],
    [before.replace(".blue", "Color.make()"), ["Theme.accent"]],
    [before.replace(".blue", ".red"), []],
  ]) assert.throws(() => generate(after, constants), { code: "QUEUED_MECHANISM_UNSUPPORTED" });
  assert.equal(generate(before.replace("{ 1 }", "{ 2 }")).constantProtocol, 0);
  // Durable delivery tries the additive planner; it must see the installed
  // getter form rather than a changed stored property.
  const additive = compiler.generate({ module: "Fixture", generation: nonce, allowAdditive: true,
    files: [{ path, before, after: before.replace(".blue", ".red"), installedBaseline: before }],
    statefulConstants: { [path]: ["Theme.accent"] } });
  assert.equal(additive.constantProtocol, 1); assert.notEqual(additive.additiveProtocol, 1);
});
