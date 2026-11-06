#if DEBUG
import SwiftUI

/// A view-local extension of SwiftUI state used only by generated Debug accessors.
/// Pure literal defaults remain virtual until the first write. SwiftUI owns the
/// optional storage through the existing refresh property; there is no registry.
/// Schemas advance on writes, so read-only refresh/restoration does not retire
/// an older callback or discard its values before the view lifetime ends.
@MainActor
public struct AddedViewState {
    final class Storage {
        let generation: UInt64
        let activeKeys: Set<String>
        let values: [String: Any]
        init(generation: UInt64, activeKeys: Set<String>, values: [String: Any]) {
            self.generation = generation; self.activeKeys = activeKeys; self.values = values
        }
    }

    private let storage: Binding<Storage?>
    init(storage: Binding<Storage?>) { self.storage = storage }

    public func value<Value>(_ key: String, initial: @autoclosure () -> Value) -> Value {
        guard Self.validKey(key) else { return initial() }
        return storage.wrappedValue?.values[key] as? Value ?? initial()
    }

    public func set<Value>(_ key: String, value: Value, generation: UInt64,
                           activeKeys: () -> [String]) {
        guard generation > 0, Self.validKey(key) else { return }
        let next: (generation: UInt64, activeKeys: Set<String>, values: [String: Any])
        if let current = storage.wrappedValue, generation < current.generation {
            // After a newer schema write, an old task/binding may still write
            // a surviving field. It cannot revive absent keys or prune newer
            // values. Reads alone deliberately do not advance that schema.
            guard current.activeKeys.contains(key) else { return }
            next = (current.generation, current.activeKeys, current.values)
        } else {
            let keys = activeKeys()
            guard !keys.isEmpty, keys.count <= 32, keys.allSatisfy(Self.validKey) else { return }
            let unique = Set(keys)
            guard unique.count == keys.count, unique.contains(key) else { return }
            if let current = storage.wrappedValue {
                if generation == current.generation {
                    guard current.activeKeys == unique else { return }
                    next = (current.generation, current.activeKeys, current.values)
                } else {
                    next = (generation, unique, current.values.filter { unique.contains($0.key) })
                }
            } else {
                next = (generation, unique, [:])
            }
        }
        var values = next.values
        values[key] = value as Any
        guard values.count <= 32 else { return }
        // A fresh immutable box also makes a same-location State write visible
        // to SwiftUI, without allocating any box for untouched views.
        storage.wrappedValue = Storage(generation: next.generation,
                                       activeKeys: next.activeKeys, values: values)
    }

    public func binding<Value>(_ key: String, initial: @autoclosure @escaping () -> Value, generation: UInt64,
                               activeKeys: @escaping () -> [String]) -> Binding<Value> {
        Binding(get: { value(key, initial: initial()) },
                set: { set(key, value: $0, generation: generation, activeKeys: activeKeys) })
    }

    private static func validKey(_ key: String) -> Bool {
        key.utf8.count == 64 && key.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
    }
}
#endif
