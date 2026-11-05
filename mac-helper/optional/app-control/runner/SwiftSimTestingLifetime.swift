import Foundation
import Dispatch

/// One immutable process lifetime. No polling and no network dependency.
final class SwiftSimTestingLifetime {
    static let maximumSeconds: TimeInterval = 600
    static let shared = SwiftSimTestingLifetime()
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "swift-sim.testing.expiry", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var started: UInt64?
    private let duration: TimeInterval

    init(seconds: TimeInterval = maximumSeconds) {
        precondition(seconds.isFinite && seconds > 0 && seconds <= Self.maximumSeconds)
        duration = seconds
    }

    /// Calling again never renews the deadline.
    func arm(onExpiry: @escaping () -> Void) {
        lock.lock()
        defer { lock.unlock() }
        guard started == nil else { return }
        started = DispatchTime.now().uptimeNanoseconds
        let source = DispatchSource.makeTimerSource(queue: queue)
        source.schedule(deadline: .now() + duration, leeway: .milliseconds(20))
        source.setEventHandler(handler: onExpiry)
        timer = source
        source.resume()
    }

    var secondsRemaining: TimeInterval {
        lock.lock()
        defer { lock.unlock() }
        guard let started else { return 0 }
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000_000
        return max(0, duration - elapsed)
    }

    func end() {
        lock.lock()
        defer { lock.unlock() }
        timer?.cancel()
        timer = nil
        started = nil
    }

    deinit { timer?.cancel() }
}
