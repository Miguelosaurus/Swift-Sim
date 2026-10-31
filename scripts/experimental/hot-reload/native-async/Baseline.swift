import Foundation

public actor SuspensionGate {
    private var continuations: [Int: CheckedContinuation<Void, Never>] = [:]
    public init() {}
    public func hold(_ id: Int) async {
        await withCheckedContinuation { continuations[id] = $0 }
    }
    public func entered(_ id: Int) -> Bool { continuations[id] != nil }
    public func release(_ id: Int) { continuations.removeValue(forKey: id)?.resume() }
}

public enum ProbeError: Error { case negative }

public final class AsyncProbe: @unchecked Sendable {
    public init() {}
    public dynamic func work(_ input: Int, scale: Int) async throws -> Int {
        guard input >= 0 else { throw ProbeError.negative }
        return input * scale
    }
    public dynamic func generic<T: BinaryInteger & Sendable>(_ value: T) async -> T { value }
    public dynamic func mapping<T: Sendable, U: Sendable>(_ value: T, using operation: @Sendable (T) async throws -> U) async rethrows -> (U, Int) where U: Equatable {
        (try await operation(value), 0)
    }
    public dynamic func typed(_ value: Int) async throws(ProbeError) -> Int {
        if value < 0 { throw .negative }
        return value
    }
    public dynamic func mutate(_ value: inout Int) async { value += 1 }
    public dynamic func overloaded(_ value: Int) async -> String { "base-int-\(value)" }
    public dynamic func overloaded(_ value: String) async -> String { "base-string-\(value)" }
    public dynamic func rethrowing(_ operation: @Sendable () async throws -> Int) async rethrows -> Int {
        try await operation()
    }
    public dynamic var asyncValue: Int { get async throws { 10 } }
    public dynamic subscript(_ index: Int) -> Int { get async { index } }
    public dynamic func callback(_ body: @Sendable (Int) -> Int) async -> Int { body(1) }
    public dynamic func makeClosure(_ seed: Int) async -> @Sendable () -> Int {
        let captured = seed
        return { captured }
    }
    public dynamic func suspended(_ gate: SuspensionGate, id: Int) async throws -> Int {
        await gate.hold(id)
        try Task.checkCancellation()
        return id
    }
    public dynamic func cancellation(_ gate: SuspensionGate, id: Int, marker: CancellationMarker) async throws -> Int {
        try await withTaskCancellationHandler {
            await gate.hold(id)
            try Task.checkCancellation()
            return id
        } onCancel: { marker.record(0) }
    }
}

public final class CancellationMarker: @unchecked Sendable {
    private let lock = NSLock()
    private var values: [Int] = []
    public init() {}
    public func record(_ value: Int) { lock.lock(); defer { lock.unlock() }; values.append(value) }
    public func read() -> [Int] { lock.lock(); defer { lock.unlock() }; return values }
}

public actor ActorProbe {
    private var count = 0
    public init() {}
    public dynamic func advance(_ increment: Int) async -> Int {
        count += increment
        await Task.yield()
        return count
    }
    public dynamic func interleave(_ gate: SuspensionGate, id: Int) async -> Int {
        count += 1
        await gate.hold(id)
        count += 1
        return count
    }
}

@MainActor public final class MainProbe {
    private var count = 0
    public init() {}
    public dynamic func advance(_ increment: Int) async -> Int { count += increment; return count }
}

public final class GenericProbe<T: BinaryInteger & Sendable>: @unchecked Sendable {
    public init() {}
    public dynamic func value(_ input: T) async throws -> T { input }
}
