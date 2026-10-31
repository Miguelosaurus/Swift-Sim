import Foundation

@objc public protocol CallbackDelegate {
    func callback(_ value: NSNumber) -> NSNumber
}

public final class CallbackProbe: NSObject, CallbackDelegate {
    public var count = 0
    public func callback(_ value: NSNumber) -> NSNumber {
        count += 1
        return NSNumber(value: value.intValue + 1)
    }
}
