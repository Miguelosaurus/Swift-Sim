import Foundation
import SwiftUI
import Testing
@testable import SwiftSimLive

#if DEBUG
@MainActor private final class AddedStateFixture {
    var storage: AddedViewState.Storage?
    var writes = 0
    var proxy: AddedViewState {
        AddedViewState(storage: Binding(get: { self.storage }, set: { self.storage = $0; self.writes += 1 }))
    }
}
private let countKey = String(repeating: "a", count: 64)
private let draftKey = String(repeating: "b", count: 64)
private let laterKey = String(repeating: "c", count: 64)

@MainActor @Test
func addedStateDefaultsStayVirtualUntilMutationAndBindingsStayLive() {
    let fixture = AddedStateFixture()
    var schemaReads = 0
    let count = fixture.proxy.binding(countKey, initial: 0, generation: 1,
                                      activeKeys: { schemaReads += 1; return [countKey] })
    #expect(count.wrappedValue == 0)
    #expect(count.wrappedValue == 0)
    #expect(fixture.storage == nil)
    #expect(fixture.writes == 0)
    #expect(schemaReads == 0)
    count.wrappedValue = 7
    #expect(fixture.storage?.values.count == 1)
    #expect(fixture.writes == 1)
    #expect(schemaReads == 1)
    #expect(count.wrappedValue == 7)
    let regenerated = fixture.proxy.binding(countKey, initial: 0, generation: 2,
                                            activeKeys: { [countKey, laterKey] })
    #expect(regenerated.wrappedValue == 7)
    #expect(fixture.writes == 1)
    regenerated.wrappedValue += 1
    #expect(count.wrappedValue == 8)
    #expect(fixture.storage?.generation == 2)
}

@MainActor @Test
func addedStateBelongsToEachViewAndPreservesOptionalNilAndValueTypes() {
    let first = AddedStateFixture(), second = AddedStateFixture()
    first.proxy.set(countKey, value: 9, generation: 1, activeKeys: { [countKey, draftKey, laterKey] })
    second.proxy.set(countKey, value: 22, generation: 1, activeKeys: { [countKey] })
    #expect(first.proxy.value(countKey, initial: 0) == 9)
    #expect(second.proxy.value(countKey, initial: 0) == 22)
    first.proxy.set(draftKey, value: Optional<String>.none, generation: 1,
                    activeKeys: { [countKey, draftKey, laterKey] })
    let optional: String? = first.proxy.value(draftKey, initial: Optional("default"))
    #expect(optional == nil)
    #expect(first.storage?.values[draftKey] != nil)
    #expect(second.proxy.value(draftKey, initial: "separate") == "separate")
    first.proxy.set(laterKey, value: ["one"], generation: 1,
                    activeKeys: { [countKey, draftKey, laterKey] })
    var copy = first.proxy.value(laterKey, initial: [String]())
    copy.append("two")
    #expect(first.proxy.value(laterKey, initial: [String]()) == ["one"])
    first.proxy.set(laterKey, value: copy, generation: 1,
                    activeKeys: { [countKey, draftKey, laterKey] })
    #expect(first.proxy.value(laterKey, initial: [String]()) == ["one", "two"])
}

@MainActor @Test
func olderBindingsCannotPruneOrReviveAbsentKeysAfterANewerSchemaWrite() {
    let fixture = AddedStateFixture()
    let oldCount = fixture.proxy.binding(countKey, initial: 0, generation: 1,
                                         activeKeys: { [countKey, draftKey] })
    let removed = fixture.proxy.binding(draftKey, initial: "", generation: 1,
                                        activeKeys: { [countKey, draftKey] })
    oldCount.wrappedValue = 7
    removed.wrappedValue = "retired"
    let fresh = fixture.proxy.binding(laterKey, initial: false, generation: 2,
                                      activeKeys: { [countKey, laterKey] })
    #expect(!fresh.wrappedValue)
    #expect(fixture.storage?.generation == 1)
    // Seeing a newer body/schema does not write State during rendering, and
    // pure baseline restoration has the same no-retirement limitation.
    removed.wrappedValue = "live until a newer write"
    #expect(fixture.proxy.value(draftKey, initial: "") == "live until a newer write")
    fresh.wrappedValue = true
    #expect(fixture.storage?.values[draftKey] == nil)
    oldCount.wrappedValue = 11
    removed.wrappedValue = "stale task"
    #expect(fresh.wrappedValue)
    #expect(oldCount.wrappedValue == 11)
    #expect(fixture.storage?.generation == 2)
    #expect(fixture.storage?.activeKeys == Set([countKey, laterKey]))
    #expect(fixture.storage?.values[draftKey] == nil)
}

@MainActor @Test
func addedStateRejectsConflictingOrMalformedSchemasWithoutWriting() {
    let fixture = AddedStateFixture()
    for key in ["", "bad", String(repeating: "A", count: 64), String(repeating: "a", count: 65)] {
        #expect(fixture.proxy.value(key, initial: 4) == 4)
        fixture.proxy.set(key, value: 9, generation: 1, activeKeys: { [key] })
    }
    fixture.proxy.set(countKey, value: 1, generation: 0, activeKeys: { [countKey] })
    fixture.proxy.set(countKey, value: 1, generation: 1, activeKeys: { [] })
    fixture.proxy.set(countKey, value: 1, generation: 1, activeKeys: { [draftKey] })
    fixture.proxy.set(countKey, value: 1, generation: 1, activeKeys: { [countKey, countKey] })
    fixture.proxy.set(countKey, value: 1, generation: 1, activeKeys: { [countKey, "bad"] })
    #expect(fixture.storage == nil)
    #expect(fixture.writes == 0)
    fixture.proxy.set(countKey, value: 7, generation: 1, activeKeys: { [countKey] })
    fixture.proxy.set(draftKey, value: "conflict", generation: 1, activeKeys: { [countKey, draftKey] })
    #expect(fixture.writes == 1)
    #expect(fixture.proxy.value(countKey, initial: 0) == 7)
    #expect(fixture.storage?.values[draftKey] == nil)
    // Distinct compiler keys carry different type/default identities. A bad
    // cast is never an unchecked load from a changed native object layout.
    #expect(fixture.proxy.value(countKey, initial: "safe fallback") == "safe fallback")
}

@MainActor @Test
func addedStateBoundsStorageAcrossManyFieldGenerations() {
    let fixture = AddedStateFixture()
    let keys = (0..<33).map { String(repeating: "0", count: 62) + String(format: "%02x", $0) }
    fixture.proxy.set(keys[0], value: 1, generation: 1, activeKeys: { keys })
    #expect(fixture.storage == nil)
    for generation in 1...80 {
        let active = (generation..<(generation + 32)).map {
            String(repeating: "0", count: 60) + String(format: "%04x", $0)
        }
        for (index, key) in active.enumerated() {
            fixture.proxy.set(key, value: index, generation: UInt64(generation), activeKeys: { active })
        }
        #expect(fixture.storage?.values.count == 32)
        #expect(fixture.storage?.activeKeys == Set(active))
    }
}
@MainActor @Test
func addedStateInitializersAreNotEvaluatedForStoredCollections() {
    let fixture = AddedStateFixture()
    fixture.proxy.set(countKey, value: [7], generation: 1, activeKeys: { [countKey] })
    var initializations = 0
    func initialCollection() -> [Int] {
        initializations += 1
        return [1, 2, 3]
    }
    // Binding may invoke get during construction. Even that read must avoid
    // rebuilding a literal collection once the slot already stores a value.
    let count = fixture.proxy.binding(countKey, initial: initialCollection(), generation: 2,
                                      activeKeys: { [countKey] })
    let stored = fixture.proxy.value(countKey, initial: initialCollection())
    let bound = count.wrappedValue
    #expect(stored == [7] && bound == [7])
    #expect(initializations == 0)
    #expect(fixture.writes == 1)
    #expect(fixture.storage?.generation == 1)
    let missing = fixture.proxy.value(draftKey, initial: initialCollection())
    #expect(missing == [1, 2, 3])
    #expect(initializations == 1)
    #expect(fixture.writes == 1)
}
#endif
