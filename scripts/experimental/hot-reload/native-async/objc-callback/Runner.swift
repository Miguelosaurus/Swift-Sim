import Darwin
import Foundation
import ObjectiveC
import ObjCFrontierBaseline

func check<T: Equatable>(_ actual: T, _ expected: T, _ label: String) {
    guard actual == expected else { fatalError("\(label): \(actual) != \(expected)") }
    print("PASS \(label)")
}

func pointer(_ imp: IMP) -> UInt { unsafeBitCast(imp, to: UInt.self) }
let selector = NSSelectorFromString("callback:")

func method(_ selector: Selector) -> Method {
    guard let method = class_getInstanceMethod(CallbackProbe.self, selector) else { fatalError("Missing callback") }
    return method
}

func observe(_ probe: CallbackProbe, expected: Int, label: String) {
    let delegate: CallbackDelegate = probe
    check(probe.callback(7).intValue, expected, label + " direct Swift")
    check(delegate.callback(7).intValue, expected, label + " @objc protocol")
    let result = probe.perform(selector, with: NSNumber(value: 7))!.takeUnretainedValue() as! NSNumber
    check(result.intValue, expected, label + " Objective-C selector")
}

// This gate serializes only this experiment's own mutations. Objective-C exposes
// no compare-and-swap for arbitrary concurrent third-party swizzlers.
func replace(expected: IMP, replacement: IMP, expectedEncoding: String) -> Bool {
    precondition(Thread.isMainThread)
    let current = method(selector)
    guard pointer(method_getImplementation(current)) == pointer(expected),
          String(cString: method_getTypeEncoding(current)!) == expectedEncoding else { return false }
    var count: UInt32 = 0
    guard let localMethods = class_copyMethodList(CallbackProbe.self, &count) else { return false }
    defer { free(localMethods) }
    guard (0..<Int(count)).contains(where: { method_getName(localMethods[$0]) == selector }) else { return false }
    let previous = expectedEncoding.withCString {
        class_replaceMethod(CallbackProbe.self, selector, replacement, $0)
    }
    guard let previous, pointer(previous) == pointer(expected) else {
        fatalError("Uncertain concurrent mutation: original IMP was not the expected owner")
    }
    check(pointer(method_getImplementation(method(selector))), pointer(replacement), "post-swap exact IMP")
    return true
}

let probe = CallbackProbe()
let baseline = method_getImplementation(method(selector))
let encoding = String(cString: method_getTypeEncoding(method(selector))!)
observe(probe, expected: 8, label: "baseline")
var replacements: [IMP] = []
for (index, path) in CommandLine.arguments.dropFirst().enumerated() {
    guard dlopen(path, RTLD_NOW | RTLD_GLOBAL) != nil else { fatalError(String(cString: dlerror())) }
    let replacementSelector = NSSelectorFromString("frontier_callback_\(index + 1):")
    let actual = method_getImplementation(method(selector))
    let declared = method_getImplementation(method(replacementSelector))
    check(pointer(actual), pointer(declared), "loaded original selector maps to exact generation \(index + 1) IMP")
    check(String(cString: method_getTypeEncoding(method(replacementSelector))!), encoding, "generation \(index + 1) ABI encoding")
    replacements.append(actual)
    observe(probe, expected: 7 + (index + 1) * 100, label: "generation \(index + 1)")
}
check(probe.count, 903, "existing object storage retained across both category loads")
check(replace(expected: baseline, replacement: baseline, expectedEncoding: encoding), false, "stale original owner rejected")
check(replace(expected: replacements[1], replacement: baseline, expectedEncoding: "v@:"), false, "ABI mismatch rejected")
check(pointer(method_getImplementation(method(selector))), pointer(replacements[1]), "negative attempts did not mutate dispatch")
check(replace(expected: replacements[1], replacement: replacements[0], expectedEncoding: encoding), true, "rollback latest to previous generation")
observe(probe, expected: 107, label: "rollback generation 1")
check(replace(expected: replacements[0], replacement: baseline, expectedEncoding: encoding), true, "rollback previous to original baseline")
observe(probe, expected: 8, label: "rollback baseline")
check(replace(expected: baseline, replacement: replacements[1], expectedEncoding: encoding), true, "forward compensation to known generation")
observe(probe, expected: 207, label: "forward generation 2")
check(replace(expected: replacements[1], replacement: baseline, expectedEncoding: encoding), true, "final baseline restoration")
observe(probe, expected: 8, label: "final baseline")
check(probe.count, 1809, "rollback changes dispatch without silently rewinding object state")
print("COMPLETE Objective-C native category/IMP proof; no device receipt claim")
