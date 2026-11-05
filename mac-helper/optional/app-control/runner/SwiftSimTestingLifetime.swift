import Foundation
import Dispatch

/// One immutable process lifetime. No polling and no network dependency.
final class SwiftSimTestingLifetime {
    static let maximumSeconds: TimeInterval = 3600
    static let shared = SwiftSimTestingLifetime()
    private let lock = NSLock()
    private let queue = DispatchQueue(label: "swift-sim.testing.expiry", qos: .utility)
    private var timer: DispatchSourceTimer?
    private var started: UInt64?
    private var duration: TimeInterval
    private var selected = false

    init(seconds: TimeInterval = 600) {
        precondition(seconds.isFinite && seconds > 0 && seconds <= Self.maximumSeconds)
        duration = seconds
    }

    /// One phone launch can select a duration; it never moves the start time.
    @discardableResult
    func select(minutes: Int) -> Bool {
        guard [5, 10, 30, 60].contains(minutes) else { return false }
        lock.lock()
        defer { lock.unlock() }
        guard let started, let timer else { return false }
        let seconds = TimeInterval(minutes * 60)
        if selected { return duration == seconds }
        let elapsed = Double(DispatchTime.now().uptimeNanoseconds - started) / 1_000_000_000
        guard elapsed < duration, elapsed < seconds else { return false }
        selected = true
        duration = seconds
        timer.schedule(deadline: DispatchTime(uptimeNanoseconds: started + UInt64(seconds * 1_000_000_000)), leeway: .milliseconds(20))
        return true
    }

    var durationSeconds: TimeInterval {
        lock.lock()
        defer { lock.unlock() }
        return duration
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
