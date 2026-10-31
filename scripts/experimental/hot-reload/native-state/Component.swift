#if DEBUG && SWIFT_SIM_EXPERIMENTAL_STATE
import Foundation
import FrontierStateBootstrap

// These layouts/metadata belong only to this versioned dylib. They never
// impersonate or resize FirstState or an already allocated app object.
private struct OldState: Codable { let count: Int }
private struct RichState: Codable { var count: Int; var history: [Int]; var multiplier: Int }
private final class NextComponent: FrontierComponent {
    private var migrations = 0
    #if FRONTIER_V4
    var version: Int { 4 }
    #elseif FRONTIER_V3
    var version: Int { 3 }
    #else
    var version: Int { 2 }
    #endif
    func migrate(_ data: Data, from: Int) throws -> Data {
        #if FRONTIER_FAIL
        // Failure occurs after exactly one staged migration, exercising all-or-none.
        migrations += 1
        if migrations == 2 { throw FrontierFailure.migration }
        #endif
        let next: RichState
        if from == 1 {
            next = RichState(count: try JSONDecoder().decode(OldState.self, from: data).count, history: [], multiplier: multiplier)
        } else if from == 2 || from == 3 {
            let prior = try JSONDecoder().decode(RichState.self, from: data)
            next = RichState(count: prior.count, history: prior.history, multiplier: multiplier)
        } else { throw FrontierFailure.migration }
        return try JSONEncoder().encode(next)
    }
    private var multiplier: Int {
        #if FRONTIER_V4
        return 1 // Forward compensation: old behavior, current state schema.
        #else
        return version
        #endif
    }
    func step(_ data: Data, input: Int) throws -> Data {
        var value = try JSONDecoder().decode(RichState.self, from: data)
        value.history.append(input); value.count += input * value.multiplier
        return try JSONEncoder().encode(value)
    }
    func count(_ data: Data) throws -> Int { try JSONDecoder().decode(RichState.self, from: data).count }
}

#if FRONTIER_V4
@_cdecl("frontier_install_v4")
#elseif FRONTIER_V3
@_cdecl("frontier_install_v3")
#elseif FRONTIER_FAIL
@_cdecl("frontier_install_failure")
#else
@_cdecl("frontier_install_v2")
#endif
public func install(_ opaque: UnsafeMutableRawPointer?, _ expected: Int32) -> Int32 {
    guard let opaque else { return 2 }
    let registry = Unmanaged<FrontierRegistry>.fromOpaque(opaque).takeUnretainedValue()
    do { try registry.install(NextComponent(), expected: Int(expected)); return 0 }
    catch { return 1 }
}
#endif
