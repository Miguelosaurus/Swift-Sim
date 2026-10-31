import Foundation

#if DEBUG && SWIFT_SIM_EXPERIMENTAL_STATE
import Darwin
import FrontierStateBootstrap

private var loadedImages: [UnsafeMutableRawPointer] = []
private var checks = 0
func check(_ condition: @autoclosure () throws -> Bool, _ name: String) throws {
    guard try condition() else { fatalError("failed: \(name)") }; checks += 1
}
func rejected(_ name: String, _ operation: () throws -> Void) throws {
    do { try operation() } catch { checks += 1; return }
    fatalError("accepted negative case: \(name)")
}
func load(_ name: String, into registry: FrontierRegistry, expected: Int? = nil) throws -> Int32 {
    let library = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("lib\(name).dylib")
    guard let image = dlopen(library.path, RTLD_NOW | RTLD_LOCAL) else { fatalError(String(cString: dlerror())) }
    loadedImages.append(image) // Never unload code while old leases may retain it.
    guard let address = dlsym(image, "frontier_install_\(name)") else { fatalError(String(cString: dlerror())) }
    let install = unsafeBitCast(address, to: (@convention(c) (UnsafeMutableRawPointer?, Int32) -> Int32).self)
    return install(Unmanaged.passUnretained(registry).toOpaque(), Int32(expected ?? registry.currentGeneration))
}
func step(_ registry: FrontierRegistry, id: UUID, account: String, input: Int) throws {
    let lease = try registry.lease(id: id, account: account)
    try registry.commit(lease.evaluate(input), lease: lease)
}
private struct ReentrantComponent: FrontierComponent {
    let registry: FrontierRegistry
    var version: Int { 5 }
    func migrate(_ data: Data, from: Int) throws -> Data {
        _ = try registry.register(account: "unexpected-reentrant-account")
        return data
    }
    func step(_ data: Data, input: Int) throws -> Data { data }
    func count(_ data: Data) throws -> Int { try FrontierV1().count(data) }
}

let registry = FrontierRegistry(binary: "same-bootstrap-binary")
if CommandLine.arguments.count == 5, CommandLine.arguments[2] == "restore" {
    // A fresh OS process must load compatible implementation code explicitly.
    try check(registry.currentVersion == 1 && registry.recordCount == 0, "fresh baseline")
    try check(load("v2", into: registry) == 0, "relaunch load v2")
    try check(load("v3", into: registry) == 0, "relaunch load v3")
    try registry.restoreState(Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[3])))
    let id = UUID(uuidString: CommandLine.arguments[4])!
    try check(registry.count(id: id, account: "A") == 15, "restored encoded state")
    try step(registry, id: id, account: "A", input: 1)
    try check(registry.count(id: id, account: "A") == 18, "restored v3 behavior")
    print("FRONTIER_RESTORATION_PASS checks=\(checks)")
} else {
    let existingObject = try FrontierObject(registry: registry, account: "A")
    let identity = ObjectIdentifier(existingObject)
    let a = existingObject.id, b = try registry.register(account: "B")
    try step(registry, id: a, account: "A", input: 5)
    try check(registry.count(id: a, account: "A") == 5, "v1 existing object")
    let old = try registry.lease(id: a, account: "A")
    let before = try registry.exportState()
    try check(load("failure", into: registry) == 1, "migration failure rejected")
    try check(registry.currentVersion == 1 && registry.currentGeneration == 0, "failed cutover unchanged")
    try check(registry.count(id: a, account: "A") == 5 && registry.count(id: b, account: "B") == 0, "failed migration all state unchanged")
    try check(load("v2", into: registry) == 0, "v2 loaded and committed")
    try check(registry.currentVersion == 2, "v2 metadata installed")
    let oldBytes = try old.evaluate(100)
    try rejected("old in-flight generation") { try registry.commit(oldBytes, lease: old) }
    try step(registry, id: a, account: "A", input: 2)
    try check(registry.count(id: a, account: "A") == 9, "v2 richer state preserved original count")
    try check(registry.count(id: b, account: "B") == 0, "account B isolated")
    try rejected("cross account lookup") { _ = try registry.lease(id: a, account: "B") }
    let newer = try registry.lease(id: a, account: "A")
    try step(registry, id: a, account: "A", input: 0)
    try rejected("racing same-generation lease") { try registry.commit(newer.evaluate(50), lease: newer) }
    try check(load("v3", into: registry, expected: 0) == 1, "stale install queue rejected")
    try check(load("v3", into: registry) == 0, "v3 repeated upgrade")
    try step(registry, id: a, account: "A", input: 2)
    try check(registry.count(id: a, account: "A") == 15, "v3 preserves prior migrated state")
    try check(ObjectIdentifier(existingObject) == identity && existingObject.id == a, "fixed-layout existing object survives")
    let newObject = try FrontierObject(registry: registry, account: "A")
    try step(registry, id: newObject.id, account: "A", input: 1)
    try check(registry.count(id: newObject.id, account: "A") == 3, "new and old objects coexist after upgrade")
    try registry.remove(id: newObject.id, account: "A")
    try check(registry.count(id: b, account: "B") == 0, "account B remains isolated")
    try check(load("v2", into: registry) == 1, "version regression rejected")
    // Baseline fixed-layout object's sidecar identifier survives every cutover.
    let checkpoint = try registry.exportState()
    let checkpointPath = URL(fileURLWithPath: CommandLine.arguments[1]).appendingPathComponent("checkpoint.json")
    try checkpoint.write(to: checkpointPath)
    let wrongBinary = FrontierRegistry(binary: "different-binary")
    try rejected("binary identity restoration") { try wrongBinary.restoreState(before) }
    try rejected("schema code absent on baseline") { try FrontierRegistry(binary: "same-bootstrap-binary").restoreState(checkpoint) }
    let child = Process(); let pipe = Pipe()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    child.arguments = [CommandLine.arguments[1], "restore", checkpointPath.path, a.uuidString]
    child.standardOutput = pipe; child.standardError = pipe; try child.run()
    let childOutput = String(decoding: pipe.fileHandleForReading.readDataToEndOfFile(), as: UTF8.self)
    child.waitUntilExit()
    try check(child.terminationStatus == 0 && childOutput.contains("FRONTIER_RESTORATION_PASS"), "fresh process state restoration")
    let beforeCompensation = try registry.lease(id: a, account: "A")
    try check(load("v4", into: registry) == 0, "forward compensation loaded")
    try step(registry, id: a, account: "A", input: 1)
    try check(registry.count(id: a, account: "A") == 16, "compensation restores old behavior while preserving state")
    try rejected("pre-compensation in-flight write") { try registry.commit(beforeCompensation.evaluate(99), lease: beforeCompensation) }
    let generationBeforeReentrant = registry.currentGeneration
    try rejected("reentrant migration mutation") { try registry.install(ReentrantComponent(registry: registry), expected: generationBeforeReentrant) }
    try check(registry.currentGeneration == generationBeforeReentrant && registry.currentVersion == 4 && registry.recordCount == 2, "reentrant failure leaves code and state intact")
    let json = Data("{\"thumbnailLimit\":32}".utf8)
    let resourceGeneration = registry.currentGeneration
    try rejected("resource path traversal") { try registry.stageResources(["../Info.plist": json], expected: resourceGeneration) }
    try rejected("signing metadata staging") { try registry.stageResources(["Entitlements.plist": json], expected: resourceGeneration) }
    try rejected("resource excessive bytes") { try registry.stageResources(["copy.json": Data(repeating: 65, count: 65_537)], expected: resourceGeneration) }
    try rejected("invalid resource all-or-none") { try registry.stageResources(["copy.json": json, "theme.json": Data("invalid".utf8)], expected: resourceGeneration) }
    try check(registry.resource("copy.json") == nil, "invalid resource transaction unchanged")
    try registry.stageResources(["thumbnail-policy.json": json], expected: resourceGeneration)
    try check(registry.resource("thumbnail-policy.json") == json, "configuration staged outside bundle")
    try rejected("stale resource queue") { try registry.stageResources(["copy.json": json], expected: resourceGeneration) }
    let concurrentID = try registry.register(account: "A")
    DispatchQueue.concurrentPerform(iterations: 100) { _ in
        while true {
            do {
                let lease = try registry.lease(id: concurrentID, account: "A")
                try registry.commit(lease.evaluate(1), lease: lease)
                break
            } catch FrontierFailure.stale { continue }
            catch { fatalError("unexpected concurrent failure: \(error)") }
        }
    }
    try check(registry.count(id: concurrentID, account: "A") == 100, "concurrent revision fence loses no updates")
    try registry.remove(id: concurrentID, account: "A")
    let cancelled = try registry.lease(id: b, account: "B")
    try registry.signOut(account: "B")
    try rejected("signed-out in-flight write") { try registry.commit(cancelled.evaluate(1), lease: cancelled) }
    try check(registry.recordCount == 1, "account cleanup exact")
    try registry.remove(id: a, account: "A")
    try check(registry.recordCount == 0, "object cleanup")
    try rejected("signed-out registration") { _ = try registry.register(account: "signed-out") }
    print("FRONTIER_STATE_PASS checks=\(checks) loadCalls=\(loadedImages.count) distinctImages=\(Set(loadedImages.map { UInt(bitPattern: $0) }).count)")
    print(childOutput.trimmingCharacters(in: .whitespacesAndNewlines))
}
#else
print("FRONTIER_RELEASE_INERT")
#endif
