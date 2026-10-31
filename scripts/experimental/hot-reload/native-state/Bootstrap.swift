import Foundation

#if DEBUG && SWIFT_SIM_EXPERIMENTAL_STATE
// An experimental bootstrap boundary, not a modification of existing instances'
// layout. Every stored product-state version lives in a separate encoded value.
public enum FrontierFailure: Error { case stale, account, migration, resource, identity }
public protocol FrontierComponent {
    var version: Int { get }
    func migrate(_ data: Data, from: Int) throws -> Data
    func step(_ data: Data, input: Int) throws -> Data
    func count(_ data: Data) throws -> Int
}

private struct FirstState: Codable { var count: Int }
public struct FrontierV1: FrontierComponent {
    public init() {}
    public var version: Int { 1 }
    public func migrate(_ data: Data, from: Int) throws -> Data {
        guard from == 1 else { throw FrontierFailure.migration }; return data
    }
    public func step(_ data: Data, input: Int) throws -> Data {
        var value = try JSONDecoder().decode(FirstState.self, from: data)
        value.count += input; return try JSONEncoder().encode(value)
    }
    public func count(_ data: Data) throws -> Int { try JSONDecoder().decode(FirstState.self, from: data).count }
}

public struct FrontierLease {
    fileprivate let id: UUID
    fileprivate let account: String
    fileprivate let generation: Int
    fileprivate let revision: Int
    fileprivate let bytes: Data
    // Strongly retains old code/metadata while an operation is in flight.
    fileprivate let component: any FrontierComponent
    public func evaluate(_ input: Int) throws -> Data { try component.step(bytes, input: input) }
}
public final class FrontierObject {
    public let id: UUID
    public let account: String
    public init(registry: FrontierRegistry, account: String) throws {
        self.account = account; self.id = try registry.register(account: account)
    }
}
private struct Record: Codable {
    var account: String
    var revision: Int
    var bytes: Data
}
private struct SavedState: Codable {
    var binary: String
    var component: Int
    var records: [UUID: Record]
}

public final class FrontierRegistry {
    private let lock = NSRecursiveLock()
    private let binary: String
    private var component: any FrontierComponent = FrontierV1()
    private var records: [UUID: Record] = [:]
    private var generation = 0
    private var installing = false
    private var resources: [String: Data] = [:]
    public init(binary: String) { self.binary = binary }
    private func synchronized<T>(_ operation: () throws -> T) rethrows -> T {
        lock.lock(); defer { lock.unlock() }; return try operation()
    }
    public var currentGeneration: Int { synchronized { generation } }
    public var currentVersion: Int { synchronized { component.version } }
    public var recordCount: Int { synchronized { records.count } }
    public func register(account: String) throws -> UUID {
        try synchronized {
            guard !installing else { throw FrontierFailure.stale }
            guard !account.isEmpty, account != "signed-out" else { throw FrontierFailure.account }
            let id = UUID()
            let first = try JSONEncoder().encode(FirstState(count: 0))
            records[id] = Record(account: account, revision: 0, bytes: try component.migrate(first, from: 1))
            return id
        }
    }
    public func lease(id: UUID, account: String) throws -> FrontierLease {
        try synchronized {
            guard let record = records[id], record.account == account else { throw FrontierFailure.account }
            return FrontierLease(id: id, account: account, generation: generation, revision: record.revision,
                                 bytes: record.bytes, component: component)
        }
    }
    public func commit(_ bytes: Data, lease: FrontierLease) throws {
        try synchronized {
            guard !installing else { throw FrontierFailure.stale }
            guard let current = records[lease.id], current.account == lease.account else { throw FrontierFailure.account }
            guard generation == lease.generation, current.revision == lease.revision else { throw FrontierFailure.stale }
            _ = try component.count(bytes)
            records[lease.id] = Record(account: current.account, revision: current.revision + 1, bytes: bytes)
        }
    }
    public func count(id: UUID, account: String) throws -> Int {
        let current = try lease(id: id, account: account); return try current.component.count(current.bytes)
    }
    public func install(_ candidate: any FrontierComponent, expected: Int) throws {
        try synchronized {
            guard !installing, generation == expected, candidate.version > component.version else { throw FrontierFailure.stale }
            installing = true; defer { installing = false }
            var staged = records
            for (id, record) in records {
                let migrated = try candidate.migrate(record.bytes, from: component.version)
                _ = try candidate.count(migrated)
                staged[id] = Record(account: record.account, revision: record.revision + 1, bytes: migrated)
            }
            // One commit point; exceptions above retain old code and all state.
            records = staged; component = candidate; generation += 1
        }
    }
    public func remove(id: UUID, account: String) throws {
        try synchronized {
            guard !installing else { throw FrontierFailure.stale }
            guard records[id]?.account == account else { throw FrontierFailure.account }
            records.removeValue(forKey: id)
        }
    }
    public func signOut(account: String) throws {
        try synchronized {
            guard !installing else { throw FrontierFailure.stale }
            records = records.filter { $0.value.account != account }; generation += 1
        }
    }
    public func exportState() throws -> Data {
        try synchronized { try JSONEncoder().encode(SavedState(binary: binary, component: component.version, records: records)) }
    }
    public func restoreState(_ bytes: Data) throws {
        try synchronized {
            guard !installing, records.isEmpty else { throw FrontierFailure.stale }
            let saved = try JSONDecoder().decode(SavedState.self, from: bytes)
            guard saved.binary == binary, saved.component == component.version else { throw FrontierFailure.identity }
            for record in saved.records.values { _ = try component.count(record.bytes) }
            records = saved.records; generation += 1
        }
    }
    // Debug configuration/resources are staged outside Bundle.main, with an
    // explicit logical allowlist. Entitlements/native dependencies aren't data.
    public func stageResources(_ update: [String: Data], expected: Int) throws {
        try synchronized {
            guard !installing, generation == expected else { throw FrontierFailure.stale }
            let allowed = Set(["theme.json", "copy.json", "thumbnail-policy.json"])
            guard !update.isEmpty, update.allSatisfy({ allowed.contains($0.key) && $0.value.count <= 65_536 }) else { throw FrontierFailure.resource }
            for bytes in update.values { _ = try JSONSerialization.jsonObject(with: bytes, options: [.fragmentsAllowed]) }
            resources.merge(update) { _, replacement in replacement }; generation += 1
        }
    }
    public func resource(_ name: String) -> Data? { synchronized { resources[name] } }
}
#endif
