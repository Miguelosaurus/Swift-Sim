import Foundation

public final class CallableProbe {
    private var storage = 5
    public init() {}
    public func compute(
        value: Int,
        transform: @escaping @Sendable (Int) async throws -> Int
    ) async throws -> Int {
        let transformed = try await transform(value)
        return transformed + storage + /*VERSION*/1
    }
    public func grouped(_ values: [Int]) async -> Int {
        await withTaskGroup(of: Int.self) { group in
            for value in values { group.addTask { value * /*VERSION*/1 } }
            var total = 0
            for await value in group { total += value }
            return total
        }
    }
    public func generic<T: BinaryInteger>(_ value: T) -> T where T: Sendable {
        value + T(/*VERSION*/1)
    }
    public var computed: Int { storage + /*VERSION*/1 }
    public subscript(_ index: Int) -> Int {
        get async { index + /*VERSION*/1 }
    }
}
public actor ActorProbe {
    public init() {}
    public func isolated(value: Int) async -> Int {
        await Task.yield()
        return value + /*VERSION*/1
    }
}
public func freeFunction(value: Int) async throws -> Int {
    try await Task.sleep(nanoseconds: 1)
    return value + /*VERSION*/1
}
