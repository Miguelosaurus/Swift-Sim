import Foundation
import Darwin
import SwiftSimFullCallableFixture

@main struct NativeRunner {
    static func main() async throws {
        let existing = CallableProbe()
        let actor = ActorProbe()
        var assertions = 0
        for version in 1...3 {
            if version > 1 {
                guard dlopen(CommandLine.arguments[version - 1], RTLD_NOW | RTLD_GLOBAL) != nil else {
                    fatalError(String(cString: dlerror()))
                }
            }
            let computed = try await existing.compute(value: 4) { $0 * 2 }
            precondition(computed == 13 + version)
            let grouped = await existing.grouped([1, 2, 3])
            precondition(grouped == 6 * version)
            precondition(existing.generic(Int64(10)) == Int64(10 + version))
            precondition(existing.computed == 5 + version)
            let subscriptValue = await existing[20]
            precondition(subscriptValue == 20 + version)
            let isolated = await actor.isolated(value: 10)
            precondition(isolated == 10 + version)
            let free = try await freeFunction(value: 10)
            precondition(free == 10 + version)
            assertions += 7
        }
        print("PASS \(assertions) native observations across baseline and two generated replacements")
    }
}
