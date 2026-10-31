import AsyncFrontierBaseline
import Darwin
import Foundation

@main @MainActor struct AsyncFrontierRunner {
    static var failures = 0
    static func check<T: Equatable>(_ actual: T, _ expected: T, _ label: String) {
        guard actual == expected else { failures += 1; print("FAIL \(label): \(actual) != \(expected)"); return }
        print("PASS \(label)")
    }
    static func entered(_ gate: SuspensionGate, _ id: Int) async {
        for _ in 0..<100_000 {
            if await gate.entered(id) { return }
            await Task.yield()
        }
        fatalError("Suspension gate timeout \(id)")
    }
    static func load(_ path: String) {
        guard dlopen(path, RTLD_NOW | RTLD_GLOBAL) != nil else {
            fatalError("dlopen: \(String(cString: dlerror()))")
        }
        // Deliberately retain images: suspended tasks and captured closures can still reference old code.
    }
    @MainActor static func main() async throws {
        let probe = AsyncProbe()
        let actor = ActorProbe()
        let mainActor = MainProbe()
        let generic = GenericProbe<Int64>()
        let gate = SuspensionGate()
        let marker = CancellationMarker()
        check(try await probe.work(4, scale: 2), 8, "baseline async throws")
        check(await actor.advance(1), 1, "baseline actor state")
        check(await mainActor.advance(1), 1, "baseline main actor state")
        let boundBefore: @Sendable (Int, Int) async throws -> Int = probe.work
        let oldTask = Task { try await probe.suspended(gate, id: 1) }
        let oldCancellation = Task { try await probe.cancellation(gate, id: 3, marker: marker) }
        let oldClosure = await probe.makeClosure(7)
        let oldActorTask = Task { await actor.interleave(gate, id: 7) }
        await entered(gate, 1)
        await entered(gate, 3)
        await entered(gate, 7)
        load(CommandLine.arguments[1])
        check(try await probe.work(4, scale: 2), 112, "async throws parameters task group continuation nested closure")
        check(try await boundBefore(4, 2), 112, "bound method captured before reload resolves new entry")
        check(await probe.generic(Int64(7)), 107, "generic async function")
        let mapped = await probe.mapping(12) { String($0) }
        check(mapped.0, "12", "async rethrows closure generic parameter result")
        check(mapped.1, 100, "generic where clause tuple result")
        check(try await probe.typed(4), 104, "typed throws result")
        do { _ = try await probe.typed(-1); fatalError("typed throws failed") }
        catch ProbeError.negative { print("PASS typed throws error") }
        var mutable = 7
        await probe.mutate(&mutable)
        check(mutable, 107, "async inout parameter")
        check(await probe.overloaded(7), "patch1-int-7", "integer overload")
        check(await probe.overloaded("seven"), "patch1-string-seven", "string overload")
        check(try await probe.rethrowing { 8 }, 108, "async rethrows result")
        do {
            _ = try await probe.rethrowing { throw ProbeError.negative }
            fatalError("rethrows failed to throw")
        } catch ProbeError.negative { print("PASS async rethrows error") }
        do {
            _ = try await probe.work(-1, scale: 2)
            fatalError("throws failed to throw")
        } catch ProbeError.negative { print("PASS async throws error") }
        check(try await probe.asyncValue, 110, "async throwing accessor")
        check(await probe[9], 109, "async subscript")
        check(await probe.callback { $0 * 3 }, 300, "callback parameter")
        check(await actor.advance(2), 104, "new actor invocation interleaves with old suspended task")
        await gate.release(7)
        check(await oldActorTask.value, 5, "old actor continuation uses shared unchanged storage and old code")
        check(await mainActor.advance(2), 103, "existing main actor isolated private state")
        check(try await generic.value(8), 108, "generic nominal existing instance")
        let middleTask = Task { try await probe.suspended(gate, id: 2) }
        let middleCancellation = Task { try await probe.cancellation(gate, id: 4, marker: marker) }
        let middleClosure = await probe.makeClosure(7)
        await entered(gate, 2)
        await entered(gate, 4)
        load(CommandLine.arguments[2])
        check(try await probe.work(4, scale: 2), 212, "second replacement wins")
        check(await actor.advance(3), 208, "second replacement preserves actor state")
        check(await mainActor.advance(3), 206, "second replacement preserves main actor state")
        check(try await generic.value(8), 208, "second replacement generic specialization")
        check(oldClosure(), 7, "escaped baseline closure retains original code and capture")
        check(middleClosure(), 107, "escaped first patch closure retains code and capture")
        check(await probe.makeClosure(7)(), 207, "new escaped closure uses second patch")
        check(try await AsyncProbe().work(4, scale: 2), 212, "new object coexists with existing object after reload")
        await gate.release(1)
        await gate.release(2)
        check(try await oldTask.value, 1, "baseline suspended frame finishes baseline code")
        check(try await middleTask.value, 102, "first patch suspended frame finishes first patch code")
        let newTask = Task { try await probe.suspended(gate, id: 5) }
        await entered(gate, 5)
        await gate.release(5)
        check(try await newTask.value, 205, "new task executes second patch")
        oldCancellation.cancel()
        middleCancellation.cancel()
        await gate.release(3)
        await gate.release(4)
        for task in [oldCancellation, middleCancellation] {
            do { _ = try await task.value; fatalError("Cancellation failed") }
            catch is CancellationError { print("PASS suspended cancellation throws") }
        }
        check(marker.read().sorted(), [0, 1], "in-flight cancellation handlers retain their generation")
        let latestCancellation = Task { try await probe.cancellation(gate, id: 6, marker: marker) }
        await entered(gate, 6)
        latestCancellation.cancel()
        await gate.release(6)
        do { _ = try await latestCancellation.value; fatalError("Cancellation failed") }
        catch is CancellationError { print("PASS latest cancellation throws") }
        check(marker.read().sorted(), [0, 1, 2], "new cancellation handler uses second patch")
        if failures != 0 { exit(1) }
        print("COMPLETE native async replacement proof; no iPhone/root-refresh claim")
    }
}
