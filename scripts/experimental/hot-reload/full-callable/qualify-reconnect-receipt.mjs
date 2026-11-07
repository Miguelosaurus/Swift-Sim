#!/usr/bin/env node
// Actual SwiftUI replacements, production ledger + engine; only transport is a loss-injecting fixture.
// No phone, live engine, simulator, helper, notification service, or product source edits.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const out = resolve(process.argv[2]), sdk = resolve(process.argv[3]);
assert(!existsSync(out)); assert(existsSync(join(sdk, 'Sources/InjectionNext/PreparedDelivery.swift')));
mkdirSync(out, { recursive: true, mode: 0o700 });
const attempts = [];
function run(command, args, overrides = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, SWIFT_SIM_DISABLE_CLIENT_AUTOCONNECT: '1', ...overrides } });
  attempts.push({ command, args, status: result.status, stdout: result.stdout, stderr: result.stderr });
  writeFileSync(join(out, 'attempts.json'), JSON.stringify(attempts, null, 2), { mode: 0o600 });
  assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout;
}
const fixture = join(out, 'fixture');
run(process.execPath, [resolve('scripts/experimental/hot-reload/full-callable/qualify-added-state.mjs'), fixture]);
chmodSync(join(fixture, 'libPatch2.dylib'), 0o600);
const source = `import SwiftUI
import AppKit
import Darwin
import CryptoKit
import SwiftSimLive
import InstalledApp
// Only the unused image-symbol convenience API is shimmed. Coverage was checked
// by the production inspector in the fixture above; the ledger and engine are real.
struct ImageSymbols { func swiftSymbols(withSuffixes: [String]) -> [(symbol: String, address: Int)] { [] } }
final class ConfigStore { static let shared = ConfigStore(); var codesigningIdentity: String? = "-" }
class ControlServer {
 struct ActionResult { let success: Bool; let data: [String: Any]?; let error: String?
  static func ok(_ data: [String: Any]? = nil) -> ActionResult { .init(success: true, data: data, error: nil) }
  static func fail(_ error: String) -> ActionResult { .init(success: false, data: nil, error: error) }
 }
}
enum InjectionCommand: Int { case metrics = 5, preparedInject = 11 }
final class InjectionServer {
 static let clientQueue = DispatchQueue(label: "QualificationTransport")
 static let client = InjectionServer(); static var metadata: [String: Any]?
 static func preparedTarget() -> (InjectionServer, [String: Any])? { guard let metadata else { return nil }; return (client, metadata) }
 func preparedMetadata() -> [String: Any]? { Self.metadata }
 func writePrepared(command: Int, metadata: String, data: Data, timeout: Double) -> Bool {
  let request = try! JSONSerialization.jsonObject(with: Data(metadata.utf8)) as! [String: Any]
  if command == InjectionCommand.preparedInject.rawValue {
   DispatchQueue.main.async { Bridge.apply(request, data) }
  } else {
   precondition(command == InjectionCommand.metrics.rawValue && data.isEmpty && timeout <= 0.3)
   precondition(request["notification_name"] as? String == "SWIFT_SIM_PREPARED_RECEIPT_QUERY")
   Bridge.queries += 1
   Bridge.ledger.recoverReceipt(request: request["request"] as! [String: Any], identity: Bridge.identity) { report in
    PreparedDeliveryEngine.record(report, from: self)
   }
  }
  return true
 }
}
enum Bridge {
 static let ledger = PreparedDeliveryLedger(feedback: nil)
 static let contract: [String: Any] = ["version": 3, "swift_replacements": 2, "objc_callbacks": []]
 static var identity: [String: Any] = ["bundle_id": "fixture.reconnect", "build_number": "1", "executable_uuid": "fixture-exe",
  "debug_dylib_uuid": "fixture-debug", "process_nonce": "same-native-process", "connection_nonce": "first-socket",
  "root_revision": 0, "is_active": true, "root_ready": true]
 static var images: [UnsafeMutableRawPointer] = []; static var owners = 0; static var refreshes = 0
 static var lostReports = 0; static var queries = 0
 static func connect() { InjectionServer.metadata = ["identity": identity, "capabilities": PreparedDeliveryEngine.capabilities + ["replacement-proof-v3", "state-preserving-refresh-v1", "prepared-receipt-query-v1"]] }
 @MainActor static func load(_ n: Int) {
  guard let image = dlopen(CommandLine.arguments[1] + "/libPatch" + String(n) + ".dylib", RTLD_NOW | RTLD_GLOBAL) else { fatalError(String(cString: dlerror())) }
  images.append(image); refresh()
 }
 @MainActor static func apply(_ request: [String: Any], _ data: Data) {
  guard ledger.begin(request: request, data: data, identity: identity, deliver: { _ in lostReports += 1 }) else { return }
  owners += 1; load(2); refreshes += 1; identity["root_revision"] = 1
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
   ledger.finish(request: request, identity: identity, report: ["succeeded": true, "applied": true, "refresh_acknowledged": true,
    "root_revision": 1, "refresh_strategy": "preserve-state-v1", "admission": "applied", "dynamic_replacements": 2,
    "expected_swift_replacements": 2, "represented_replacements": 2, "objc_replacements": 0,
    "objc_callback_proofs": [], "complete_replacement_coverage": true])
   identity["connection_nonce"] = "replacement-socket"; connect()
  }
 }
}
@main enum Run {
 @MainActor static func main() throws {
  let app = NSApplication.shared; app.setActivationPolicy(.prohibited)
  let window = NSWindow(contentRect: NSRect(x: -10000, y: -10000, width: 400, height: 400), styleMask: .borderless, backing: .buffered, defer: false)
  let a = Probe(), b = Probe(); window.contentView = NSHostingView(rootView: VStack { Installed(a); Installed(b) }); window.orderFront(nil)
  let path = CommandLine.arguments[1] + "/libPatch2.dylib", data = try Data(contentsOf: URL(fileURLWithPath: path))
  let request: [String: Any] = ["request_id": UUID().uuidString, "patch_digest": PreparedDeliveryLedger.digest(data), "path": path,
   "expires_at_ms": Date().timeIntervalSince1970 * 1000 + 300000, "baseline_revision": 0, "attempt_id": "one-apply",
   "expected_identity": Bridge.identity, "replacement_proof": Bridge.contract, "refresh_strategy": "preserve-state-v1"]
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { a.setExisting?(7); b.setExisting?(12) }
  DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) { Bridge.load(1) }
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { a.setAdded?(9); b.setAdded?(22); a.setDraft?("kept"); b.setDraft?("separate") }
  DispatchQueue.main.asyncAfter(deadline: .now() + 1.7) {
   precondition(a.existing == 7 && b.existing == 12 && a.added == 9 && b.added == 22)
   Bridge.connect(); let admission = PreparedDeliveryEngine.inject(request); precondition(admission.success, admission.error ?? "admission failed")
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) {
   precondition(Bridge.owners == 1 && Bridge.refreshes == 1 && Bridge.lostReports == 1)
   precondition(a.existing == 7 && b.existing == 12 && a.added == 9 && b.added == 22)
   precondition(a.draft == "kept" && b.draft == "separate")
   DispatchQueue.concurrentPerform(iterations: 32) { _ in _ = PreparedDeliveryEngine.query(request) }
   InjectionServer.clientQueue.sync {}
   precondition(PreparedDeliveryEngine.query(request).data?["state"] as? String == "completed")
   precondition(Bridge.queries == 1 && Bridge.owners == 1 && Bridge.refreshes == 1)
   for _ in 0..<32 { precondition(PreparedDeliveryEngine.inject(request).data?["state"] as? String == "completed") }
   a.setLater?(true); a.setAdded?(10); b.setAdded?(23)
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + 3.1) {
   InjectionServer.clientQueue.sync {}
   precondition(Bridge.owners == 1 && Bridge.refreshes == 1 && Bridge.queries == 1)
   precondition(a.existing == 7 && b.existing == 12 && a.added == 10 && b.added == 23)
   precondition(a.draft == "kept" && b.draft == "separate" && a.later && !b.later)
   precondition(a.childAppearances == 1 && b.childAppearances == 1)
   Bridge.load(3)
  }
  DispatchQueue.main.asyncAfter(deadline: .now() + 3.7) {
   precondition(a.existing == 7 && b.existing == 12)
   print("RECONNECT_STATE_PASS owners=1 refreshes=1 queries=1 duplicates=32 existing=7/12 added=10/23 drafts=kept/separate flag=true appearances=1/1 restored=true")
   window.close(); app.stop(nil); exit(0)
  }
  app.run()
 }
}
`;
const runner = join(out, 'RecoveryRunner.swift'); writeFileSync(runner, source, { mode: 0o600 });
const binary = join(out, 'runner');
run('/usr/bin/xcrun', ['swiftc', '-swift-version', '5', '-D', 'DEBUG', '-parse-as-library',
  '-import-objc-header', join(sdk, 'Sources/InjectionNextC/include/PreparedProofPointer.h'),
  '-I', fixture, '-L', fixture, '-Xlinker', '-rpath', '-Xlinker', fixture,
  join(sdk, 'Sources/InjectionNext/PreparedReplacementProof.swift'), join(sdk, 'Sources/InjectionNext/PreparedDelivery.swift'),
  join(sdk, 'App/InjectionNext/PreparedDeliveryEngine.swift'), runner, '-lSwiftSimLive', '-lInstalledApp', '-o', binary]);
const receipt = run(binary, [fixture], { SWIFT_SIM_PREPARED_ROOT: fixture });
assert.match(receipt, /RECONNECT_STATE_PASS/);
writeFileSync(join(out, 'receipt.json'), JSON.stringify({ passed: true, receipt, phoneRequests: 0, transport: 'loss-injecting fixture', engineAndLedger: 'production source' }, null, 2), { mode: 0o600 });
console.log(receipt.trim());
